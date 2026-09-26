import type { Verdict } from "@/lib/contracts";
import { TONE_CLASSES, VERDICT_COPY } from "@/lib/ui/format";

export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const v = VERDICT_COPY[verdict];
  return (
    <section
      aria-label="Verification summary"
      className={`flex items-start gap-3 rounded-xl border-2 p-4 ${TONE_CLASSES[v.tone]}`}
    >
      <span aria-hidden className="text-2xl font-bold leading-none">
        {v.icon}
      </span>
      <div>
        <h2 className="text-lg font-bold">{v.title}</h2>
        <p>{v.body}</p>
      </div>
    </section>
  );
}
