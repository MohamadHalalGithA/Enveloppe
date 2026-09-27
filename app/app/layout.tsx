import Link from "next/link";
import { auth0 } from "@/lib/auth/auth0";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const session = await auth0.getSession();
  const firstName = typeof session?.user?.given_name === "string" ? session.user.given_name : null;
  return (
    <>
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/app" className="text-xl font-bold">
            Enveloppe
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {firstName && <span className="text-slate-600">Signed in as {firstName}</span>}
            {/* Full navigation: logout is handled by the Auth0 SDK and returns to an allowlisted URL. */}
            <a href="/auth/logout" className="font-semibold text-sky-800 underline">
              Sign out
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
