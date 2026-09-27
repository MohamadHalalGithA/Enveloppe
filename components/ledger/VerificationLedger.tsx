"use client";

import type { VerificationItem } from "@/lib/contracts";
import { CLAIM_LABEL, formatCivilDate, STATUS_BADGE, TONE_CLASSES } from "@/lib/ui/format";

interface Props {
  items: VerificationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function VerificationLedger({ items, selectedId, onSelect }: Props) {
  if (items.length === 0) {
    return <p className="text-slate-600">We didn&apos;t find any details we could check in this letter.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const badge = STATUS_BADGE[item.status];
        const selected = item.id === selectedId;
        return (
          <li key={item.id}>
            <div
              className={`rounded-lg border p-3 transition-colors has-[button:hover]:bg-slate-50 ${selected ? "border-sky-700 ring-2 ring-sky-600" : "border-slate-300"}`}
            >
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-pressed={selected}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left focus-visible:outline-2 focus-visible:outline-sky-700"
              >
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-semibold ${TONE_CLASSES[badge.tone]}`}
                >
                  <span aria-hidden>{badge.icon}</span>
                  {badge.label}
                </span>
                <span className="font-semibold">{CLAIM_LABEL[item.claimType]}</span>
                <span className="font-mono text-slate-800 break-all">{item.letterValue}</span>
                <span className="ml-auto text-sm text-sky-800 underline">Show on letter</span>
              </button>
              <p className="mt-2">{item.reason}</p>
              {item.officialAlternative && (
                <p className="mt-2 rounded-md bg-emerald-50 p-2 text-emerald-950">
                  Use instead: <strong>{item.officialAlternative.label}</strong>{" "}
                  <span className="font-mono">{item.officialAlternative.value}</span>
                </p>
              )}
              <p className="mt-2 text-sm text-slate-600">
                Evidence: {item.evidenceType.replaceAll("_", " ").toLowerCase()}
                {item.sourceUrl && (
                  <>
                    {" · "}
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sky-800 underline">
                      Official source
                    </a>
                  </>
                )}
                {item.verifiedOn && <> · checked {formatCivilDate(item.verifiedOn)}</>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
