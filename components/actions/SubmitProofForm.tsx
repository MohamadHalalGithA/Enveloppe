"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { messageOf, postJson } from "@/lib/ui/api-client";

/**
 * "I've submitted it": the user did the task on the official channel; save their proof so the case moves
 * to waiting. Enveloppe never submits anything on the user's behalf.
 */
export function SubmitProofForm({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-sky-800 px-4 py-2 font-semibold text-white transition-colors hover:bg-sky-900">
        I&apos;ve submitted it
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/tasks/${taskId}/complete`, {
        confirmationNumber: confirmation.trim() || null,
        notes: notes.trim() || null,
      });
      router.refresh();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3 rounded-lg border border-slate-300 p-3">
      <p className="font-semibold">Save your proof of submission</p>
      <label className="flex flex-col gap-1">
        <span>Confirmation number (if you got one)</span>
        <input
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          maxLength={64}
          autoComplete="off"
          className="rounded-md border border-slate-400 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={2}
          className="rounded-md border border-slate-400 px-3 py-2"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-sky-800 px-4 py-2 font-semibold text-white transition-colors enabled:hover:bg-sky-900 disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border px-4 py-2 transition-colors enabled:hover:bg-slate-100">
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}
