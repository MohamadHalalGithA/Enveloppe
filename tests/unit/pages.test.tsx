import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/auth/resolve";
import { resolveUser } from "@/lib/auth/resolve";
import { decideCase, fileAnalyzedLetter } from "@/lib/cases/service";
import { openPglite } from "@/lib/db/client";
import { createLetter, storeLetterImage } from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import type { QrFinding } from "@/lib/qr/decode";
import { letterA, letterB, noticeOfReassessment } from "../helpers/extractions";

/**
 * Renders the real /app server pages against a seeded database. Only the signed-in user is substituted
 * (Auth0 sign-in can't run headless); data access, scoping and components are the production code.
 */

let db: Db;
let signedIn: AppUser;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/auth/page-user", () => ({ pageUser: async () => signedIn }));
vi.mock("@/lib/db/client", async (orig) => ({ ...(await orig<object>()), getDb: async () => db }));

const { default: InboxPage } = await import("@/app/app/page");
const { default: LetterPage } = await import("@/app/app/letters/[id]/page");
const { default: CasePage } = await import("@/app/app/cases/[id]/page");

const opts = { today: "2026-09-27", refKey: "pages-test-key-".repeat(4) };
const scamQr: QrFinding[] = [{ box: [700, 700, 851, 896], page: 1, nearbyText: "Scan", decoded: "https://cra-canada-verify.example/ccb?ref=8902" }];
const img = { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg", width: 1275, height: 1650 };
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const params = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

let letterAId: string;
let letterBId: string;
let blurryId: string;
let uploadedId: string;
let oldId: string;
let caseId: string;

beforeAll(async () => {
  db = await openPglite();
  signedIn = await resolveUser(db, "auth0|pages-amira");
  const seed = async (sha: string) => {
    const { id } = await createLetter(db, signedIn.id, sha.repeat(64));
    await storeLetterImage(db, signedIn.id, id, img, new Date(Date.now() + 86_400_000));
    return id;
  };
  letterAId = await seed("a");
  await fileAnalyzedLetter(db, signedIn.id, letterAId, { extraction: letterA(), qr: [] }, opts);
  caseId = (await decideCase(db, signedIn.id, letterAId, { decision: "new" })).caseId!;
  letterBId = await seed("b");
  await fileAnalyzedLetter(db, signedIn.id, letterBId, { extraction: letterB(), qr: scamQr }, opts);
  blurryId = await seed("c");
  const blurry = letterA();
  blurry.identifiers[0] = { ...blurry.identifiers[0], needsConfirmation: true, confidence: "low" };
  await fileAnalyzedLetter(db, signedIn.id, blurryId, { extraction: blurry, qr: [] }, opts);
  uploadedId = await seed("d");
  oldId = await seed("e");
  const old = noticeOfReassessment({ issueDate: "2016-04-18", taxYear: 2015, ref: "2015-T1-3301-7702" });
  await fileAnalyzedLetter(db, signedIn.id, oldId, { extraction: old, qr: [] }, opts);
}, 60_000);

describe("/app pages with real data", () => {
  it("Civic Inbox: upload panel, cases linking to case pages, letters with verdicts", async () => {
    const page = await html(InboxPage());
    expect(page).toContain("Add a letter");
    expect(page).toContain(`href="/app/cases/${caseId}"`);
    expect(page).toContain("CRA: Canada Child Benefit review");
    expect(page).toContain("Contradictions found");
    expect(page).toContain(`href="/app/letters/${letterBId}"`);
  });

  it("Letter A: verdict, highlights over the stored photo, and 'I've submitted it' for its task", async () => {
    const page = await html(LetterPage(params(letterAId)));
    expect(page).toContain("Matches trusted sources");
    expect(page).toContain(`src="/api/letters/${letterAId}/image"`);
    expect(page).toContain("I&#x27;ve submitted it");
    expect(page).toContain("Filed in your case");
    expect(page).toContain("Delete this letter");
  });

  it("Letter B: contradictions, the official alternative, and the same-case question", async () => {
    const page = await html(LetterPage(params(letterBId)));
    expect(page).toContain("Contradictions found");
    expect(page).toContain("1-800-387-1193");
    expect(page).toContain("claims to relate to your case");
    expect(page).toContain("Keep it separate");
  });

  it("an unclear letter shows the confirmation form", async () => {
    const page = await html(LetterPage(params(blurryId)));
    expect(page).toContain("Please check these against your letter");
    expect(page).toContain("Confirm and re-check");
  });

  it("a letter that hasn't been read yet offers to read it", async () => {
    const page = await html(LetterPage(params(uploadedId)));
    expect(page).toContain("Ready to read");
    expect(page).toContain("Read this letter");
  });

  it("Case page: process, task with checklist, letters, history", async () => {
    const page = await html(CasePage(params(caseId)));
    expect(page).toContain("CRA: Canada Child Benefit review");
    expect(page).toContain("You are here");
    expect(page).toContain("Lease or rental agreement");
    expect(page).toContain("I&#x27;ve submitted it");
    expect(page).toContain("Case created");
  });

  it("an old letter says so: banner, the missed step flagged, and no task 'due' years ago once tracked", async () => {
    const page = await html(LetterPage(params(oldId)));
    expect(page).toContain("This letter is old");
    expect(page).toContain("It&#x27;s dated April 18, 2016 (10 years ago), and its deadline, April 30, 2017, has passed.");
    expect(page).toContain("The deadline for this step was April 30, 2017. It has passed.");
    expect(page).toContain("Ask CRA what you can still do");
    expect(page).not.toContain("you can file an objection by");

    const { caseId: oldCase } = await decideCase(db, signedIn.id, oldId, { decision: "new" });
    const casePage = await html(CasePage(params(oldCase!)));
    expect(casePage).not.toContain("I&#x27;ve submitted it");
    expect(casePage).not.toContain("by April 30, 2017");
    expect(await html(LetterPage(params(oldId)))).toContain("The deadline for this step was April 30, 2017. It has passed.");
  });

  it("someone else's (or a made-up) id is simply not found", async () => {
    const saved = signedIn;
    signedIn = await resolveUser(db, "auth0|pages-other");
    try {
      await expect(LetterPage(params(letterAId))).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(CasePage(params(caseId))).rejects.toThrow("NEXT_NOT_FOUND");
      const inbox = await html(InboxPage());
      expect(inbox).not.toContain("Canada Child Benefit");
    } finally {
      signedIn = saved;
    }
    await expect(LetterPage(params("not-a-uuid"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
