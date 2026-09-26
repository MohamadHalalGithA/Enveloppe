import type { LetterResult } from "@/lib/contracts";

export function NeedsConfirmationPanel({ fields }: { fields: LetterResult["needsConfirmation"] }) {
  if (fields.length === 0) return null;
  return (
    <section aria-labelledby="confirm-heading" className="rounded-xl border-2 border-amber-600 bg-amber-50 p-4 text-amber-950">
      <h2 id="confirm-heading" className="text-lg font-bold">
        Please check these against your letter
      </h2>
      <p>We weren&apos;t sure about them. Retaking the photo flat and in good light also helps.</p>
      <form className="mt-3 flex flex-col gap-3">
        {fields.map((f) => (
          <label key={f.path} className="flex flex-col gap-1">
            <span className="font-semibold">{f.label}</span>
            <input
              name={f.path}
              defaultValue={f.value ?? ""}
              placeholder="Type what your letter says"
              className="rounded-md border border-amber-700 bg-white px-3 py-2"
            />
          </label>
        ))}
        <button type="button" disabled className="self-start rounded-lg bg-amber-800 px-4 py-2 font-semibold text-white disabled:opacity-60">
          Confirm and re-check
        </button>
      </form>
    </section>
  );
}
