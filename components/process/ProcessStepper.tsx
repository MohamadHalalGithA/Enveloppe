import type { ProcessView } from "@/lib/contracts";

export function ProcessStepper({ process }: { process: ProcessView | null }) {
  return (
    <section aria-labelledby="process-heading" className="rounded-xl border border-slate-300 p-4">
      <h2 id="process-heading" className="text-xl font-bold">
        Where am I in the process?
      </h2>
      {!process ? (
        <p className="mt-2 text-slate-700">We don&apos;t place this letter in a government process.</p>
      ) : (
        <>
          <p className="mt-1 text-slate-700">{process.title}</p>
          <ol className="mt-3 flex flex-col">
            {process.stages.map((s, i) => (
              <li key={s.id} className="flex gap-3" aria-current={s.state === "current" ? "step" : undefined}>
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold ${
                      s.state === "done"
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : s.state === "current"
                          ? "border-sky-700 bg-sky-100 text-sky-900"
                          : "border-slate-300 text-slate-400"
                    }`}
                  >
                    {s.state === "done" ? "✓" : i + 1}
                  </span>
                  {i < process.stages.length - 1 && <span aria-hidden className="w-0.5 flex-1 bg-slate-300" />}
                </div>
                <div className="pb-4">
                  <p className={s.state === "current" ? "font-bold" : ""}>
                    {s.label}
                    {s.state === "current" && (
                      <span className="ml-2 rounded bg-sky-700 px-2 py-0.5 text-sm font-semibold text-white">You are here</span>
                    )}
                    <span className="sr-only"> ({s.state === "done" ? "done" : s.state === "current" ? "current step" : "not yet"})</span>
                  </p>
                  {s.expectNext && <p className="text-sm text-slate-600">What usually happens: {s.expectNext}</p>}
                </div>
              </li>
            ))}
          </ol>
          <a href={process.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-800 underline">
            Based on official information (simplified)
          </a>
        </>
      )}
    </section>
  );
}
