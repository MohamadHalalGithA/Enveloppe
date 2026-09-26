import type { LetterResult } from "@/lib/contracts";
import { formatCivilDate } from "@/lib/ui/format";

/** Always shown, and always from the Trust Registry, never from the letter. */
export function OfficialContactCard({ contact }: { contact: LetterResult["officialContact"] }) {
  return (
    <section aria-labelledby="official-heading" className="rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 text-emerald-950">
      <h2 id="official-heading" className="text-lg font-bold">
        Verified official channel
      </h2>
      <p className="mt-1">{contact.label}</p>
      <p className="mt-1 font-mono text-2xl font-bold">
        <a href={`tel:${contact.display.replace(/[^\d+]/g, "")}`} className="underline">
          {contact.display}
        </a>
      </p>
      <p className="mt-1 text-sm">From our trusted registry, checked {formatCivilDate(contact.verifiedOn)}. Not taken from your letter.</p>
    </section>
  );
}
