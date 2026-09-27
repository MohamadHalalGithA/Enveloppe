"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LetterStatus } from "@/lib/contracts";
import { messageOf, postJson } from "@/lib/ui/api-client";

const COPY: Partial<Record<LetterStatus, { title: string; body: string; action: string | null }>> = {
  UPLOADED: { title: "Ready to read", body: "Your photo is saved. We haven't read it yet.", action: "Read this letter" },
  PROCESSING: { title: "Reading your letter…", body: "This usually takes about 10 seconds. This page updates by itself.", action: null },
  SERVICE_UNAVAILABLE: {
    title: "The reading service was busy",
    body: "Your letter is saved. Nothing was lost; try again in a minute.",
    action: "Try again",
  },
  FAILED: {
    title: "We couldn't read this letter",
    body: "Try again, or take a clearer photo: flat, the whole page, good light, no glare.",
    action: "Try again",
  },
};

/** Shown for letters that haven't been analyzed (yet): start, retry, or wait while another run finishes. */
export function AnalyzeStatus({ letterId, status, error }: { letterId: string; status: LetterStatus; error: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const copy = COPY[status] ?? COPY.FAILED!;

  useEffect(() => {
    if (status !== "PROCESSING") return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [status, router]);

  return (
    <section role="status" aria-live="polite" className="rounded-xl border-2 border-slate-400 p-4">
      <h1 className="text-2xl font-bold">{busy ? "Reading your letter…" : copy.title}</h1>
      <p className="mt-1">{busy ? "This usually takes about 10 seconds." : (error ?? copy.body)}</p>
      {copy.action && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              await postJson(`/api/letters/${letterId}/analyze`);
              router.refresh();
            } catch (e) {
              setMessage(messageOf(e));
              setBusy(false);
            }
          }}
          className="mt-3 rounded-lg bg-sky-800 px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {copy.action}
        </button>
      )}
      {message && (
        <p role="alert" className="mt-2 text-red-800">
          {message}
        </p>
      )}
    </section>
  );
}
