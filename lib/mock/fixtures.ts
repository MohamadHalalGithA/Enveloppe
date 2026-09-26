import "server-only";
import { InboxZ, LetterResultZ, type Inbox, type LetterResult } from "@/lib/contracts";
import inboxJson from "@/demo/fixtures/inbox.json";
import letterA from "@/demo/fixtures/letter-a-cra-review.result.json";
import letterB from "@/demo/fixtures/letter-b-cra-twin.result.json";
import letterC from "@/demo/fixtures/letter-c-cra-reassessment.result.json";
import letterE from "@/demo/fixtures/letter-e-low-confidence.result.json";

// Mock data source for the UI until the real pipeline + DB exist.
// Fixtures are parsed through the shared contracts, so drift fails loudly.

const letters: LetterResult[] = [letterA, letterB, letterC, letterE].map((l) => LetterResultZ.parse(l));
const inbox: Inbox = InboxZ.parse(inboxJson);

export function getMockInbox(): Inbox {
  return inbox;
}

export function getMockLetter(id: string): LetterResult | null {
  return letters.find((l) => l.id === id) ?? null;
}
