import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-bold">Enveloppe</h1>
      <p className="text-xl">
        Photograph a government letter. Enveloppe checks it against trusted government information and your
        existing cases, tells you what needs to happen next, and tracks it until it&apos;s done.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/demo" className="rounded-lg bg-sky-800 px-5 py-3 text-lg font-semibold text-white transition-colors hover:bg-sky-900">
          See the demo (no sign-in)
        </Link>
        {/* Plain link on purpose: /app redirects to Auth0 sign-in, which needs a full page navigation. */}
        <a href="/app" className="rounded-lg border-2 border-sky-800 px-5 py-3 text-lg font-semibold text-sky-900 transition-colors hover:bg-sky-50">
          Sign in to my Civic Inbox
        </a>
      </div>
    </main>
  );
}
