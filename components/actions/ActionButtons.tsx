"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { del, messageOf, postJson } from "@/lib/ui/api-client";

export interface CaseAction {
  label: string;
  /** What the API does: file into an existing case, open a new one, leave unfiled, or undo a link. */
  kind: "link" | "new" | "keep_separate" | "unlink";
  caseId?: string;
  primary?: boolean;
  /** Shown before doing it (e.g. linking a conflicting letter flags the case). */
  confirm?: string;
}

/** The answers to "Is this the same case?" (and Undo). Refreshes the page with the new state. */
export function CaseDecisionButtons({ letterId, actions }: { letterId: string; actions: CaseAction[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(a: CaseAction) {
    if (a.confirm && !window.confirm(a.confirm)) return;
    setBusy(true);
    setError(null);
    try {
      if (a.kind === "unlink") await postJson(`/api/letters/${letterId}/unlink`);
      else if (a.kind === "link") await postJson(`/api/letters/${letterId}/case`, { decision: "link", caseId: a.caseId });
      else await postJson(`/api/letters/${letterId}/case`, { decision: a.kind });
      router.refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={busy}
            onClick={() => void run(a)}
            className={
              a.primary
                ? "rounded-lg bg-sky-800 px-3 py-1.5 font-semibold text-white transition-colors enabled:hover:bg-sky-900 disabled:opacity-60"
                : "rounded-lg border border-current px-3 py-1.5 font-semibold transition-colors enabled:hover:bg-slate-100 disabled:opacity-60"
            }
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

/** Deletes a letter or case after confirmation, then goes back to the inbox. */
export function DeleteButton({ url, label, confirmText }: { url: string; label: string; confirmText: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(confirmText)) return;
          setBusy(true);
          try {
            await del(url);
            router.push("/app");
            router.refresh();
          } catch (e) {
            setError(messageOf(e));
            setBusy(false);
          }
        }}
        className="rounded-lg border border-red-800 px-3 py-1.5 font-semibold text-red-900 transition-colors enabled:hover:bg-red-50 disabled:opacity-60"
      >
        {label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
