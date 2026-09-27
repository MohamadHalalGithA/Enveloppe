"use client";

import Link from "next/link";

/** Never shows error details (they could contain internals); offers a retry instead. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="flex flex-col gap-3 rounded-xl border-2 border-red-700 bg-red-50 p-4 text-red-950">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p>Your letters are safe. Please try again.</p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="rounded-lg bg-red-800 px-4 py-2 font-semibold text-white">
          Try again
        </button>
        <Link href="/app" className="self-center underline">
          Back to Civic Inbox
        </Link>
      </div>
    </section>
  );
}
