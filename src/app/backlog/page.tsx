import { PageHeader } from "@/components/PageNav";

export const dynamic = "force-dynamic";

type Item = { title: string; detail: string };

const nowNext: Item[] = [
  {
    title: "Confirm 1611 S. Washington's DSCR refi terms",
    detail: "1137 Wayne St and 738 S. Washington's loans are now confirmed against real closing packages. 1611 S. Washington's Aug-2025 DSCR refi is still a VARE-underwriting-file figure — the closing doc on file (Metro Title, 12/18/2024) is for the original bridge-loan purchase, a different loan that's since been paid off.",
  },
  {
    title: "1339 Division St cash-out refi",
    detail: "In process as of late Aug 2026, expected to close within ~30 days. Once it closes: enter real loan terms, and work out the Mike/Household split transition per the B2 Partners capital stack method.",
  },
];

const later: Item[] = [
  {
    title: "Backfill PM statement repair costs into maintenance history",
    detail: "The maintenance/rehab history dashboard view itself is done — every property's page now shows its full CapEx and Maintenance history (86 rows backfilled from the VARE Renovation tabs). What's still open: PM statement \"Repairs & Maintenance\" line items are a second real source of maintenance history and haven't been folded into that same table yet — the raw statement text often has enough detail (unit, work order #, description) to do that as a later step.",
  },
  {
    title: "BLT Partners LLC shared checking import",
    detail: "data/raw/BLT_Partners_LLC_Transaction_List_by_Date.csv (covers BLT Buckeye/BLT Washington activity) has no import pipeline yet — only one transaction has been pulled out by hand so far. Worth a proper importer mirroring import-b2-partners-capital.ts if there's more property-specific spend in there.",
  },
  {
    title: "IRR / full return metrics",
    detail: "Cap rate, cash-on-cash, and NOI are live on LLC Performance and the main dashboard, built from actual PM statement data. A formal IRR needs a complete cash-flow-plus-exit-value timeline per property, which isn't reliable yet with only a few months of statements on file — revisit once there's more history, or sooner as a rough estimate if useful.",
  },
  {
    title: "Bank balance / autopay monitoring",
    detail: "Not started.",
  },
];

const ideas: Item[] = [
  {
    title: "QuickBooks Online integration",
    detail: "Phase 2, as agreed — would replace the current manual QBO export + import scripts with a live sync.",
  },
  {
    title: "Automated property value estimation",
    detail: "Phase 2 idea — pulling Zillow/comp-based values automatically instead of manual entry.",
  },
];

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.title} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="font-medium">{item.title}</div>
            <div className="mt-1 text-sm text-zinc-600">{item.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function BacklogPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PageHeader title="Dev Backlog" subtitle="What's still open, roughly in priority order" />

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-10">
        <Section title="Now / Next" items={nowNext} />
        <Section title="Later" items={later} />
        <Section title="Ideas / Phase 2" items={ideas} />
      </main>
    </div>
  );
}
