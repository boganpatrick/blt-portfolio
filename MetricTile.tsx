import type { ReactNode } from "react";

// A stat tile that reveals a plain-English explainer on hover/focus — pure
// CSS, no client JS needed. When given a `breakdown`, the tile also becomes
// clickable: it expands to show the actual numbers that particular
// instance's value was built from. The expand/collapse is a native
// <details>/<summary> element rather than anything scripted, so the
// browser handles the click and open/closed state for free, including
// keyboard and screen-reader support.
export function MetricTile({
  label,
  value,
  sublabel,
  tooltip,
  breakdown,
  valueClassName,
  highlight,
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tooltip: string;
  breakdown?: ReactNode;
  valueClassName?: string;
  highlight?: boolean;
}) {
  const border = highlight ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white";
  const body = (
    <>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClassName ?? ""}`}>{value}</div>
      {sublabel && <div className="text-xs font-normal text-zinc-400">{sublabel}</div>}
      <div className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-56 rounded-md bg-zinc-900 px-3 py-2 text-xs leading-snug text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
        {tooltip}
      </div>
    </>
  );

  // No underlying numbers to show — just a plain hoverable tile, same as
  // before.
  if (!breakdown) {
    return (
      <div
        tabIndex={0}
        title={tooltip}
        className={`group relative cursor-help rounded-lg border p-4 outline-none ${border}`}
      >
        {body}
      </div>
    );
  }

  // Has a breakdown — the whole tile is a native disclosure: click (or
  // Enter/Space when focused) toggles it. Defaults open (per Patrick,
  // 2026-09-08 — better for iterative review) but stays a plain
  // uncontrolled <details> so the browser handles collapse/re-expand on
  // click with zero JS; `open` here only sets the initial state.
  return (
    <details open className={`group rounded-lg border p-4 ${border}`}>
      <summary
        title={tooltip}
        className="relative -m-4 cursor-pointer list-none p-4 outline-none marker:hidden [&::-webkit-details-marker]:hidden"
      >
        {body}
      </summary>
      <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-600">
        {breakdown}
      </div>
    </details>
  );
}

// One "label: value" row inside a tile's expanded breakdown.
export function BreakdownRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-700">{value}</span>
    </div>
  );
}
