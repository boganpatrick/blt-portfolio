import { db } from "@/db/client";
import {
  properties, propertyOwnerships, entities, loans, propertyPmAssignments,
  propertyManagers, underwritingModels, units, leases,
} from "@/db/schema";
import { isNull } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/PageNav";
import {
  getCurrentRentByProperty, getNoiByProperty, computePropertyMetrics,
  monthlyPrincipalAndInterest, getHouseholdPctByEntity, resolveCurrentRent, type PropertyMetrics,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";

async function getPortfolio() {
  const allProperties = await db.select().from(properties);
  const currentOwnerships = await db
    .select()
    .from(propertyOwnerships)
    .where(isNull(propertyOwnerships.endDate));
  const allEntities = await db.select().from(entities);
  const allLoans = await db.select().from(loans);
  const currentPmAssignments = await db
    .select()
    .from(propertyPmAssignments)
    .where(isNull(propertyPmAssignments.endDate));
  const allPms = await db.select().from(propertyManagers);
  const allUnderwriting = await db.select().from(underwritingModels);
  const allUnits = await db.select().from(units);
  const allLeases = await db.select().from(leases);
  const pmRentByProperty = await getCurrentRentByProperty();
  const noiByProperty = await getNoiByProperty();

  const entityById = Object.fromEntries(allEntities.map((e) => [e.id, e]));
  const pmById = Object.fromEntries(allPms.map((p) => [p.id, p]));

  // Current monthly rent per property = sum, across its units, of the most
  // recent non-ended lease's rent + pet rent. A unit with no lease on file
  // contributes nothing (not treated as $0 rent — it's a data gap, not a
  // vacancy fact), which is why "current rent" can understate a property
  // that has units without lease documents loaded yet (see HANDOFF.md).
  const leasesByUnit: Record<string, typeof allLeases> = {};
  for (const l of allLeases) {
    (leasesByUnit[l.unitId] ??= []).push(l);
  }
  const currentLeaseForUnit = (unitId: string) => {
    const unitLeases = (leasesByUnit[unitId] ?? []).filter((l) => l.status !== "ended");
    if (unitLeases.length === 0) return undefined;
    // Most recently started lease still on file as current.
    return unitLeases.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];
  };

  const rows = allProperties.map((p) => {
    const ownership = currentOwnerships.find((o) => o.propertyId === p.id);
    const entity = ownership ? entityById[ownership.entityId] : undefined;
    const loan = allLoans.find((l) => l.propertyId === p.id);
    const pmAssignment = currentPmAssignments.find((a) => a.propertyId === p.id);
    const pm = pmAssignment ? pmById[pmAssignment.pmId] : undefined;
    const underwriting = allUnderwriting.find((u) => u.propertyId === p.id);
    const debt = loan?.currentBalance ?? 0;
    const value = p.currentEstValue ?? 0;
    const equity = p.status === "personal_residence" || p.status === "under_contract" ? null : value - debt;

    const propertyUnits = allUnits.filter((u) => u.propertyId === p.id);
    const currentLeases = propertyUnits.map((u) => currentLeaseForUnit(u.id)).filter((l): l is typeof allLeases[number] => !!l);
    const leaseRent = currentLeases.length > 0
      ? currentLeases.reduce((sum, l) => sum + (l.rentAmount ?? 0) + (l.petRent ?? 0), 0)
      : null;
    const mostRecentLeaseStart = currentLeases.length > 0
      ? currentLeases.reduce((max, l) => ((l.startDate ?? "") > max ? (l.startDate ?? "") : max), currentLeases[0].startDate ?? "") || null
      : null;
    // Rent source priority, most-authoritative first: (1) most recent
    // "Rent Income" line item(s) from actual PM statements, unless that
    // statement's period is the same calendar month a current lease
    // started — a move-in rarely lands on the 1st, so that PM figure is
    // almost always a prorated partial-month amount rather than the real
    // monthly rent, and the lease's full rent is used instead in that case
    // (see resolveCurrentRent in src/lib/metrics.ts); (2) the active
    // lease's rent + pet rent; (3) the VARE underwriting projection.
    const pmRent = pmRentByProperty[p.id];
    const { amount: currentRent, source: rentSource } = resolveCurrentRent({
      pmRent, leaseRent, mostRecentLeaseStart, estimateRent: underwriting?.projectedMonthlyRent ?? null,
    });
    const rentIsEstimate = rentSource === "estimate";

    const pAndI = monthlyPrincipalAndInterest(loan);
    const hasAnyPitiInput = (pAndI.known && pAndI.value > 0) || loan?.monthlyTaxEscrow != null || loan?.monthlyInsuranceEscrow != null;
    const monthlyPiti = hasAnyPitiInput
      ? pAndI.value + (loan?.monthlyTaxEscrow ?? 0) + (loan?.monthlyInsuranceEscrow ?? 0)
      : null;
    // "Complete" = P&I is a known number (whether that's a real payment or a
    // genuine $0 for a cash purchase) AND both escrow figures are entered —
    // so the dashboard can be honest about when a PITI figure is partial.
    const pitiComplete = pAndI.known && loan?.monthlyTaxEscrow != null && loan?.monthlyInsuranceEscrow != null;

    const metrics: PropertyMetrics = computePropertyMetrics({ property: p, loan, noi: noiByProperty[p.id] });

    return { property: p, entity, loan, pm, underwriting, equity, currentRent, rentIsEstimate, rentSource, monthlyPiti, pitiComplete, metrics };
  });

  // "under_contract" properties (e.g. 615 Cherry) are pending acquisitions,
  // not real estate holdings yet — kept out of the portfolio entirely, shown
  // in their own section. Personal residence is excluded from the seed
  // entirely, but this filter stays as a defensive backstop.
  const rentalRows = rows.filter((r) => r.property.status !== "personal_residence" && r.property.status !== "under_contract");
  const pendingRows = rows.filter((r) => r.property.status === "under_contract");

  const totalValue = rentalRows.reduce((sum, r) => sum + (r.property.currentEstValue ?? 0), 0);
  const totalDebt = rentalRows.reduce((sum, r) => sum + (r.loan?.currentBalance ?? 0), 0);
  const totalEquity = totalValue - totalDebt;

  // Portfolio totals above are 100% of every property regardless of who
  // owns what — accurate for "how big is the whole portfolio" but not the
  // same as what Patrick & Gina actually own, since B2 Partners LLC is
  // split 50/50 with Mike Bogan. This weights each property's value/debt by
  // the household's actual ownership % of its entity (from
  // entity_ownerships, not hardcoded — 100% everywhere except B2 Partners).
  const householdPctByEntity = await getHouseholdPctByEntity();
  const householdValue = rentalRows.reduce((sum, r) => {
    const pct = r.entity ? (householdPctByEntity[r.entity.id] ?? 100) : 100;
    return sum + (r.property.currentEstValue ?? 0) * (pct / 100);
  }, 0);
  const householdDebt = rentalRows.reduce((sum, r) => {
    const pct = r.entity ? (householdPctByEntity[r.entity.id] ?? 100) : 100;
    return sum + (r.loan?.currentBalance ?? 0) * (pct / 100);
  }, 0);
  const householdEquity = householdValue - householdDebt;

  return { rows, rentalRows, pendingRows, totalValue, totalDebt, totalEquity, householdValue, householdDebt, householdEquity };
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

const statusLabel: Record<string, string> = {
  under_contract: "Under Contract",
  rehab: "Rehab",
  leased: "Leased",
  vacant: "Vacant",
  personal_residence: "Personal Residence",
  sold: "Sold",
};

const statusColor: Record<string, string> = {
  under_contract: "bg-amber-100 text-amber-800",
  rehab: "bg-orange-100 text-orange-800",
  leased: "bg-emerald-100 text-emerald-800",
  vacant: "bg-zinc-100 text-zinc-700",
  personal_residence: "bg-sky-100 text-sky-800",
  sold: "bg-zinc-200 text-zinc-600",
};

export default async function Home() {
  const { rentalRows, pendingRows, totalValue, totalDebt, totalEquity, householdValue, householdDebt, householdEquity } = await getPortfolio();
  const hasOutsidePartner = Math.round(householdEquity) !== Math.round(totalEquity);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PageHeader title="BLT Portfolio" subtitle="Bogan-Rhineberger rental portfolio — property-level performance" />

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-10">
        {/* Rollup — whole-portfolio totals (100% of every property) */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Total Portfolio (100%)</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Rental Properties</div>
              <div className="mt-1 text-2xl font-semibold">{rentalRows.length}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Est. Portfolio Value</div>
              <div className="mt-1 text-2xl font-semibold">{fmt(totalValue)}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Total Debt</div>
              <div className="mt-1 text-2xl font-semibold">{fmt(totalDebt)}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Portfolio Equity</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-700">{fmt(totalEquity)}</div>
            </div>
          </div>
        </section>

        {/* Household share — same totals, weighted by Patrick & Gina's actual
            ownership % of each entity (100% everywhere except B2 Partners
            LLC, split 50/50 with Mike Bogan). This is the number that
            answers "what do we actually own," as distinct from the
            whole-portfolio totals above. */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-700">Patrick &amp; Gina&apos;s Share</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Value</div>
              <div className="mt-1 text-2xl font-semibold">{fmt(householdValue)}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Debt</div>
              <div className="mt-1 text-2xl font-semibold">{fmt(householdDebt)}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Equity</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-700">{fmt(householdEquity)}</div>
            </div>
          </div>
          {hasOutsidePartner && (
            <p className="mt-2 text-sm text-zinc-500">
              Differs from the portfolio totals above because B2 Partners LLC is split 50/50 with Mike Bogan — this row backs that 50% out. See <a href="/b2-partners" className="underline">B2 Partners</a> for the full breakdown.
            </p>
          )}
        </section>

        {/* Properties */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Properties</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Address</th>
                  <th className="px-4 py-2">Entity</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">PM</th>
                  <th className="px-4 py-2 text-right">Value</th>
                  <th className="px-4 py-2 text-right">Debt</th>
                  <th className="px-4 py-2 text-right">Equity</th>
                  <th className="px-4 py-2 text-right">Monthly Rent</th>
                  <th className="px-4 py-2 text-right">Monthly PITI</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rentalRows.map(({ property, entity, loan, pm, equity, currentRent, rentSource, monthlyPiti, pitiComplete }) => (
                  <Link key={property.id} href={`/property/${property.id}`} className="table-row hover:bg-zinc-50">
                    <td className="px-4 py-2 font-medium">
                      {property.address}
                      <div className="text-xs text-zinc-400">{property.propertyType}</div>
                    </td>
                    <td className="px-4 py-2 text-zinc-600">{entity?.name ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[property.status] ?? "bg-zinc-100 text-zinc-700"}`}>
                        {statusLabel[property.status] ?? property.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-zinc-600">{pm?.name ?? "None"}</td>
                    <td className="px-4 py-2 text-right">{fmt(property.currentEstValue)}</td>
                    <td className="px-4 py-2 text-right">{fmt(loan?.currentBalance)}</td>
                    <td className="px-4 py-2 text-right font-medium text-emerald-700">{fmt(equity)}</td>
                    <td className="px-4 py-2 text-right">
                      {fmt(currentRent)}
                      {rentSource === "estimate" && <div className="text-xs font-normal text-amber-600">est.</div>}
                      {rentSource === "lease" && <div className="text-xs font-normal text-zinc-400">lease</div>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {monthlyPiti === null ? "—" : (
                        <>
                          {fmt(monthlyPiti)}
                          {!pitiComplete && <div className="text-xs font-normal text-amber-600">partial</div>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-300">&rsaquo;</td>
                  </Link>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Monthly Rent prefers the most recent PM statement rent transaction, falling back to the current lease (marked &quot;lease&quot;) and then the VARE underwriting projection (marked &quot;est.&quot;) when neither exists yet — blank means none of the three exists. PM column shows &quot;None&quot; when no property manager is assigned.
            Click a property for NOI, cap rate, cash-on-cash, appreciation, lease/tenant details, per-unit rent, and maintenance/capex history.
          </p>
        </section>

        {/* Pending acquisitions — not real estate holdings yet, kept separate from the portfolio */}
        {pendingRows.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Pending Acquisitions</h2>
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">Address</th>
                    <th className="px-4 py-2">Will Belong To</th>
                    <th className="px-4 py-2">Target Close</th>
                    <th className="px-4 py-2 text-right">Purchase Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {pendingRows.map(({ property, entity }) => (
                    <tr key={property.id}>
                      <td className="px-4 py-2 font-medium">
                        {property.address}
                        <div className="text-xs text-zinc-400">{property.propertyType}</div>
                      </td>
                      <td className="px-4 py-2 text-zinc-600">{entity?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-zinc-600">{property.targetCloseDate ?? "—"}</td>
                      <td className="px-4 py-2 text-right">{fmt(property.purchasePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
