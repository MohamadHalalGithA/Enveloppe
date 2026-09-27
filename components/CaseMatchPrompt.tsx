import type { LetterResult } from "@/lib/contracts";

export function CaseMatchPrompt({ match, filedIn }: { match: LetterResult["caseMatch"]; filedIn: LetterResult["filedIn"] }) {
  const top = match.candidates[0];

  if (filedIn) {
    return filedIn.role === "suspected_imitation" ? (
      <section className="rounded-xl border-2 border-red-700 bg-red-50 p-4 text-red-950">
        <p>
          Kept with your case <strong>&ldquo;{filedIn.title}&rdquo;</strong> as a <strong>suspected imitation</strong>. It
          doesn&apos;t change the case&apos;s steps or deadlines.
        </p>
      </section>
    ) : (
      <section className="rounded-xl border border-slate-300 p-4">
        <p>
          Filed in your case <strong>&ldquo;{filedIn.title}&rdquo;</strong>
          {match.decision === "AUTO_LINK" && top ? ` because ${top.reasons[0]?.toLowerCase() ?? "the details match"}` : ""}.
        </p>
        {match.decision === "AUTO_LINK" && (
          <button type="button" disabled className="mt-2 text-sky-800 underline disabled:opacity-60">
            Undo
          </button>
        )}
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
  if ((match.decision === "ASK" || match.decision === "AUTO_LINK") && top) {
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
