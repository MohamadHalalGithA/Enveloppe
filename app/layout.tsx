import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enveloppe",
  description: "Check government letters against trusted sources and track what to do next.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
