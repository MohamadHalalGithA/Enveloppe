import Link from "next/link";
import { getDemoMeta } from "@/lib/demo/cache";

export default async function DemoLayout({ children }: LayoutProps<"/demo">) {
  const meta = await getDemoMeta();
  return (
    <>
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/demo" className="text-xl font-bold">
            Enveloppe
          </Link>
          <span className="text-sm text-slate-600">Demo · no sign-in</span>
        </div>
      </header>
      <p role="note" className="bg-sky-100 px-4 py-2 text-center text-sm text-sky-950">
        Demo with <strong>synthetic letters</strong>. Everything below was produced by the real pipeline (Gemini reading,
        official-source checks, case matching, deadline rules){meta ? `, as of ${meta.today}` : ""}. The readings are cached,
        and no real person&apos;s data is used.
      </p>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
