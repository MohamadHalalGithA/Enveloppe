"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LetterResult } from "@/lib/contracts";
import { messageOf, postJson } from "@/lib/ui/api-client";
import { confirmBody, confirmInputs } from "@/lib/ui/confirm-fields";

/** "Please check these against your letter": the user types what the paper says; every check re-runs. */
export function ConfirmFieldsForm({ letterId, fields }: { letterId: string; fields: LetterResult["needsConfirmation"] }) {
  const router = useRouter();
  const { editable, checkOnly } = confirmInputs(fields);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (fields.length === 0) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = confirmBody(values);
    if (!Object.keys(body).length) {
      setError("Type at least one value from your letter.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/letters/${letterId}/confirm`, body);
      setValues({});
      router.refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="confirm-heading" className="rounded-xl border-2 border-amber-600 bg-amber-50 p-4 text-amber-950">
      <h2 id="confirm-heading" className="text-lg font-bold">
        Please check these against your letter
      </h2>
      <p>We weren&apos;t sure we read them correctly. Type what your paper letter says and we&apos;ll re-check everything.</p>

      {editable.length > 0 && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
          {editable.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="font-semibold">{f.label}</span>
              {f.printed && <span className="text-sm">We read: &ldquo;{f.printed}&rdquo;</span>}
              <input
                name={f.key}
                type={f.kind === "date" ? "date" : f.kind === "year" ? "number" : "text"}
                inputMode={f.kind === "year" ? "numeric" : undefined}
                min={f.kind === "year" ? 2000 : undefined}
                max={f.kind === "year" ? 2100 : undefined}
                maxLength={f.kind === "text" ? 40 : undefined}
                autoComplete="off"
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="rounded-md border border-amber-700 bg-white px-3 py-2"
              />
            </label>
          ))}
          <button type="submit" disabled={busy} className="self-start rounded-lg bg-amber-800 px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy ? "Re-checking…" : "Confirm and re-check"}
          </button>
          {error && (
            <p role="alert" className="text-red-800">
              {error}
            </p>
          )}
        </form>
      )}

      {checkOnly.length > 0 && (
        <ul className="mt-3 list-disc pl-6">
          {checkOnly.map((f) => (
            <li key={f.path}>
              {f.label}
              {f.value ? `: we read "${f.value}"` : ""}. Check it against your letter.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
