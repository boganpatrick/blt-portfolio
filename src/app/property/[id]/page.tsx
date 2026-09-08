import { db } from "@/db/client";
import {
  properties, propertyOwnerships, entities, loans, propertyPmAssignments,
  propertyManagers, underwritingModels, units, leases, maintenanceEvents,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/PageNav";
import { MetricTile, BreakdownRow } from "@/components/MetricTile";
import {
  getCurrentRentDetailByProperty, getNoiByProperty, computePropertyMetrics,
  monthlyPrincipalAndInterest, resolveCurrentRent, METRIC_TOOLTIPS,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";

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

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function pct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24));
}
function tenure(startDate: string | null) {
  if (!startDate) return null;
  const days = daysBetween(new Date().toISOString().slice(0, 10), startDate);
  if (days < 0) return null;
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years === 0) return `${months} mo`;
  return months === 0 ? `${years} yr` : `${years} yr ${months} mo`;
}
function daysUntil(endDate: string | null) {
  if (!endDate) return null;
  return daysBetween(endDate, new Date().toISOString().slice(0, 10));
}

// Best-effort classification of maintenance_events into "major systems" by
// keyword match on category/description — the underlying data is 86 rows
// of free-text renovation-tab line items (mostly from the initial rehab,
// mostly undated), not a structured systems log, so this is a helper for
// surfacing what's on file, not a reliable "age of HVAC" fact. Anything
// undated is flagged as such rather than guessed at.
const SYSTEM_PATTERNS: { key: string; label: string; re: RegExp }[] = [
  { key: "roof", label: "Roof", re: /\broof/i },
  { key: "hvac", label: "HVAC / Furnace", re: /\bhvac\b|furnace|air condition|\bac\b/i },
  { key: "water_heater", label: "Water Heater", re: /water heater|hot water/i },
];

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [property] = await db.select().from(properties).where(eq(properties.id, id));
  if (!property) notFound();

  const ownerships = await db.select().from(propertyOwnerships).where(eq(propertyOwnerships.propertyId, id));
  const ownership = ownerships.find((o) => !o.endDate) ?? ownerships[0];
  const entity = ownership ? (await db.select().from(entities).where(eq(entities.id, ownership.entityId)))[0] : undefined;
  const [loan] = await db.select().from(loans).where(eq(loans.propertyId, id));
  const pmAssignments = await db.select().from(propertyPmAssignments).where(eq(propertyPmAssignments.propertyId, id));
  const currentPmAssignment = pmAssignments.find((a) => !a.endDate);
  const pm = currentPmAssignment ? (await db.select().from(propertyManagers).where(eq(propertyManagers.id, currentPmAssignment.pmId)))[0] : undefined;
  const [underwriting] = await db.select().from(underwritingModels).where(eq(underwritingModels.propertyId, id));
  const propertyUnits = await db.select().from(units).where(eq(units.propertyId, id));
  const allLeases = await db.select().from(leases);
  const leasesByUnit: Record<string, typeof allLeases> = {};
  for (const l of allLeases) (leasesByUnit[l.unitId] ??= []).push(l);
  const events = await db.select().from(maintenanceEvents).where(eq(maintenanceEvents.propertyId, id));

  const noiByProperty = await getNoiByProperty();
  const rentDetail = (await getCurrentRentDetailByProperty())[id];
  const metrics = computePropertyMetrics({ property, loan, noi: noiByProperty[id], underwriting });

  const debt = loan?.currentBalance ?? 0;
  const value = property.currentEstValue ?? 0;
  const equity = property.status === "personal_residence" || property.status === "under_contract" ? null : value - debt;

  const pAndI = monthlyPrincipalAndInterest(loan);
  const hasAnyPitiInput = (pAndI.known && pAndI.value > 0) || loan?.monthlyTaxEscrow != null || loan?.monthlyInsuranceEscrow != null;
  const monthlyPiti = hasAnyPitiInput ? pAndI.value + (loan?.monthlyTaxEscrow ?? 0) + (loan?.monthlyInsuranceEscrow ?? 0) : null;
  const pitiComplete = pAndI.known && loan?.monthlyTaxEscrow != null && loan?.monthlyInsuranceEscrow != null;

  const activeLeases = propertyUnits
    .map((u) => (leasesByUnit[u.id] ?? []).filter((l) => l.status !== "ended").sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0])
    .filter((l): l is typeof allLeases[number] => !!l);
  const leaseRentTotal = activeLeases.reduce((sum, l) => sum + (l.rentAmount ?? 0) + (l.petRent ?? 0), 0);
  const mostRecentLeaseStart = activeLeases.length > 0
    ? activeLeases.reduce((max, l) => ((l.startDate ?? "") > max ? (l.startDate ?? "") : max), activeLeases[0].startDate ?? "") || null
    : null;
  // Same resolution rule as the main dashboard (see resolveCurrentRent in
  // src/lib/metrics.ts): don't trust a PM statement's rent figure when it
  // falls in the same calendar month a lease started — that's almost
  // always a prorated partial-month payment, not the real monthly rent.
  const { amount: currentRent, source: rentSource } = resolveCurrentRent({
    pmRent: rentDetail ? { amount: rentDetail.amount, asOf: rentDetail.asOf } : undefined,
    leaseRent: leaseRentTotal || null,
    mostRecentLeaseStart,
    estimateRent: underwriting?.projectedMonthlyRent ?? null,
  });

  const capexEvents = events.filter((e) => e.isCapex).sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""));
  const maintenanceOnlyEvents = events.filter((e) => !e.isCapex).sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""));
  const totalCapex = capexEvents.reduce((sum, e) => sum + (e.cost ?? 0), 0);
  const totalMaintenance = maintenanceOnlyEvents.reduce((sum, e) => sum + (e.cost ?? 0), 0);

  const systems = SYSTEM_PATTERNS.map((sys) => {
    const matches = events.filter((e) => sys.re.test(e.category) || (e.description && sys.re.test(e.description)));
    const dated = matches.filter((e) => e.eventDate).sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""));
    return { ...sys, matches, mostRecentDated: dated[0] };
  });

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PageHeader title={property.address} subtitle={`${property.propertyType ?? ""} — ${entity?.name ?? "Unassigned"}`} />

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-10">
        <Link href="/" className="text-sm text-zinc-500 underline">&larr; Back to dashboard</Link>

        <section className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColor[property.status] ?? "bg-zinc-100 text-zinc-700"}`}>
            {statusLabel[property.status] ?? property.status}
          </span>
          <span className="text-sm text-zinc-500">{pm ? `Managed by ${pm.name}` : "No property manager assigned"}</span>
        </section>

        {/* Acquisition & current value — the key facts up front, shown
            above the metric tiles. Unlike those, this card doesn't expand;
            it's not a computed metric, just the two numbers worth seeing
            first. */}
        <section>
          <div
            title="Purchase price/date and current estimated value."
            className="grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2"
          >
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">Purchased</div>
              <div className="mt-1 text-xl font-semibold">{fmt(property.purchasePrice)}</div>
              <div className="text-xs font-normal text-zinc-400">{property.purchaseDate ?? "—"}</div>
            </div>
            <div className="sm:border-l sm:border-zinc-100 sm:pl-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Current Value</div>
              <div className="mt-1 text-xl font-semibold">{fmt(property.currentEstValue)}</div>
              <div className="text-xs font-normal text-zinc-400">
                {property.currentValueAsOf ? `as of ${property.currentValueAsOf}` : property.currentValueSource ?? "—"}
              </div>
            </div>
          </div>
        </section>

        {/* Financial summary — every tile is expanded by default to show
            the actual numbers it was built from; click a tile to collapse
            it, click again to bring it back. */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Financial Summary</h2>
          <p className="mb-3 text-xs text-zinc-400">Hover any tile for what it means; click a tile to collapse or expand the numbers behind it.</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricTile
              label="Debt / Equity"
              value={fmt(equity)}
              valueClassName="text-emerald-700"
              sublabel="equity"
              tooltip={METRIC_TOOLTIPS.debtEquity}
              breakdown={
                <>
                  <BreakdownRow label="Value" value={fmt(value)} />
                  <BreakdownRow label="− Debt" value={fmt(debt)} />
                  <BreakdownRow label="= Equity" value={fmt(equity)} />
                  <BreakdownRow label="Leverage (loan-to-value)" value={metrics.leveragePct !== null ? pct(metrics.leveragePct) : "—"} />
                  {loan && (
                    <>
                      <BreakdownRow label="Lender" value={loan.lender ?? "—"} />
                      <BreakdownRow label="Balance as of" value={loan.balanceAsOf ?? "—"} />
                      <BreakdownRow label="Original loan amount" value={fmt(loan.originalAmount)} />
                      <BreakdownRow label="Rate" value={loan.rate != null ? pct(loan.rate) : "—"} />
                    </>
                  )}
                  {!loan && <BreakdownRow label="No loan on file" value="cash purchase" />}
                </>
              }
            />
            <MetricTile
              label="Monthly Rent"
              value={fmt(currentRent)}
              tooltip={METRIC_TOOLTIPS.monthlyRent}
              breakdown={
                <>
                  <BreakdownRow
                    label="Source used"
                    value={rentSource === "pm" ? "PM statement" : rentSource === "lease" ? "lease" : rentSource === "estimate" ? "VARE estimate" : "none"}
                  />
                  {rentSource === "pm" && rentDetail && (
                    <>
                      {rentDetail.byLabel.map((b) => <BreakdownRow key={b.label} label={b.label} value={fmt(b.amount)} />)}
                      <BreakdownRow label="As of" value={rentDetail.asOf} />
                    </>
                  )}
                  {rentSource === "lease" && activeLeases.map((l) => (
                    <BreakdownRow key={l.id} label={l.tenantName ?? "(no tenant on file)"} value={fmt((l.rentAmount ?? 0) + (l.petRent ?? 0))} />
                  ))}
                  {rentSource === "estimate" && <BreakdownRow label="VARE projected rent" value={fmt(underwriting?.projectedMonthlyRent)} />}
                  {rentSource === null && <BreakdownRow label="No rent source on file" value="—" />}
                </>
              }
            />
            <MetricTile
              label="Monthly PITI"
              value={fmt(monthlyPiti)}
              sublabel={monthlyPiti !== null && !pitiComplete ? <span className="text-amber-600">partial</span> : undefined}
              tooltip={METRIC_TOOLTIPS.monthlyPiti}
              breakdown={loan ? (
                <>
                  <BreakdownRow label="Principal & Interest" value={pAndI.known ? fmt(pAndI.value) : "not enough loan data"} />
                  <BreakdownRow label="Tax escrow" value={fmt(loan.monthlyTaxEscrow)} />
                  <BreakdownRow label="Insurance escrow" value={fmt(loan.monthlyInsuranceEscrow)} />
                  <BreakdownRow label="= Monthly PITI" value={fmt(monthlyPiti)} />
                </>
              ) : (
                <BreakdownRow label="No loan on file" value="cash purchase" />
              )}
            />
            <MetricTile
              label="Monthly Op Ex"
              value={fmt(metrics.opexMonthlyAvg)}
              sublabel={metrics.opexMonthlyAvg !== null ? `${metrics.noiMonths}mo avg` : undefined}
              tooltip={METRIC_TOOLTIPS.opex}
              breakdown={metrics.opexMonthlyAvg !== null ? (
                <>
                  <BreakdownRow label="Averaged over" value={`${metrics.noiMonths} statement month${metrics.noiMonths === 1 ? "" : "s"}`} />
                  <BreakdownRow label="Since in service" value={property.putIntoServiceDate ?? "purchase"} />
                  <BreakdownRow label="Total over that span" value={fmt(metrics.opexMonthlyAvg * metrics.noiMonths)} />
                </>
              ) : (
                <BreakdownRow label="No PM statement data yet" value="—" />
              )}
            />
            <MetricTile
              label="NOI/mo"
              value={fmt(metrics.noiMonthlyAvg)}
              sublabel={metrics.noiIsProjected ? <span className="text-amber-600">projected</span> : metrics.noiMonthlyAvg !== null ? `${metrics.noiMonths}mo avg` : undefined}
              tooltip={METRIC_TOOLTIPS.noi}
              breakdown={
                metrics.noiIsProjected ? (
                  <>
                    <BreakdownRow label="VARE projected rent" value={fmt(underwriting?.projectedMonthlyRent)} />
                    <BreakdownRow label="− Vacancy" value={pct(underwriting?.vacancyPct)} />
                    <BreakdownRow label="− Repair" value={pct(underwriting?.repairPct)} />
                    <BreakdownRow label="− PM fee" value={pct(underwriting?.pmFeePct)} />
                    <BreakdownRow label="= Projected NOI/mo" value={fmt(metrics.noiMonthlyAvg)} />
                  </>
                ) : metrics.noiMonthlyAvg !== null ? (
                  <>
                    <BreakdownRow label="Averaged over" value={`${metrics.noiMonths} statement month${metrics.noiMonths === 1 ? "" : "s"}`} />
                    <BreakdownRow label="Since in service" value={property.putIntoServiceDate ?? "purchase"} />
                    <BreakdownRow label="Total (income − opex) over that span" value={fmt(metrics.noiMonthlyAvg * metrics.noiMonths)} />
                  </>
                ) : (
                  <BreakdownRow label="No PM statement or underwriting data yet" value="—" />
                )
              }
            />
            <MetricTile
              label="Cap Rate"
              value={pct(metrics.capRate)}
              sublabel={metrics.noiIsProjected && metrics.capRate !== null ? <span className="text-amber-600">projected</span> : undefined}
              tooltip={METRIC_TOOLTIPS.capRate}
              highlight
              breakdown={metrics.capRate !== null ? (
                <>
                  <BreakdownRow label="Annual NOI" value={fmt(metrics.annualNoi)} />
                  <BreakdownRow label={metrics.capRateValueIsArv ? "÷ Value (VARE ARV)" : "÷ Value"} value={fmt(metrics.capRateValue)} />
                  <BreakdownRow label="= Cap Rate" value={pct(metrics.capRate)} />
                </>
              ) : (
                <BreakdownRow label="Not enough data yet" value="—" />
              )}
            />
            <MetricTile
              label="Cash-on-Cash"
              value={pct(metrics.cashOnCash)}
              sublabel={metrics.noiIsProjected && metrics.cashOnCash !== null ? <span className="text-amber-600">projected</span> : undefined}
              tooltip={METRIC_TOOLTIPS.cashOnCash}
              breakdown={metrics.cashOnCash !== null ? (
                <>
                  <BreakdownRow label="Annual NOI" value={fmt(metrics.annualNoi)} />
                  <BreakdownRow label="− Annual debt service" value={fmt(metrics.annualDebtService)} />
                  <BreakdownRow label="÷ Cash invested (purchase + rehab spent)" value={fmt(metrics.cashInvested)} />
                  <BreakdownRow label="= Cash-on-Cash" value={pct(metrics.cashOnCash)} />
                </>
              ) : (
                <BreakdownRow label="Not enough data yet" value="—" />
              )}
            />
            <MetricTile
              label="DSCR"
              value={metrics.dscr === null ? "—" : metrics.dscr.toFixed(2)}
              sublabel={metrics.noiIsProjected && metrics.dscr !== null ? <span className="text-amber-600">projected</span> : undefined}
              tooltip={METRIC_TOOLTIPS.dscr}
              breakdown={metrics.dscr !== null ? (
                <>
                  <BreakdownRow label="Annual NOI" value={fmt(metrics.annualNoi)} />
                  <BreakdownRow label="÷ Annual PITI" value={fmt(metrics.annualDebtService)} />
                  <BreakdownRow label="= DSCR" value={metrics.dscr.toFixed(2)} />
                </>
              ) : (
                <BreakdownRow label="Not enough data yet" value="—" />
              )}
            />
            <MetricTile
              label="Appreciation"
              value={pct(metrics.appreciationPct)}
              tooltip={METRIC_TOOLTIPS.appreciation}
              breakdown={metrics.appreciationPct !== null ? (
                <>
                  <BreakdownRow label="Current value" value={fmt(value)} />
                  <BreakdownRow label="÷ Purchase price" value={fmt(property.purchasePrice)} />
                  <BreakdownRow label="− 1 = Appreciation" value={pct(metrics.appreciationPct)} />
                </>
              ) : (
                <BreakdownRow label="Not enough data yet" value="—" />
              )}
            />
          </div>
        </section>

        {/* Units & leases */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Units &amp; Leases</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Unit</th>
                  <th className="px-4 py-2">Bed/Bath</th>
                  <th className="px-4 py-2">Tenant</th>
                  <th className="px-4 py-2">Lease Status</th>
                  <th className="px-4 py-2 text-right">Rent</th>
                  <th className="px-4 py-2">Tenure</th>
                  <th className="px-4 py-2">Lease Ends</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {propertyUnits.length === 0 && (
                  <tr><td className="px-4 py-3 text-zinc-500" colSpan={7}>No unit records on file for this property yet.</td></tr>
                )}
                {propertyUnits.map((u) => {
                  const unitLeases = (leasesByUnit[u.id] ?? []).filter((l) => l.status !== "ended")
                    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
                  const lease = unitLeases[0];
                  const daysLeft = lease ? daysUntil(lease.endDate) : null;
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-2 font-medium">{u.label}</td>
                      <td className="px-4 py-2 text-zinc-600">{u.bedrooms ?? "—"}bd / {u.bathrooms ?? "—"}ba{u.sqft ? `, ${u.sqft} sqft` : ""}</td>
                      <td className="px-4 py-2 text-zinc-600">{lease?.tenantName ?? "—"}</td>
                      <td className="px-4 py-2 text-zinc-600">{lease?.status ?? "no lease on file"}</td>
                      <td className="px-4 py-2 text-right">{lease ? fmt((lease.rentAmount ?? 0) + (lease.petRent ?? 0)) : "—"}</td>
                      <td className="px-4 py-2 text-zinc-600">{tenure(lease?.startDate ?? null) ?? "—"}</td>
                      <td className="px-4 py-2 text-zinc-600">
                        {lease?.endDate ?? "—"}
                        {daysLeft !== null && (
                          <div className={`text-xs ${daysLeft < 60 ? "text-amber-600" : "text-zinc-400"}`}>
                            {daysLeft < 0 ? `${Math.abs(daysLeft)}d past end` : `${daysLeft}d left`}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rentDetail && rentDetail.byLabel.length > 0 && (
            <p className="mt-2 text-sm text-zinc-500">
              Most recent PM statement rent (as of {rentDetail.asOf}): {rentDetail.byLabel.map((b) => `${b.label} — ${fmt(b.amount)}`).join("; ")}.
            </p>
          )}
        </section>

        {/* Systems */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Major Systems</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {systems.map((sys) => (
              <div key={sys.key} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">{sys.label}</div>
                {sys.mostRecentDated ? (
                  <>
                    <div className="mt-1 text-sm font-medium">{sys.mostRecentDated.eventDate}</div>
                    <div className="text-xs text-zinc-500">{sys.mostRecentDated.description ?? sys.mostRecentDated.category}</div>
                  </>
                ) : sys.matches.length > 0 ? (
                  <div className="mt-1 text-sm text-amber-600">On record, but no date entered ({sys.matches.length} item{sys.matches.length === 1 ? "" : "s"})</div>
                ) : (
                  <div className="mt-1 text-sm text-zinc-400">Not tracked yet</div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Built from the maintenance/rehab history below by keyword match — most of that history is undated rehab-tab line items, not a structured systems log yet, so treat this as &quot;what&apos;s on file&quot; rather than a confirmed install date until it&apos;s filled in.
          </p>
        </section>

        {/* Rehab */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Rehab</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Budget</div>
              <div className="mt-1 text-lg font-semibold">{fmt(property.rehabBudget)}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Spent to Date</div>
              <div className="mt-1 text-lg font-semibold">{fmt(property.rehabSpentToDate)}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Rehab Complete</div>
              <div className="mt-1 text-lg font-semibold">{property.rehabCompleteDate ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">In Service Since</div>
              <div className="mt-1 text-lg font-semibold">{property.putIntoServiceDate ?? "—"}</div>
            </div>
          </div>
        </section>

        {/* CapEx history */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            CapEx History {totalCapex > 0 && <span className="font-normal text-zinc-400">({fmt(totalCapex)} total)</span>}
          </h2>
          {capexEvents.length === 0 ? (
            <p className="text-sm text-zinc-500">No capex line items on file.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {capexEvents.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-2 text-zinc-600">{e.eventDate ?? "undated"}</td>
                      <td className="px-4 py-2 font-medium">{e.category}</td>
                      <td className="px-4 py-2 text-zinc-600">{e.description ?? "—"}</td>
                      <td className="px-4 py-2 text-right">{fmt(e.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Maintenance history */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Maintenance History {totalMaintenance > 0 && <span className="font-normal text-zinc-400">({fmt(totalMaintenance)} total)</span>}
          </h2>
          {maintenanceOnlyEvents.length === 0 ? (
            <p className="text-sm text-zinc-500">No non-capex maintenance line items on file.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {maintenanceOnlyEvents.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-2 text-zinc-600">{e.eventDate ?? "undated"}</td>
                      <td className="px-4 py-2 font-medium">{e.category}</td>
                      <td className="px-4 py-2 text-zinc-600">{e.description ?? "—"}</td>
                      <td className="px-4 py-2 text-right">{fmt(e.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
