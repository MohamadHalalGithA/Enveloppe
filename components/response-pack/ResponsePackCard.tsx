import { SubmitProofForm } from "@/components/actions/SubmitProofForm";
import type { ResponsePack } from "@/lib/contracts";
import { formatCivilDate } from "@/lib/ui/format";

export function ResponsePackCard({ pack, mode = "demo" }: { pack: ResponsePack | null; mode?: "app" | "demo" }) {
  if (!pack) {
    return (
      <section className="rounded-xl border border-slate-300 p-4">
        <h2 className="text-xl font-bold">What should I do next?</h2>
        <p className="mt-2 text-slate-700">We can&apos;t suggest steps for this sender. Contact the agency using an official channel.</p>
      </section>
    );
  }
  const { completion } = pack;
  return (
    <section aria-labelledby="pack-heading" className="rounded-xl border border-slate-300 p-4">
      <h2 id="pack-heading" className="text-xl font-bold">
        What should I do next?
      </h2>
      {pack.caution && (
        <p className="mt-2 rounded-md border-2 border-red-700 bg-red-50 p-2 font-semibold text-red-950">{pack.caution}</p>
      )}
      <p className="mt-2 text-lg">{pack.summary}</p>
      {pack.action && <p className="mt-1 font-semibold">{pack.action.label}</p>}

      {pack.requestedDocuments.length > 0 && (
        <fieldset className="mt-4">
          <legend className="font-semibold">Documents requested (as listed in your letter)</legend>
          <ul className="mt-2 flex flex-col gap-2">
            {pack.requestedDocuments.map((d) => (
              <li key={d.label}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" defaultChecked={d.checked} className="mt-1 h-5 w-5" />
                  <span>{d.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <ol className="mt-4 list-decimal space-y-1 pl-6">
        {pack.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {pack.officialChannel && (
          <div className="rounded-lg bg-emerald-50 p-3 text-emerald-950">
            <p className="text-sm font-semibold">Official place to respond</p>
            <a href={pack.officialChannel.url} target="_blank" rel="noopener noreferrer" className="underline">
              {pack.officialChannel.name}
            </a>
            <p className="text-sm">Checked {formatCivilDate(pack.officialChannel.verifiedOn)}</p>
          </div>
        )}
        {pack.form && (
          <div className="rounded-lg bg-emerald-50 p-3 text-emerald-950">
            <p className="text-sm font-semibold">Official form</p>
            <a href={pack.form.url} target="_blank" rel="noopener noreferrer" className="underline">
              {pack.form.code}
            </a>
          </div>
        )}
      </div>

      <div className="mt-4">
        {completion.status === "DONE" && completion.proof ? (
          <p className="rounded-lg bg-emerald-50 p-3 text-emerald-950">
            <strong>Submitted</strong> {new Date(completion.proof.submittedAt).toLocaleDateString("en-CA", { dateStyle: "long" })}
            {completion.proof.confirmationNumber && <> · confirmation {completion.proof.confirmationNumber}</>}
          </p>
        ) : mode === "app" && completion.taskId ? (
          <SubmitProofForm taskId={completion.taskId} />
        ) : mode === "app" ? (
          pack.action && pack.action.type !== "call" ? (
            <p className="text-slate-700">Track this letter as a case (below) to record when you&apos;ve done this.</p>
          ) : null
        ) : (
          <button type="button" disabled className="rounded-lg bg-sky-800 px-4 py-2 font-semibold text-white disabled:opacity-60">
            I&apos;ve submitted it
          </button>
        )}
      </div>
    </section>
  );
}
