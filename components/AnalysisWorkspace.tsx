"use client";

import { useState } from "react";
import type { LetterResult } from "@/lib/contracts";
import { LetterPreview } from "./highlights/LetterPreview";
import { VerificationLedger } from "./ledger/VerificationLedger";

/** Ledger and letter share the selected row so tapping a claim highlights it on the image. */
export function AnalysisWorkspace({ letter }: { letter: LetterResult }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="lg:sticky lg:top-4 lg:self-start">
        <LetterPreview image={letter.image} items={letter.items} selectedId={selectedId} />
      </div>
      <section aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="mb-3 text-xl font-bold">
          Does it match trusted sources?
        </h2>
        <VerificationLedger items={letter.items} selectedId={selectedId} onSelect={setSelectedId} />
      </section>
    </div>
  );
}
