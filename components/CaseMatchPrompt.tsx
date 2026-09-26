import Link from "next/link";
import type { CaseMatch } from "@/lib/contracts";

export function CaseMatchPrompt({ match }: { match: CaseMatch }) {
  const top = match.candidates[0];
  if (match.decision === "AUTO_LINK" && match.linkedCaseId) {
    return (
      <section className="rounded-xl border border-slate-300 p-4">
        <p>
          Added to your case{" "}
          <Link href="/app" className="font-semibold underline">
            {top?.title ?? "case"}
          </Link>{" "}
          because {top?.reasons[0]?.toLowerCase() ?? "the details match"}.
        </p>
        <button type="button" disabled className="mt-2 text-sky-800 underline disabled:opacity-60">
          Undo
        </button>
      </section>
    );
  }
  if (match.decision === "ASK_CONFLICT" && top) {
    return (
      <section className="rounded-xl border-2 border-red-700 bg-red-50 p-4 text-red-950">
        <h2 className="text-lg font-bold">This letter claims to relate to your case &ldquo;{top.title}&rdquo;</h2>
        <p className="mt-1">But its details conflict with the letters already in that case:</p>
        <ul className="mt-2 list-disc pl-6">
          {match.conflicts.map((c) => (
            <li key={c.kind}>{c.detail}</li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled className="rounded-lg border border-red-800 px-3 py-1.5 disabled:opacity-60">
            Keep it separate
          </button>
          <button type="button" disabled className="rounded-lg border border-red-800 px-3 py-1.5 disabled:opacity-60">
            It&apos;s the same case
          </button>
        </div>
      </section>
    );
  }
  if (match.decision === "ASK" && top) {
    return (
      <section className="rounded-xl border border-slate-300 p-4">
        <p className="font-semibold">This may belong to your case &ldquo;{top.title}&rdquo;. Is it the same case?</p>
        <p className="text-sm text-slate-600">Why: {top.reasons.join(", ")}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled className="rounded-lg border px-3 py-1.5 disabled:opacity-60">Yes</button>
          <button type="button" disabled className="rounded-lg border px-3 py-1.5 disabled:opacity-60">No, new case</button>
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-slate-300 p-4">
      <p>This looks like a new matter.</p>
      <button type="button" disabled className="mt-2 rounded-lg bg-sky-800 px-3 py-1.5 font-semibold text-white disabled:opacity-60">
        Create case
      </button>
    </section>
  );
}
