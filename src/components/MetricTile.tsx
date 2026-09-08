import type { ReactNode } from "react";

// A stat tile that reveals an explainer on hover (or keyboard focus) —
// pure CSS (group-hover/group-focus), no client JS needed. Hovering
// anywhere on the tile works, not just a small icon, so there's nothing
// extra to render — just tab to it or mouse over it. Used anywhere a
// number needs "what is this and how is it calculated" context: the
// property page's Financial Summary grid, and Monthly PITI wherever shown.
export function MetricTile({
  label,
  value,
  sublabel,
  tooltip,
  valueClassName,
  highlight,
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tooltip: string;
  valueClassName?: string;
  highlight?: boolean;
}) {
  return (
    <div
      tabIndex={0}
      aria-label={tooltip}
      className={`group relative cursor-help rounded-lg border p-4 outline-none ${highlight ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white"}`}
    >
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClassName ?? ""}`}>{value}</div>
      {sublabel && <div className="text-xs font-normal text-zinc-400">{sublabel}</div>}
      <div className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-56 rounded-md bg-zinc-900 px-3 py-2 text-xs leading-snug text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100">
        {tooltip}
      </div>
    </div>
  );
}
