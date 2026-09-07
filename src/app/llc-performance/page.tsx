import { db } from "@/db/client";
import {
  properties, propertyOwnerships, entities, loans, pmReportLineItems,
  normalizedCategories, pmReports,
} from "@/db/schema";
import { isNull, eq } from "drizzle-orm";
import { PageHeader } from "@/components/PageNav";
import { getCurrentOwnershipsByEntity, getNoiByProperty, computePropertyMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

async function getEntityPerformance() {
  const allProperties = await db.select().from(properties);
  const currentOwnerships = await db.select().from(propertyOwnerships).where(isNull(propertyOwnerships.endDate));
  const allEntities = await db.select().from(entities);
  const allLoans = await db.select().from(loans);
  const noiByProperty = await getNoiByProperty();
  const ownershipsByEntity = await getCurrentOwnershipsByEntity();

  // Distributions to owners (from PM statement "Owner Draw / Distribution"
  // category), grouped by the statement's entity, over however many months
  // of statements exist for that entity.
  const distributionRows = await db
    .select({
      entityId: pmReports.entityId,
      amount: pmReportLineItems.amount,
      periodEnd: pmReports.periodEnd,
    })
    .from(pmReportLineItems)
    .innerJoin(normalizedCategories, eq(pmReportLineItems.normalizedCategoryId, normalizedCategories.id))
    .innerJoin(pmReports, eq(pmReportLineItems.reportId, pmReports.id))
    .where(eq(normalizedCategories.name, "Owner Draw / Distribution"));

  const distributionsByEntity: Record<string, { total: number; periods: Set<string> }> = {};
  for (const r of distributionRows) {
    if (!r.entityId) continue;
    if (!distributionsByEntity[r.entityId]) distributionsByEntity[r.entityId] = { total: 0, periods: new Set() };
    distributionsByEntity[r.entityId].total += Math.abs(r.amount);
    distributionsByEntity[r.entityId].periods.add(r.periodEnd);
  }

  type EntityRow = {
    entity: typeof entities.$inferSelect;
    properties: number;
    value: number;
    debt: number;
    equity: number;
    annualNoi: number;
    noiMonths: number;
    capRate: number | null;
    dscr: number | null;
    cashOnCash: number | null;
    distributionsMonthlyAvg: number | null;
    ownerships: { ownerName: string; percent: number }[];
  };

  const byEntity: Record<string, EntityRow> = {};
  for (const p of allProperties) {
    if (p.status === "personal_residence" || p.status === "under_contract") continue;
    const ownership = currentOwnerships.find((o) => o.propertyId === p.id);
    const entity = ownership ? allEntities.find((e) => e.id === ownership.entityId) : undefined;
    if (!entity) continue;
    const loan = allLoans.find((l) => l.propertyId === p.id);
    const metrics = computePropertyMetrics({ property: p, loan, noi: noiByProperty[p.id] });

    if (!byEntity[entity.id]) {
      byEntity[entity.id] = {
        entity, properties: 0, value: 0, debt: 0, equity: 0, annualNoi: 0, noiMonths: 0,
        capRate: null, dscr: null, cashOnCash: null, distributionsMonthlyAvg: null,
        ownerships: (ownershipsByEntity[entity.id] ?? []).map((o) => ({ ownerName: o.ownerName, percent: o.percent })),
      };
    }
    const row = byEntity[entity.id];
    row.properties += 1;
    row.value += p.currentEstValue ?? 0;
    row.debt += loan?.currentBalance ?? 0;
    row.equity += (p.currentEstValue ?? 0) - (loan?.currentBalance ?? 0);
    if (metrics.noiMonthlyAvg !== null) {
      row.annualNoi += metrics.noiMonthlyAvg * 12;
      row.noiMonths = Math.max(row.noiMonths, metrics.noiMonths);
    }
  }

  for (const row of Object.values(byEntity)) {
    row.capRate = row.value ? row.annualNoi / row.value : null;
    const dist = distributionsByEntity[row.entity.id];
    row.distributionsMonthlyAvg = dist ? dist.total / Math.max(dist.periods.size, 1) : null;
  }

  return Object.values(byEntity).sort((a, b) => b.equity - a.equity);
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export default async function LlcPerformancePage() {
  const rows = await getEntityPerformance();
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalDebt = rows.reduce((s, r) => s + r.debt, 0);
  const totalEquity = rows.reduce((s, r) => s + r.equity, 0);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PageHeader title="LLC Performance" subtitle="Value, debt, equity, and operating performance by entity" />

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-10">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Total Value</div>
            <div className="mt-1 text-2xl font-semibold">{fmt(totalValue)}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Total Debt</div>
            <div className="mt-1 text-2xl font-semibold">{fmt(totalDebt)}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Total Equity</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-700">{fmt(totalEquity)}</div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">By Entity</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Entity</th>
                  <th className="px-4 py-2 text-right">Properties</th>
                  <th className="px-4 py-2 text-right">Value</th>
                  <th className="px-4 py-2 text-right">Debt</th>
                  <th className="px-4 py-2 text-right">Equity</th>
                  <th className="px-4 py-2 text-right">Annual NOI</th>
                  <th className="px-4 py-2 text-right">Cap Rate</th>
                  <th className="px-4 py-2 text-right">Monthly Distributions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr key={r.entity.id}>
                    <td className="px-4 py-2 font-medium">
                      {r.entity.name}
                      {r.ownerships.length > 0 && (
                        <div className="text-xs font-normal text-zinc-400">
                          {r.ownerships.map((o) => `${o.ownerName} ${o.percent}%`).join(" / ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{r.properties}</td>
                    <td className="px-4 py-2 text-right">{fmt(r.value)}</td>
                    <td className="px-4 py-2 text-right">{fmt(r.debt)}</td>
                    <td className="px-4 py-2 text-right font-medium text-emerald-700">{fmt(r.equity)}</td>
                    <td className="px-4 py-2 text-right">
                      {r.noiMonths > 0 ? (
                        <>
                          {fmt(r.annualNoi)}
                          <div className="text-xs font-normal text-zinc-400">from {r.noiMonths}mo actuals</div>
                        </>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">{pct(r.capRate)}</td>
                    <td className="px-4 py-2 text-right">{fmt(r.distributionsMonthlyAvg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Annual NOI is each property&apos;s actual monthly PM-statement income minus operating expense, averaged over however many months of statements exist and annualized (×12) — not a trailing-twelve-month figure until a full year of statements is on file. Cap Rate is Annual NOI ÷ current estimated value. Monthly Distributions is the average of actual owner draws/distributions posted in PM statements for that entity. We&apos;re holding off on a formal IRR for now — there isn&apos;t yet a clean, complete cash-flow-plus-exit-value timeline per property to make one meaningful; happy to build one in once more history is on file, or sooner if useful as a rough estimate.
          </p>
        </section>
      </main>
    </div>
  );
}
