import { db } from "@/db/client";
import {
  pmReportLineItems, pmReports, normalizedCategories, properties, loans,
  entities, entityOwnerships, owners, underwritingModels,
} from "@/db/schema";
import { eq } from "drizzle-orm";

// ---------- Current rent, derived from PM statement "Rent Income" lines ----------
//
// Why not pm_report_line_items.date: the PM statement PDFs format rent lines
// like "Rent - RENT (01-2026) $620.00" — a month/year tag only, no day — so
// the parser's date regex (which only matches full MM-DD-YYYY) leaves .date
// null for nearly every rent row. Utility lines do carry real dates because
// their source lines use date ranges. So "most recent" has to come from the
// parent statement's period_end instead, which is always populated.
//
// Why not just take each (propertyId, propertyLabel) group's own latest
// row and sum those across labels: a property's label text can change over
// time (e.g. an early lump-sum annual label later superseded by per-unit
// monthly labels), and that superseded label still has its own "latest"
// occurrence somewhere in the past — summing every label's own latest row
// would wrongly add that stale figure back in every time. The correct
// notion of "current" is per-property, not per-label: find the single most
// recent period_end among all of a property's Rent Income rows, then sum
// only the rows at exactly that period. A label that stopped appearing
// (superseded, or a vacant unit skipped from that statement) simply isn't
// part of the most recent period and drops out on its own. This also
// naturally handles 1139 Division St, where two physically distinct units
// share the exact same label string within one statement — both rows share
// the same periodEnd and both get summed.
export type CurrentRent = { amount: number; asOf: string; byLabel: { label: string; amount: number }[] };

export async function getCurrentRentDetailByProperty(): Promise<Record<string, CurrentRent>> {
  const rows = await db
    .select({
      propertyId: pmReportLineItems.propertyId,
      propertyLabel: pmReportLineItems.propertyLabel,
      periodEnd: pmReports.periodEnd,
      amount: pmReportLineItems.amount,
    })
    .from(pmReportLineItems)
    .innerJoin(normalizedCategories, eq(pmReportLineItems.normalizedCategoryId, normalizedCategories.id))
    .innerJoin(pmReports, eq(pmReportLineItems.reportId, pmReports.id))
    .where(eq(normalizedCategories.name, "Rent Income"));

  type Row = { propertyId: string | null; propertyLabel: string | null; periodEnd: string; amount: number };
  const byProperty: Record<string, Row[]> = {};
  for (const r of rows as Row[]) {
    if (!r.propertyId) continue;
    (byProperty[r.propertyId] ??= []).push(r);
  }

  const result: Record<string, CurrentRent> = {};
  for (const [propertyId, group] of Object.entries(byProperty)) {
    const latestPeriod = group.reduce((max, r) => (r.periodEnd > max ? r.periodEnd : max), group[0].periodEnd);
    const current = group.filter((r) => r.periodEnd === latestPeriod);
    const amount = current.reduce((sum, r) => sum + r.amount, 0);
    const byLabel: Record<string, number> = {};
    for (const r of current) {
      const label = r.propertyLabel ?? "(unlabeled)";
      byLabel[label] = (byLabel[label] ?? 0) + r.amount;
    }
    result[propertyId] = {
      amount,
      asOf: latestPeriod,
      byLabel: Object.entries(byLabel).map(([label, amount]) => ({ label, amount })),
    };
  }
  return result;
}

export async function getCurrentRentByProperty(): Promise<Record<string, { amount: number; asOf: string }>> {
  const detail = await getCurrentRentDetailByProperty();
  const result: Record<string, { amount: number; asOf: string }> = {};
  for (const [propertyId, r] of Object.entries(detail)) {
    result[propertyId] = { amount: r.amount, asOf: r.asOf };
  }
  return result;
}

