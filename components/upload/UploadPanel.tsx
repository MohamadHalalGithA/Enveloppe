"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { UploadResult } from "@/lib/contracts";
import { messageOf, postJson, uploadFile } from "@/lib/ui/api-client";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

type Phase = "idle" | "uploading" | "analyzing" | "error";

/** "Add letter": choose or take a photo → upload → analyze → open the result. */
export function UploadPanel() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [letterId, setLetterId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function analyze(id: string) {
    setPhase("analyzing");
    setError(null);
    try {
      await postJson(`/api/letters/${id}/analyze`);
      router.push(`/app/letters/${id}`);
      router.refresh();
    } catch (e) {
      setPhase("error");
      setError(messageOf(e));
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setLetterId(null);
    if (file.type && !TYPES.includes(file.type)) {
      setPhase("error");
      setError("Please choose a photo of the letter (JPG, PNG or WebP).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhase("error");
      setError("That photo is larger than 8 MB. Try a lower-resolution photo.");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setPhase("uploading");
    try {
      const up = await uploadFile<UploadResult>("/api/letters", file);
      setLetterId(up.letterId);
      await analyze(up.letterId);
    } catch (e) {
      setPhase("error");
      setError(messageOf(e));
    }
  }

  const busy = phase === "uploading" || phase === "analyzing";

  return (
    <section aria-labelledby="add-heading" className="rounded-xl border-2 border-dashed border-sky-700 p-4">
      <h2 id="add-heading" className="text-xl font-bold">
        Add a letter
      </h2>
      <p className="mt-1 text-slate-700">
        Take a clear photo of the whole page, flat and in good light. Only you can see it, and the photo is deleted after 30
        days.
      </p>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Photo of the letter"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="mt-3 flex flex-wrap items-start gap-4">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
          <img src={preview} alt="The photo you chose" className="h-32 w-24 rounded border border-slate-300 object-cover" />
        )}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="self-start rounded-lg bg-sky-800 px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {preview ? "Choose another photo" : "Choose or take a photo"}
          </button>

          <div role="status" aria-live="polite">
            {phase === "uploading" && <p className="font-semibold">Uploading your photo…</p>}
            {phase === "analyzing" && (
              <div>
                <p className="font-semibold">
                  <span aria-hidden className="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-sky-700" />
                  Reading your letter. This usually takes about 10 seconds.
                </p>
                <p className="text-sm text-slate-600">
                  Reading the letter · checking it against official sources · comparing it with your cases · working out
                  deadlines
                </p>
              </div>
            )}
          </div>

          {phase === "error" && error && (
            <div role="alert" className="rounded-md border-2 border-red-700 bg-red-50 p-3 text-red-950">
              <p>{error}</p>
              {letterId && (
                <button type="button" onClick={() => void analyze(letterId)} className="mt-2 font-semibold underline">
                  Try again
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
