import type { ReactNode } from "react";

// A stat tile with a small "?" affordance that reveals an explainer on
// hover — pure CSS (group-hover), no client JS needed. Used anywhere a
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
    <div className={`group relative rounded-lg border p-4 ${highlight ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white"}`}>
      <div className="flex items-center gap-1">
        <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
        <span
          tabIndex={0}
          className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-zinc-300 text-[10px] leading-none text-zinc-400"
          aria-label={tooltip}
        >
          ?
        </span>
      </div>
      <div className={`mt-1 text-xl font-semibold ${valueClassName ?? ""}`}>{value}</div>
      {sublabel && <div className="text-xs font-normal text-zinc-400">{sublabel}</div>}
      <div className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-56 rounded-md bg-zinc-900 px-3 py-2 text-xs leading-snug text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
        {tooltip}
      </div>
    </div>
  );
}
