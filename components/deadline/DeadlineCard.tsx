import type { DeadlineResult } from "@/lib/contracts";
import { formatCivilDate } from "@/lib/ui/format";

export function DeadlineCard({ deadline }: { deadline: DeadlineResult }) {
  const { printed, computed, effective, daysRemaining, status } = deadline;
  return (
    <section aria-labelledby="deadline-heading" className="rounded-xl border border-slate-300 p-4">
      <h2 id="deadline-heading" className="text-xl font-bold">
        By when?
      </h2>

      {effective ? (
        <p className="mt-2 text-2xl font-bold">
          {formatCivilDate(effective)}
          {daysRemaining !== null && (
            <span className={`ml-3 text-lg ${status === "PASSED" ? "text-red-800" : status === "SOON" ? "text-amber-800" : "text-slate-700"}`}>
              {status === "PASSED"
                ? "This date has passed"
                : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`}
            </span>
          )}
        </p>
      ) : (
        <p className="mt-2 text-lg font-semibold">No deadline we can rely on</p>
      )}

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-sm font-semibold text-slate-700">Printed in the letter</dt>
          <dd>{printed ? <>{formatCivilDate(printed.date)} <q className="block text-sm text-slate-600">{printed.sourceText}</q></> : "None printed"}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-sm font-semibold text-slate-700">Calculated from an official rule</dt>
          <dd>
            {computed ? (
              <>
                {formatCivilDate(computed.date)} {computed.statutory ? "(legal deadline)" : "(policy)"}
                <span className="block text-sm text-slate-600">{computed.explanation}</span>
                {computed.assumptions.map((a) => (
                  <span key={a} className="block text-sm text-slate-600">Assumes: {a}</span>
                ))}
                <a href={computed.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-800 underline">
                  Rule {computed.ruleId} · source
                </a>
              </>
            ) : (
              "No rule applies"
            )}
          </dd>
        </div>
      </dl>

      {deadline.mismatch && (
        <p className="mt-3 rounded-md bg-amber-50 p-2 text-amber-950">
          The printed date and the calculated date differ. We show the earlier one to be safe.
        </p>
      )}
      {deadline.clockStartedOn && (
        <p className="mt-3 text-slate-700">The clock started on {formatCivilDate(deadline.clockStartedOn)}.</p>
      )}
      {deadline.note && <p className="mt-2 text-slate-700">{deadline.note}</p>}
    </section>
  );
}
