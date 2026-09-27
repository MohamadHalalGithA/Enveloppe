import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enveloppe",
  description: "Check government letters against trusted sources and track what to do next.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request so each gets its own CSP nonce (proxy.ts); static pages can't carry one.
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
