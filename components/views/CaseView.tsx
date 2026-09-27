import Link from "next/link";
import { DeleteButton } from "@/components/actions/ActionButtons";
import { SubmitProofForm } from "@/components/actions/SubmitProofForm";
import { ProcessStepper } from "@/components/process/ProcessStepper";
import type { CaseDetail, CaseStatus } from "@/lib/contracts";
import { formatCivilDate, TONE_CLASSES, VERDICT_COPY } from "@/lib/ui/format";

const STATUS: Record<CaseStatus, { label: string; tone: string }> = {
  ACTION_REQUIRED: { label: "Action needed", tone: "bg-amber-100 text-amber-950" },
  SUBMITTED: { label: "Submitted", tone: "bg-sky-100 text-sky-950" },
  WAITING_FOR_GOVERNMENT: { label: "Waiting for the government", tone: "bg-sky-100 text-sky-950" },
  NEEDS_REVIEW: { label: "Needs your review", tone: "bg-red-100 text-red-950" },
  CLOSED: { label: "Closed", tone: "bg-slate-200 text-slate-900" },
};

const EVENT_LABEL: Record<string, string> = {
  CASE_CREATED: "Case created",
  LETTER_ADDED: "Letter added",
  LETTER_FLAGGED: "A conflicting letter was flagged",
  STAGE_CHANGED: "Moved to the next step",
  PROOF_SAVED: "You saved proof of submission",
  LINK_UNDONE: "A letter was removed from the case",
};

/** Case File: where the process stands, what to do, the letters, and the history. */
export function CaseView({ detail }: { detail: CaseDetail }) {
  const c = detail.case;
  const status = STATUS[c.status];
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/app" className="text-sky-800 underline">
          ← Civic Inbox
        </Link>
        <p className="text-sm font-semibold text-slate-600">{c.agencyId}</p>
        <h1 className="text-3xl font-bold">{c.title}</h1>
        <p className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 font-semibold ${status.tone}`}>{status.label}</span>
          {c.referenceLast4 && <span className="text-slate-700">Reference …{c.referenceLast4}</span>}
          {c.period && <span className="text-slate-700">Year {c.period}</span>}
          {c.nextDeadline && <span className="font-semibold">Next deadline: {formatCivilDate(c.nextDeadline)}</span>}
        </p>
        {c.status === "NEEDS_REVIEW" && (
          <p role="note" className="rounded-md border-2 border-red-700 bg-red-50 p-2 text-red-950">
            A letter that conflicts with this case was added to it. Check with the agency using the official contact on that
            letter&apos;s page before acting on it.
          </p>
        )}
      </header>

      <ProcessStepper process={detail.process} />

      <section aria-labelledby="tasks-heading" className="rounded-xl border border-slate-300 p-4">
        <h2 id="tasks-heading" className="text-xl font-bold">
          What you need to do
        </h2>
        {detail.tasks.length === 0 && <p className="mt-2 text-slate-700">Nothing right now.</p>}
        <ul className="mt-2 flex flex-col gap-4">
          {detail.tasks.map((t) => (
            <li key={t.id} className="rounded-lg border border-slate-200 p-3">
              <p className="font-semibold">
                {t.title}
                {t.dueDate && t.status === "OPEN" && <span className="ml-2 text-amber-900">by {formatCivilDate(t.dueDate)}</span>}
              </p>
              {t.checklist.length > 0 && (
                <ul className="mt-2 list-disc pl-6">
                  {t.checklist.map((i) => (
                    <li key={i.label}>{i.label}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                {t.status === "OPEN" ? (
                  <SubmitProofForm taskId={t.id} />
                ) : t.proof ? (
                  <p className="text-emerald-900">
                    Done: submitted {new Date(t.proof.submittedAt).toLocaleDateString("en-CA", { dateStyle: "long" })}
                    {t.proof.confirmationNumber && <> · confirmation {t.proof.confirmationNumber}</>}
                  </p>
                ) : (
                  <p className="text-slate-600">Replaced by a newer letter.</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="letters-heading">
        <h2 id="letters-heading" className="mb-3 text-xl font-bold">
          Letters in this case
        </h2>
        <ul className="flex flex-col gap-2">
          {detail.letters.map((l) => {
            const v = VERDICT_COPY[l.verdict];
            return (
              <li key={l.id}>
                <Link href={`/app/letters/${l.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-300 p-3 hover:bg-slate-50">
                  <span className={`rounded-full border px-2 py-0.5 text-sm font-semibold ${TONE_CLASSES[v.tone]}`}>
                    <span aria-hidden>{v.icon}</span> {v.title}
                  </span>
                  <span className="font-semibold">{l.title}</span>
                  {l.caseRole === "suspected_imitation" && <span className="text-sm font-semibold text-red-800">Suspected imitation</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-2 text-xl font-bold">
          History
        </h2>
        <ol className="flex flex-col gap-1 text-slate-700">
          {detail.events.map((e, i) => (
            <li key={i}>
              {new Date(e.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })} · {EVENT_LABEL[e.type] ?? e.type}
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-slate-200 pt-4">
        <DeleteButton
          url={`/api/cases/${c.id}`}
          label="Delete this case"
          confirmText="Delete this case and every letter in it, with their photos and analyses? This can't be undone."
        />
      </footer>
    </article>
  );
}
