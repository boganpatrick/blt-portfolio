import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REPP",
  description: "REPP (Real Estate Portfolio Performance) — Bogan-Rhineberger rental portfolio manager",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
