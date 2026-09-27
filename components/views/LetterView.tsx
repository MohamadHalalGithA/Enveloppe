import { AnalysisWorkspace } from "@/components/AnalysisWorkspace";
import { CaseMatchPrompt } from "@/components/CaseMatchPrompt";
import { DeadlineCard } from "@/components/deadline/DeadlineCard";
import { NeedsConfirmationPanel } from "@/components/NeedsConfirmationPanel";
import { OfficialContactCard } from "@/components/OfficialContactCard";
import { ProcessStepper } from "@/components/process/ProcessStepper";
import { ResponsePackCard } from "@/components/response-pack/ResponsePackCard";
import { VerdictBanner } from "@/components/VerdictBanner";
import type { LetterResult } from "@/lib/contracts";

/** The Analysis Result screen for one letter (shared by /app and /demo). */
export function LetterView({ letter }: { letter: LetterResult }) {
  const explanation = letter.whatIsThis.explanation.en ?? Object.values(letter.whatIsThis.explanation)[0];

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-slate-600">
          {letter.whatIsThis.agencyLabel}
          {letter.cached && <span className="ml-2 rounded bg-slate-200 px-2 py-0.5">Cached reading</span>}
        </p>
        <h1 className="text-3xl font-bold">{letter.whatIsThis.docTypeLabel}</h1>
        <VerdictBanner verdict={letter.verdict} />
      </header>

      <NeedsConfirmationPanel fields={letter.needsConfirmation} />

      <section aria-labelledby="what-heading">
        <h2 id="what-heading" className="text-xl font-bold">
          What is this?
        </h2>
        <p className="mt-1 text-lg">{explanation}</p>
        {letter.degraded.includes("EXPLANATION") && (
          <p className="text-sm text-slate-600">Simplified explanation: the full explanation wasn&apos;t available.</p>
        )}
        <button type="button" disabled className="mt-2 rounded-lg border border-slate-400 px-3 py-1.5 disabled:opacity-60">
          Listen in my language (coming soon)
        </button>
      </section>

      <OfficialContactCard contact={letter.officialContact} />

      <AnalysisWorkspace letter={letter} />

      <div className="grid gap-6 lg:grid-cols-2">
        <DeadlineCard deadline={letter.deadline} />
        <ProcessStepper process={letter.process} />
      </div>

      <ResponsePackCard pack={letter.responsePack} />

      <CaseMatchPrompt match={letter.caseMatch} filedIn={letter.filedIn} />
    </article>
  );
}
