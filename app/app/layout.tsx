import Link from "next/link";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <>
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/app" className="text-xl font-bold">
            Enveloppe
          </Link>
          <span className="text-sm text-slate-600">Demo account</span>
        </div>
      </header>
      <p role="note" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
        Mock data: synthetic letters and fixture results. Nothing here is live yet.
      </p>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
