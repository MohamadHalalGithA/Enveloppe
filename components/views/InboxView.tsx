import Link from "next/link";
import type { CaseStatus, Inbox } from "@/lib/contracts";
import { formatCivilDate, TONE_CLASSES, VERDICT_COPY } from "@/lib/ui/format";

const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  ACTION_REQUIRED: "Action needed",
  SUBMITTED: "Submitted",
  WAITING_FOR_GOVERNMENT: "Waiting for government",
  NEEDS_REVIEW: "Needs review",
  CLOSED: "Closed",
};

/** The Civic Inbox (shared by /app and /demo). `basePath` decides where links go; only /app has case pages. */
export function InboxView({ inbox, basePath, headerAction }: { inbox: Inbox; basePath: "/app" | "/demo"; headerAction?: React.ReactNode }) {
  const { cases, letters } = inbox;
  const caseLetter = (caseId: string) => letters.find((l) => l.caseId === caseId);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Civic Inbox</h1>
        {headerAction}
      </div>

      <section aria-labelledby="cases-heading">
        <h2 id="cases-heading" className="mb-3 text-xl font-bold">
          Your cases
        </h2>
        {cases.length === 0 ? (
          <p className="text-slate-600">No cases yet. Photograph your first letter to start.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {cases.map((c) => {
              const letter = caseLetter(c.id);
              return (
                <li key={c.id} className="rounded-xl border border-slate-300 p-4">
                  <p className="text-sm font-semibold text-slate-600">
                    {c.agencyId} · {CASE_STATUS_LABEL[c.status]}
                  </p>
                  <h3 className="text-lg font-bold">
                    {basePath === "/app" ? (
                      <Link href={`/app/cases/${c.id}`} className="underline">
                        {c.title}
                      </Link>
                    ) : letter ? (
                      <Link href={`${basePath}/letters/${letter.id}`} className="underline">
                        {c.title}
                      </Link>
                    ) : (
                      c.title
                    )}
                  </h3>
                  {c.referenceLast4 && <p className="text-slate-700">Reference …{c.referenceLast4}</p>}
                  {c.nextDeadline && <p className="font-semibold">Next deadline: {formatCivilDate(c.nextDeadline)}</p>}
                  <p className="text-sm text-slate-600">
                    {c.letterCount} letter{c.letterCount === 1 ? "" : "s"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="letters-heading">
        <h2 id="letters-heading" className="mb-3 text-xl font-bold">
          Recent letters
        </h2>
        {letters.length === 0 && <p className="text-slate-600">No letters yet.</p>}
        <ul className="flex flex-col gap-2">
          {letters.map((l) => {
            const v = VERDICT_COPY[l.verdict];
            return (
              <li key={l.id}>
                <Link
                  href={`${basePath}/letters/${l.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-300 p-3 hover:bg-slate-50"
                >
                  <span className={`rounded-full border px-2 py-0.5 text-sm font-semibold ${TONE_CLASSES[v.tone]}`}>
                    <span aria-hidden>{v.icon}</span> {v.title}
                  </span>
                  <span className="font-semibold">{l.title}</span>
                  {!l.caseId && <span className="text-sm text-slate-600">Not filed in a case</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