// Decides which of the three rent sources (PM statement, lease, VARE
// estimate) to trust as "current monthly rent," and — this is the part
// that isn't just priority order — guards against a specific PM-statement
// failure mode: a tenant who moves in mid-month gets a prorated first
// rent payment (e.g. 1339 Division St's tenant moved in 2026-07-22, so
// that month's PM-reported "rent" was $591.78 against an actual $1,800
// lease). If the most recent PM statement period is the same calendar
// month a current lease started, that PM figure is almost certainly a
// proration, not the steady-state rent, so the lease's full rent wins
// instead. Falls back through lease -> PM (even if possibly prorated,
// better than nothing) -> VARE estimate -> null.
export function resolveCurrentRent(opts: {
  pmRent: { amount: number; asOf: string } | undefined;
  leaseRent: number | null;
  mostRecentLeaseStart: string | null;
  estimateRent: number | null;
}): { amount: number | null; source: "pm" | "lease" | "estimate" | null } {
  const { pmRent, leaseRent, mostRecentLeaseStart, estimateRent } = opts;
  const pmLooksProrated = !!(pmRent && mostRecentLeaseStart && pmRent.asOf.slice(0, 7) === mostRecentLeaseStart.slice(0, 7));

  if (pmRent && !pmLooksProrated) return { amount: pmRent.amount, source: "pm" };
  if (leaseRent !== null) return { amount: leaseRent, source: "lease" };
  if (pmRent) return { amount: pmRent.amount, source: "pm" };
  if (estimateRent !== null) return { amount: estimateRent, source: "estimate" };
  return { amount: null, source: null };
}

// ---------- NOI, per property, from actual PM statement activity ----------
//
// Income and Operating Expense groups come straight from
// normalized_categories.group; Capex and Adjustment (owner contributions/
// draws) are deliberately excluded from NOI. Because most entities only
// have a handful of months of statements on file so far, this returns the
// actual monthly average over however many distinct statement periods exist
// per property, plus that month count, so callers can annualize and label
// the result honestly ("annualized from N months of actual data") instead
// of implying a full trailing-twelve-month figure.
//
// Statement periods before a property's putIntoServiceDate are excluded
// from the average entirely — those are pre-rental rehab months that only
// ever carry expenses (no rent yet), and folding them in drags the average
// NOI down in a way that doesn't reflect ongoing performance. A property
// with no putIntoServiceDate on file yet keeps all its periods, same as
// before.
export type NoiResult = { monthlyAvg: number; months: number; opexMonthlyAvg: number | null };

export async function getNoiByProperty(): Promise<Record<string, NoiResult>> {
  const rows = await db
    .select({
      propertyId: pmReportLineItems.propertyId,
      group: normalizedCategories.group,
      amount: pmReportLineItems.amount,
      periodEnd: pmReports.periodEnd,
    })
    .from(pmReportLineItems)
    .innerJoin(normalizedCategories, eq(pmReportLineItems.normalizedCategoryId, normalizedCategories.id))
    .innerJoin(pmReports, eq(pmReportLineItems.reportId, pmReports.id));

  const propRows = await db.select({ id: properties.id, putIntoServiceDate: properties.putIntoServiceDate }).from(properties);
  const serviceDateById: Record<string, string | null> = Object.fromEntries(propRows.map((p) => [p.id, p.putIntoServiceDate]));

  type Row = { propertyId: string | null; group: string; amount: number; periodEnd: string };
  const byProperty: Record<string, { net: number; opex: number; periods: Set<string> }> = {};
  for (const r of rows as Row[]) {
    if (!r.propertyId) continue;
    if (r.group !== "Income" && r.group !== "Operating Expense") continue;
    const serviceDate = serviceDateById[r.propertyId];
    if (serviceDate && r.periodEnd < serviceDate) continue;
    if (!byProperty[r.propertyId]) byProperty[r.propertyId] = { net: 0, opex: 0, periods: new Set() };
    byProperty[r.propertyId].net += r.amount; // income positive, opex negative — already NOI-signed
    if (r.group === "Operating Expense") byProperty[r.propertyId].opex += r.amount;
    byProperty[r.propertyId].periods.add(r.periodEnd);
  }

  const result: Record<string, NoiResult> = {};
  for (const [propertyId, { net, opex, periods }] of Object.entries(byProperty)) {
    const months = Math.max(periods.size, 1);
    result[propertyId] = { monthlyAvg: net / months, months, opexMonthlyAvg: -(opex / months) };
  }
  return result;
}

