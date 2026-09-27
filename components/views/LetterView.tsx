import { DeleteButton } from "@/components/actions/ActionButtons";
import { ConfirmFieldsForm } from "@/components/actions/ConfirmFieldsForm";
import { AnalysisWorkspace } from "@/components/AnalysisWorkspace";
import { CaseMatchPrompt } from "@/components/CaseMatchPrompt";
import { DeadlineCard } from "@/components/deadline/DeadlineCard";
import { NeedsConfirmationPanel } from "@/components/NeedsConfirmationPanel";
import { OfficialContactCard } from "@/components/OfficialContactCard";
import { ProcessStepper } from "@/components/process/ProcessStepper";
import { ResponsePackCard } from "@/components/response-pack/ResponsePackCard";
import { VerdictBanner } from "@/components/VerdictBanner";
import { ListenPanel } from "@/components/voice/ListenPanel";
import type { LetterResult, SpeechResult } from "@/lib/contracts";

const DEGRADED_COPY: Record<LetterResult["degraded"][number], string> = {
  EXPLANATION: "The full explanation wasn't available, so this is a simplified one.",
  QR: "We couldn't check the QR code on this letter. Don't scan it; use the official website instead.",
  RDAP: "Domain registration details were unavailable.",
  REDIRECTS: "We couldn't follow a shortened link.",
  VOICE: "Voice isn't available right now.",
};

/** The Analysis Result screen for one letter. `app` = interactive for the signed-in owner; `demo` = read-only. */
export function LetterView({
  letter,
  mode = "demo",
  speech,
}: {
  letter: LetterResult;
  mode?: "app" | "demo";
  /** Demo only: pre-generated spoken explanations by language. */
  speech?: Record<string, SpeechResult>;
}) {
  const explanation = letter.whatIsThis.explanation.en ?? Object.values(letter.whatIsThis.explanation)[0];
  const lowConfidence = letter.status === "LOW_CONFIDENCE";

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-slate-600">
          {letter.whatIsThis.agencyLabel}
          {letter.cached && <span className="ml-2 rounded bg-slate-200 px-2 py-0.5">Cached reading</span>}
        </p>
        <h1 className="text-3xl font-bold">{letter.whatIsThis.docTypeLabel}</h1>
        <VerdictBanner verdict={letter.verdict} />
        {lowConfidence && (
          <p role="note" className="rounded-md bg-amber-100 p-2 text-amber-950">
            The photo was hard to read in places. Check the highlighted details, or retake the photo flat and in good light.
          </p>
        )}
        {letter.degraded.map((d) => (
          <p key={d} role="note" className="rounded-md bg-slate-100 p-2 text-slate-800">
            {DEGRADED_COPY[d]}
          </p>
        ))}
      </header>

      {mode === "app" ? (
        <ConfirmFieldsForm letterId={letter.id} fields={letter.needsConfirmation} />
      ) : (
        <NeedsConfirmationPanel fields={letter.needsConfirmation} />
      )}

      <section aria-labelledby="what-heading">
        <h2 id="what-heading" className="text-xl font-bold">
          What is this?
        </h2>
        <p className="mt-1 text-lg">{explanation}</p>
        {mode === "app" ? (
          <ListenPanel letterId={letter.id} />
        ) : speech ? (
          <ListenPanel letterId={letter.id} preloaded={speech} />
        ) : null}
      </section>

      <OfficialContactCard contact={letter.officialContact} />

      <AnalysisWorkspace letter={letter} />

      <div className="grid gap-6 lg:grid-cols-2">
        <DeadlineCard deadline={letter.deadline} />
        <ProcessStepper process={letter.process} />
      </div>

      <ResponsePackCard pack={letter.responsePack} mode={mode} />

      <CaseMatchPrompt letter={letter} mode={mode} />

      {mode === "app" && (
        <footer className="border-t border-slate-200 pt-4">
          <DeleteButton
            url={`/api/letters/${letter.id}`}
            label="Delete this letter"
            confirmText="Delete this letter, its photo and its analysis? This can't be undone."
          />
        </footer>
      )}
    </article>
  );
}
