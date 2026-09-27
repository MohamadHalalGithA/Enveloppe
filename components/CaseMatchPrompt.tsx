import Link from "next/link";
import { CaseDecisionButtons, type CaseAction } from "@/components/actions/ActionButtons";
import type { LetterResult } from "@/lib/contracts";

type Mode = "app" | "demo";

/** "Is this the same case?" — the user decides; nothing is merged silently. Read-only in the demo. */
export function CaseMatchPrompt({ letter, mode }: { letter: LetterResult; mode: Mode }) {
  const { caseMatch: match, filedIn } = letter;
  const top = match.candidates[0];
  const actions = (list: CaseAction[]) =>
    mode === "app" ? (
      <CaseDecisionButtons letterId={letter.id} actions={list} />
    ) : (
      <div className="mt-3 flex flex-wrap gap-2">
        {list.map((a) => (
          <button key={a.label} type="button" disabled className="rounded-lg border border-current px-3 py-1.5 disabled:opacity-60">
            {a.label}
          </button>
        ))}
      </div>
    );
  const caseLink = (caseId: string, title: string) =>
    mode === "app" ? (
      <Link href={`/app/cases/${caseId}`} className="font-semibold underline">
        &ldquo;{title}&rdquo;
      </Link>
    ) : (
      <strong>&ldquo;{title}&rdquo;</strong>
    );

  if (filedIn) {
    const undo: CaseAction[] = [{ label: filedIn.role === "suspected_imitation" ? "Remove from this case" : "Undo", kind: "unlink" }];
    return filedIn.role === "suspected_imitation" ? (
      <section className="rounded-xl border-2 border-red-700 bg-red-50 p-4 text-red-950">
        <p>
          Kept with your case {caseLink(filedIn.caseId, filedIn.title)} as a <strong>suspected imitation</strong>. It
          doesn&apos;t change the case&apos;s steps or deadlines.
        </p>
        {actions(undo)}
      </section>
    ) : (
      <section className="rounded-xl border border-slate-300 p-4">
        <p>
          Filed in your case {caseLink(filedIn.caseId, filedIn.title)}
          {match.decision === "AUTO_LINK" && top ? ` because ${top.reasons[0]?.toLowerCase() ?? "the details match"}` : ""}.
        </p>
        {actions(undo)}
      </section>
    );
  }

  if (letter.caseDecision === "KEPT_SEPARATE") {
    return (
      <section className="rounded-xl border border-slate-300 p-4">
        <p>You chose to keep this letter separate from your cases.</p>
        {actions([{ label: "Track it as a case after all", kind: "new" }])}
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
        {actions([
          { label: "Keep it separate", kind: "keep_separate", primary: true },
          {
            label: "It's the same case",
            kind: "link",
            caseId: top.caseId,
            confirm:
              "This letter's details conflict with your case. It will be kept there as a suspected imitation and won't change the case's steps or deadlines. Continue?",
          },
        ])}
      </section>
    );
  }

  if (match.decision === "ASK" && top) {
    return (
      <section className="rounded-xl border border-slate-300 p-4">
        <p className="font-semibold">This may belong to your case &ldquo;{top.title}&rdquo;. Is it the same case?</p>
        <p className="text-sm text-slate-600">Why: {top.reasons.join(", ")}</p>
        {actions([
          { label: "Yes, same case", kind: "link", caseId: top.caseId, primary: true },
          { label: "No, it's a new case", kind: "new" },
        ])}
      </section>
    );
  }

  const contradicted = letter.verdict === "CONTRADICTIONS_FOUND";
  return (
    <section className="rounded-xl border border-slate-300 p-4">
      <p>{contradicted ? "You don't need to track this letter. You can keep a record of it if you like." : "This looks like a new matter."}</p>
      {actions(
        contradicted
          ? [
              { label: "Don't track it", kind: "keep_separate", primary: true },
              { label: "Keep a record (flagged)", kind: "new" },
            ]
          : [
              { label: "Track it as a case", kind: "new", primary: true },
              { label: "Don't track it", kind: "keep_separate" },
            ],
      )}
    </section>
  );
}
