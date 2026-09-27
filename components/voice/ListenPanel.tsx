"use client";

import { useState } from "react";
import type { SpeechResult } from "@/lib/contracts";
import { messageOf, postJson } from "@/lib/ui/api-client";
import { SPEECH_LANGUAGES } from "@/lib/voice/languages";

/**
 * "Listen in my language". In the app it asks the API (which builds the explanation from the verified
 * result, translates it and voices it). In the demo it plays clips generated ahead of time.
 */
export function ListenPanel({
  letterId,
  preloaded,
}: {
  letterId: string;
  /** Demo only: ready-made results by language; nothing is requested from the server. */
  preloaded?: Record<string, SpeechResult>;
}) {
  const available = preloaded ? SPEECH_LANGUAGES.filter((l) => preloaded[l.code]) : SPEECH_LANGUAGES;
  const [lang, setLang] = useState<string>(available.find((l) => l.code === "ar")?.code ?? available[0]?.code ?? "en");
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!available.length) return null;

  async function listen() {
    setError(null);
    if (preloaded) {
      setResult(preloaded[lang] ?? null);
      return;
    }
    setBusy(true);
    try {
      setResult(await postJson<SpeechResult>(`/api/letters/${letterId}/speech`, { lang }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-300 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Listen in my language</span>
          <select
            value={lang}
            onChange={(e) => {
              setLang(e.target.value);
              setResult(null);
            }}
            className="rounded-md border border-slate-400 bg-white px-3 py-2"
          >
            {available.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.name}
                {l.name !== l.english ? ` (${l.english.split(" (")[0]})` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void listen()} disabled={busy} className="rounded-lg bg-sky-800 px-4 py-2 font-semibold text-white disabled:opacity-60">
          {busy ? "Preparing…" : "▶ Listen"}
        </button>
      </div>

      <div aria-live="polite">
        {result && (
          <div className="mt-3 flex flex-col gap-2">
            <p lang={result.lang} dir={result.dir} className="text-lg">
              {result.text}
            </p>
            {result.audioUrl && (
              // The same text is shown right above the player, so the audio needs no separate captions.
              <audio key={result.audioUrl} controls autoPlay src={result.audioUrl} className="w-full">
                Your browser can&apos;t play audio. The text above says the same thing.
              </audio>
            )}
            {result.machineTranslated && (
              <p className="text-sm text-slate-600">Machine translation. The English and your original letter are the reference.</p>
            )}
            {result.note && <p className="text-sm text-amber-900">{result.note}</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-red-800">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
