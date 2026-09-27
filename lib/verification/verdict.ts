import type { ClaimType, Verdict, VerificationItem } from "@/lib/contracts";

/**
 * Four tiers, no score (Blueprint Part 8). Soft signals alone never produce CONTRADICTIONS_FOUND, and
 * "consistent" requires every contact detail we saw to check out, on a letter we could read in full:
 * a glare-covered corner could hide exactly the detail that would contradict.
 */

const CONTACT_CLAIMS = new Set<ClaimType>(["phone", "url", "email", "qr", "payment"]);

export interface VerdictContext {
  /** The sender is an agency the Trust Registry covers. */
  agencyTracked: boolean;
  /** The whole letter was legible (extraction.quality.legibility === "good"). */
  fullyLegible: boolean;
}

export function computeVerdict(items: VerificationItem[], ctx: VerdictContext): Verdict {
  if (items.some((i) => i.status === "VERIFIED_CONTRADICTION" && (i.strength === "HARD" || i.strength === "STRONG"))) {
    return "CONTRADICTIONS_FOUND";
  }
  const strongMatches = items.filter((i) => i.status === "VERIFIED_MATCH" && i.strength === "STRONG").length;
  if (!ctx.agencyTracked || strongMatches === 0) return "CANNOT_VERIFY";

  const pending = items.some((i) => i.status === "NEEDS_USER_CONFIRMATION");
  const uncheckedContact = items.some((i) => i.status === "UNVERIFIED" && CONTACT_CLAIMS.has(i.claimType));
  const addressedToSoftware = items.some((i) => i.claimType === "embedded_instruction");
  const conflictsWithCase = items.some((i) => i.evidenceType === "CASE_FILE" && i.status === "VERIFIED_CONTRADICTION");
  if (strongMatches >= 2 && ctx.fullyLegible && !pending && !uncheckedContact && !addressedToSoftware && !conflictsWithCase) {
    return "CONSISTENT_WITH_TRUSTED_SOURCES";
  }
  return "PARTIALLY_VERIFIED";
}
