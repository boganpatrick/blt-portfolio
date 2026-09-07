import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BLT Portfolio",
  description: "Bogan-Rhineberger rental portfolio manager",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