export function monthlyPrincipalAndInterest(loan: typeof loans.$inferSelect | undefined): { value: number; known: boolean } {
  if (!loan || !loan.currentBalance) return { value: 0, known: true };
  if (!loan.originalAmount || !loan.termMonths || loan.rate === null || loan.rate === undefined) {
    return { value: 0, known: false };
  }
  const n = loan.termMonths;
  const r = loan.rate / 12;
  const value = r === 0 ? loan.originalAmount / n : (loan.originalAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return { value, known: true };
}

// ---------- Property-level performance metrics ----------
//
// cap rate = annualized NOI / current value
// DSCR = annualized NOI / annual debt service (P&I + escrows; null if PITI unknown)
// cash-on-cash = annualized (NOI - debt service) / equity invested to date
//   (purchase price + rehab spent, a practical stand-in for "cash in" since
//   most properties here don't have a clean all-in cash-invested figure yet)
// appreciation = current value / purchase price - 1
// Alongside the metrics themselves, this carries the intermediate figures
// each one was built from (annualized NOI, the value/debt-service/cash
// figures used as denominators) — so a caller can show "here's exactly
// what was plugged in" instead of just the final number.
export type PropertyMetrics = {
  noiMonthlyAvg: number | null;
  noiMonths: number;
  noiIsProjected: boolean;
  opexMonthlyAvg: number | null;
  annualNoi: number | null;
  capRate: number | null;
  capRateValue: number | null; // the denominator actually used (current value, or ARV when NOI is projected)
  capRateValueIsArv: boolean;
  annualDebtService: number | null;
  dscr: number | null;
  cashOnCash: number | null;
  cashInvested: number;
  appreciationPct: number | null;
};

export function computePropertyMetrics(opts: {
  property: typeof properties.$inferSelect;
  loan: typeof loans.$inferSelect | undefined;
  noi: NoiResult | undefined;
  underwriting?: typeof underwritingModels.$inferSelect | undefined;
}): PropertyMetrics {
  const { property, loan, noi, underwriting } = opts;

  let noiMonthlyAvg = noi?.monthlyAvg ?? null;
  let noiIsProjected = false;
  // No actual PM statement activity on file yet — usually because the
  // property hasn't closed or hasn't been rented yet (e.g. still under
  // contract, or mid-rehab like 110-112 S. Buckeye). Fall back to a
  // projected NOI from the VARE underwriting model instead of showing a
  // blank cap rate: projected rent, less vacancy, repairs, and PM fee —
  // capex is excluded here too, matching how actual NOI treats it. This
  // doesn't yet account for property tax/insurance, since those aren't
  // finalized until financing closes.
  if (noiMonthlyAvg === null && underwriting?.projectedMonthlyRent) {
    const rent = underwriting.projectedMonthlyRent;
    const drag = (underwriting.vacancyPct ?? 0) + (underwriting.repairPct ?? 0) + (underwriting.pmFeePct ?? 0);
    noiMonthlyAvg = rent * (1 - drag);
    noiIsProjected = true;
  }

  const annualNoi = noiMonthlyAvg !== null ? noiMonthlyAvg * 12 : null;
  const actualValue = property.currentEstValue ?? null;
  // Only reach for the underwriting model's ARV as a stand-in "value" when
  // the NOI itself is also projected — otherwise a real cap rate would end
  // up dividing actual NOI by a hypothetical post-rehab value.
  const value = actualValue ?? (noiIsProjected ? underwriting?.arv ?? null : null);

  const capRate = annualNoi !== null && value ? annualNoi / value : null;

  const pAndI = monthlyPrincipalAndInterest(loan);
  const annualDebtService = pAndI.known
    ? (pAndI.value + (loan?.monthlyTaxEscrow ?? 0) + (loan?.monthlyInsuranceEscrow ?? 0)) * 12
    : null;
  const dscr = annualNoi !== null && annualDebtService ? annualNoi / annualDebtService : null;

  const cashInvested = (property.purchasePrice ?? 0) + (property.rehabSpentToDate ?? 0);
  const cashOnCash = annualNoi !== null && annualDebtService !== null && cashInvested > 0
    ? (annualNoi - annualDebtService) / cashInvested
    : null;

  // Appreciation always compares against the real current-value estimate,
  // never the projected ARV fallback above — that's a hoped-for post-rehab
  // value, not evidence of appreciation that's actually happened yet.
  const appreciationPct = property.purchasePrice && actualValue
    ? actualValue / property.purchasePrice - 1
    : null;

  return {
    noiMonthlyAvg,
    noiMonths: noi?.months ?? 0,
    noiIsProjected,
    opexMonthlyAvg: noi?.opexMonthlyAvg ?? null,
    annualNoi,
    capRate,
    capRateValue: value,
    capRateValueIsArv: noiIsProjected && actualValue === null && value !== null,
    annualDebtService,
    dscr,
    cashOnCash,
    cashInvested,
    appreciationPct,
  };
}

// ---------- Entity ownership splits (B2 Partners 50/50, etc.) ----------

export async function getCurrentOwnershipsByEntity(): Promise<Record<string, { ownerId: string; ownerName: string; percent: number; isHousehold: boolean }[]>> {
  const rows = await db
    .select({
      entityId: entityOwnerships.entityId,
      ownerId: entityOwnerships.ownerId,
      ownerName: owners.name,
      percent: entityOwnerships.percent,
      isHousehold: owners.isHousehold,
      endDate: entityOwnerships.endDate,
    })
    .from(entityOwnerships)
    .innerJoin(owners, eq(entityOwnerships.ownerId, owners.id));

  const result: Record<string, { ownerId: string; ownerName: string; percent: number; isHousehold: boolean }[]> = {};
  for (const r of rows) {
    if (r.endDate) continue;
    (result[r.entityId] ??= []).push({ ownerId: r.ownerId, ownerName: r.ownerName, percent: r.percent, isHousehold: r.isHousehold });
  }
  return result;
}

// The household's (Patrick & Gina's) ownership % of a given entity — 100%
// for every entity except B2 Partners LLC, where Mike Bogan holds the
// other 50%. Looked up from entity_ownerships/owners.is_household rather
// than hardcoded, so it stays correct if the split ever changes. An entity
// with no ownership rows on file at all (shouldn't normally happen, but
// "Personal" has none since it's inherently 100% Patrick & Gina, not held
// through an LLC with recorded partners) defaults to 100%.
export async function getHouseholdPctByEntity(): Promise<Record<string, number>> {
  const byEntity = await getCurrentOwnershipsByEntity();
  const result: Record<string, number> = {};
  for (const [entityId, ownerships] of Object.entries(byEntity)) {
    const household = ownerships.find((o) => o.isHousehold);
    result[entityId] = household ? household.percent : 100;
  }
  return result;
}

export async function getEntityByName(name: string) {
  const [e] = await db.select().from(entities).where(eq(entities.name, name));
  return e;
}

// Shared hover-explainer text for every metric shown as a MetricTile, so
// the wording stays identical wherever a metric appears (main dashboard,
// property page, LLC Performance, etc.) instead of drifting between pages.
export const METRIC_TOOLTIPS = {
  value: "Current estimated property value, from the most recent appraisal, Zillow estimate, or other source on file.",
  debt: "Outstanding loan balance as of the most recent mortgage statement on file. Blank means the property was bought in cash.",
  equity: "Value minus debt.",
  monthlyRent: "Current monthly rent. Prefers the most recent PM statement rent transaction; falls back to the active lease (\"lease\"), then a VARE underwriting projection (\"est.\") when neither exists yet.",
  monthlyPiti: "Principal, Interest, Taxes & Insurance — the full monthly mortgage payment including escrowed tax and insurance. \"Partial\" means the loan's rate, term, original amount, or escrow figures aren't fully entered yet.",
  noi: "Net Operating Income per month — actual rental income minus operating expenses, from PM statement data, averaged over the months on file since the property was placed in service (excludes capital improvements, owner draws/contributions, and any pre-rental rehab months). When there's no PM statement history yet — not closed, or not rented — this is projected instead, from the VARE underwriting's rent, vacancy, repair, and PM-fee assumptions.",
  opex: "Average monthly operating expenses from PM statement data — repairs, PM fee, utilities, etc. (excludes capital improvements and debt service), averaged over the months on file since the property was placed in service.",
  capRate: "Capitalization Rate — annualized NOI ÷ current value. The standard way to compare a property's return independent of how it's financed. Projected (using the VARE underwriting's ARV as value) when there's no actual NOI yet.",
  cashOnCash: "Annualized (NOI − annual debt service) ÷ cash invested (purchase price + rehab spent to date). Measures return on the actual cash put in, unlike cap rate. Projected when there's no actual NOI yet.",
  dscr: "Debt Service Coverage Ratio — annualized NOI ÷ annual PITI. Above 1.0 means rental income covers the mortgage payment; lenders typically want 1.2+. Projected when there's no actual NOI yet.",
  appreciation: "Change in estimated value since purchase, as a percentage of the original purchase price.",
  purchased: "Purchase price and closing date.",
} as const;
