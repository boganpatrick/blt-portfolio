import { db } from "@/db/client";
import { properties, propertyOwnerships, loans, capitalContributions } from "@/db/schema";
import { isNull, eq } from "drizzle-orm";
import { PageHeader } from "@/components/PageNav";
import { getEntityByName, getCurrentOwnershipsByEntity, getNoiByProperty, computePropertyMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

async function getB2Data() {
  const b2 = await getEntityByName("B2 Partners LLC");
  if (!b2) return null;

  const currentOwnerships = await db.select().from(propertyOwnerships).where(isNull(propertyOwnerships.endDate));
  const b2PropertyIds = currentOwnerships.filter((o) => o.entityId === b2.id).map((o) => o.propertyId);
  const allProps = await db.select().from(properties);
  const b2Properties = allProps.filter((p) => b2PropertyIds.includes(p.id));
  const allLoans = await db.select().from(loans);
  const noiByProperty = await getNoiByProperty();
  const ownershipsByEntity = await getCurrentOwnershipsByEntity();
  const ownerships = ownershipsByEntity[b2.id] ?? [];

  let value = 0, debt = 0, annualNoi = 0, noiMonths = 0;
  for (const p of b2Properties) {
    const loan = allLoans.find((l) => l.propertyId === p.id);
    const metrics = computePropertyMetrics({ property: p, loan, noi: noiByProperty[p.id] });
    value += p.currentEstValue ?? 0;
    debt += loan?.currentBalance ?? 0;
    if (metrics.noiMonthlyAvg !== null) {
      annualNoi += metrics.noiMonthlyAvg * 12;
      noiMonths = Math.max(noiMonths, metrics.noiMonths);
    }
  }
  const equity = value - debt;

  // Capital stack: Acquisition Cash (funded by Mike Bogan as Capital
  // Partner) vs Rehab Cash (funded 50/50 by Patrick+Gina as the
  // Bogan-Rhineberger Household, Operating Partners), per the B2 Partners
  // operating agreement — tracked per property until each property's first
  // refinance, per QuickBooks transactions.
  const contributions = await db.select().from(capitalContributions).where(eq(capitalContributions.entityId, b2.id));
  const propById = Object.fromEntries(allProps.map((p) => [p.id, p]));
  const byProperty: Record<string, { acquisition: number; rehab: number; unclassified: number }> = {};
  let unmatchedRehab = 0, needsCleanupTotal = 0, needsCleanupCount = 0;
  for (const c of contributions) {
    if (c.needsQboCleanup) { needsCleanupTotal += c.amount; needsCleanupCount += 1; }
    const propName = c.propertyId ? propById[c.propertyId]?.address : undefined;
    if (propName) {
      if (!byProperty[propName]) byProperty[propName] = { acquisition: 0, rehab: 0, unclassified: 0 };
      if (c.stackType === "acquisition") byProperty[propName].acquisition += c.amount;
      else if (c.stackType === "rehab") byProperty[propName].rehab += c.amount;
      else byProperty[propName].unclassified += c.amount;
    } else if (c.stackType === "rehab") {
      unmatchedRehab += c.amount;
    }
  }
  const totalAcquisition = Object.values(byProperty).reduce((s, v) => s + v.acquisition, 0);
  const totalRehab = Object.values(byProperty).reduce((s, v) => s + v.rehab, 0) + unmatchedRehab;

  return {
    entity: b2, properties: b2Properties.length, value, debt, equity, annualNoi, noiMonths,
    ownerships, byProperty, unmatchedRehab, needsCleanupTotal, needsCleanupCount,
    totalAcquisition, totalRehab,
  };
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default async function B2PartnersPage() {
  const data = await getB2Data();

  if (!data) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <PageHeader title="B2 Partners" subtitle="Our only outside partnership" />
        <main className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-sm text-zinc-500">B2 Partners LLC not found.</p>
        </main>
      </div>
    );
  }

  const { entity, properties: propCount, value, debt, equity, annualNoi, noiMonths, ownerships, byProperty, unmatchedRehab, needsCleanupTotal, needsCleanupCount, totalAcquisition, totalRehab } = data;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PageHeader title="B2 Partners" subtitle="Our only outside partnership — Mike Bogan and Patrick/Gina, split 50/50" />

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-10">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Properties</div>
            <div className="mt-1 text-2xl font-semibold">{propCount}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Value</div>
            <div className="mt-1 text-2xl font-semibold">{fmt(value)}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Debt</div>
            <div className="mt-1 text-2xl font-semibold">{fmt(debt)}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Equity</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-700">{fmt(equity)}</div>
          </div>
        </section>

        {/* Ownership split — everything here is 50/50 Mike / Household */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Ownership Split</h2>
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Owner</th>
                  <th className="px-4 py-2 text-right">Ownership %</th>
                  <th className="px-4 py-2 text-right">Equity Share</th>
                  {noiMonths > 0 && <th className="px-4 py-2 text-right">Annual NOI Share</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {ownerships.map((o) => (
                  <tr key={o.ownerId}>
                    <td className="px-4 py-2 font-medium">{o.ownerName}</td>
                    <td className="px-4 py-2 text-right">{o.percent}%</td>
                    <td className="px-4 py-2 text-right font-medium text-emerald-700">{fmt(equity * (o.percent / 100))}</td>
                    {noiMonths > 0 && <td className="px-4 py-2 text-right">{fmt(annualNoi * (o.percent / 100))}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {noiMonths > 0 && (
            <p className="mt-2 text-sm text-zinc-500">Annual NOI ({fmt(annualNoi)}) is annualized from {noiMonths} month{noiMonths === 1 ? "" : "s"} of actual PM statement activity.</p>
          )}
        </section>

        {/* B2 Partners Acquisition Stack (Mike) vs Rehab Stack (household) — from QBO transactions */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Capital Stack (from QuickBooks)</h2>
          <p className="mb-3 text-sm text-zinc-500">
            Pre-refinance: Acquisition Cash is funded by Mike Bogan (Capital Partner); Rehab Cash is funded 50/50 by Patrick &amp; Gina, tracked here as the Bogan-Rhineberger Household (Operating Partners). Post-refinance, ownership reverts to the standard split shown above.
          </p>
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Property</th>
                  <th className="px-4 py-2 text-right">Acquisition Stack (Mike)</th>
                  <th className="px-4 py-2 text-right">Rehab Stack (Household)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {Object.entries(byProperty).map(([name, s]) => (
                  <tr key={name}>
                    <td className="px-4 py-2 font-medium">{name}</td>
                    <td className="px-4 py-2 text-right">{s.acquisition ? fmt(Math.abs(s.acquisition)) : "—"}</td>
                    <td className="px-4 py-2 text-right">{s.rehab ? fmt(Math.abs(s.rehab)) : "—"}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-4 py-2 font-medium text-zinc-500">Rehab spend not matched to a specific property</td>
                  <td className="px-4 py-2 text-right">—</td>
                  <td className="px-4 py-2 text-right">{fmt(Math.abs(unmatchedRehab))}</td>
                </tr>
                <tr className="font-medium">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">{fmt(Math.abs(totalAcquisition))}</td>
                  <td className="px-4 py-2 text-right">{fmt(Math.abs(totalRehab))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-amber-700">
            {needsCleanupCount} transaction{needsCleanupCount === 1 ? "" : "s"} totaling {fmt(Math.abs(needsCleanupTotal))} still need categorizing/posting in QuickBooks itself. The stack totals above already reflect Patrick&apos;s confirmation of the 1339 Division St acquisition wire ($136,043, per the ALTA settlement statement) even though QuickBooks hasn&apos;t been updated to match yet.
          </p>
        </section>
      </main>
    </div>
  );
}
