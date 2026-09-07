import { db } from "@/db/client";
import { pmReports, entities, propertyManagers, pmReportLineItems } from "@/db/schema";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/PageNav";

export const dynamic = "force-dynamic";

async function getPmReports() {
  const reports = await db.select().from(pmReports).orderBy(desc(pmReports.periodEnd));
  const allEntities = await db.select().from(entities);
  const allPms = await db.select().from(propertyManagers);
  const entityById = Object.fromEntries(allEntities.map((e) => [e.id, e]));
  const pmById = Object.fromEntries(allPms.map((p) => [p.id, p]));

  const lineItems = await db.select().from(pmReportLineItems);
  const unmappedCount = lineItems.filter((li) => !li.normalizedCategoryId).length;

  const rows = reports.map((r) => ({
    report: r,
    entity: r.entityId ? entityById[r.entityId] : undefined,
    pm: pmById[r.pmId],
  }));

  return { rows, totalLineItems: lineItems.length, unmappedCount };
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default async function PmStatementsPage() {
  const pmReportData = await getPmReports();

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PageHeader title="PM Statements Imported" subtitle="What property manager data has been loaded — reference only" />

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-10">
        {pmReportData.rows.length > 0 ? (
          <section>
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">Entity</th>
                    <th className="px-4 py-2">PM</th>
                    <th className="px-4 py-2">Period</th>
                    <th className="px-4 py-2 text-right">Income</th>
                    <th className="px-4 py-2 text-right">Expenses</th>
                    <th className="px-4 py-2 text-right">Ending Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {pmReportData.rows.map(({ report, entity, pm }) => (
                    <tr key={report.id}>
                      <td className="px-4 py-2 font-medium">{entity?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-zinc-600">{pm.name}</td>
                      <td className="px-4 py-2 text-zinc-600">{report.periodStart} – {report.periodEnd}</td>
                      <td className="px-4 py-2 text-right">{fmt(report.totalIncome)}</td>
                      <td className="px-4 py-2 text-right">{fmt(report.totalExpenses)}</td>
                      <td className="px-4 py-2 text-right">{fmt(report.endingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              {pmReportData.totalLineItems} line items imported across {pmReportData.rows.length} statement{pmReportData.rows.length === 1 ? "" : "s"}
              {pmReportData.unmappedCount > 0
                ? `, ${pmReportData.unmappedCount} with a category the app couldn't map yet (still imported, just uncategorized).`
                : ", all categorized against the normalized chart of accounts."}
              {" "}Only the sample statements shared so far — this is the pipeline, not the full history; run <code>npx tsx src/db/import-pm-reports.ts</code> after adding more statements to <code>data/raw/</code>.
            </p>
          </section>
        ) : (
          <p className="text-sm text-zinc-500">No PM statements imported yet.</p>
        )}
      </main>
    </div>
  );
}
