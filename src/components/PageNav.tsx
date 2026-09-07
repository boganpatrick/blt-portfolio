import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/llc-performance", label: "LLC Performance" },
  { href: "/b2-partners", label: "B2 Partners" },
  { href: "/pm-statements", label: "PM Statements" },
  { href: "/backlog", label: "Backlog" },
];

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-start justify-between px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50">
              Menu
            </summary>
            <nav className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="block px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </details>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
