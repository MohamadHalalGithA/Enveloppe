import type { Extraction, Verdict, VerificationItem } from "@/lib/contracts";
import type { QrFinding } from "@/lib/qr/decode";
import { getRegistry, type Registry } from "@/lib/registry/load";
import { agencyEntry } from "@/lib/registry/lookup";
import { verifyClaims } from "./engine";
import { computeVerdict } from "./verdict";

export { sortItems, verifyClaims } from "./engine";
export { computeVerdict } from "./verdict";

/** Extraction (+ decoded QR codes) → ledger + verdict, using registry evidence only. */
export function verifyExtraction(
  x: Extraction,
  opts: { qr?: QrFinding[]; registry?: Registry } = {},
): { items: VerificationItem[]; verdict: Verdict } {
  const registry = opts.registry ?? getRegistry();
  const items = verifyClaims(x, { registry, qr: opts.qr ?? [] });
  return {
    items,
    verdict: computeVerdict(items, {
      agencyTracked: !!agencyEntry(registry, x.agency.value),
      fullyLegible: x.quality.legibility === "good",
    }),
  };
}
