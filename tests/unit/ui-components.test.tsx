// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseDecisionButtons } from "@/components/actions/ActionButtons";
import { ConfirmFieldsForm } from "@/components/actions/ConfirmFieldsForm";
import { SubmitProofForm } from "@/components/actions/SubmitProofForm";
import { UploadPanel } from "@/components/upload/UploadPanel";
import { ListenPanel } from "@/components/voice/ListenPanel";
import { confirmBody, confirmInputs } from "@/lib/ui/confirm-fields";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const LETTER = "00000000-0000-4000-8000-0000000000a1";
const CASE = "00000000-0000-4000-8000-0000000000ca";
const TASK = "00000000-0000-4000-8000-00000000007a";

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let responses: Record<string, { status: number; body?: unknown }>;

beforeEach(() => {
  calls = [];
  responses = {};
  router.push.mockClear();
  router.refresh.mockClear();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body instanceof FormData ? "form" : undefined;
    calls.push({ url, method: init.method ?? "GET", body });
    const r = responses[url] ?? { status: 200, body: {} };
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status });
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("confirm-fields mapping", () => {
  it("maps uncertain fields to what the confirm API accepts, once each", () => {
    const { editable, checkOnly } = confirmInputs([
      { path: "issueDate", label: "Date printed on the letter", value: "Septem?er 14" },
      { path: "printedDeadlines[0]", label: "Deadline printed on the letter", value: null },
      { path: "identifiers[0]", label: "Reference number", value: "••••-•••-••••-4471" },
      { path: "identifiers[1]", label: "Reference number", value: null },
      { path: "phones[0]", label: "Phone number", value: "1-800-38?-1193" },
    ]);
    expect(editable.map((e) => e.key)).toEqual(["issueDate", "printedDeadline", "reference"]);
    expect(checkOnly.map((c) => c.path)).toEqual(["phones[0]"]);
  });

  it("builds the request body from non-empty inputs only", () => {
    expect(confirmBody({ issueDate: "2026-09-14", reference: "  ", taxYear: "2025" })).toEqual({ issueDate: "2026-09-14", taxYear: 2025 });
  });
});

describe("UploadPanel", () => {
  it("uploads, analyzes, then opens the result", async () => {
    responses["/api/letters"] = { status: 201, body: { letterId: LETTER, status: "UPLOADED", existing: false } };
    render(<UploadPanel />);
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "letter.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Photo of the letter"), file);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/app/letters/${LETTER}`));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/letters", `POST /api/letters/${LETTER}/analyze`]);
  });

  it("refuses non-image files before uploading", async () => {
    render(<UploadPanel />);
    const pdf = new File(["%PDF"], "letter.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Photo of the letter"), pdf, { applyAccept: false });
    expect((await screen.findByRole("alert")).textContent).toContain("JPG, PNG or WebP");
    expect(calls).toEqual([]);
  });

  it("keeps the letter and offers a retry when the reader is busy", async () => {
    responses["/api/letters"] = { status: 201, body: { letterId: LETTER, status: "UPLOADED", existing: false } };
    responses[`/api/letters/${LETTER}/analyze`] = {
      status: 503,
      body: { error: { code: "SERVICE_UNAVAILABLE", message: "The reading service is busy. Your letter is saved; try again in a minute." } },
    };
    render(<UploadPanel />);
    await userEvent.upload(screen.getByLabelText("Photo of the letter"), new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Your letter is saved");
    responses[`/api/letters/${LETTER}/analyze`] = { status: 200, body: {} };
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/app/letters/${LETTER}`));
  });
});

describe("CaseDecisionButtons", () => {
  it("sends the chosen decision and refreshes", async () => {
    render(
      <CaseDecisionButtons
        letterId={LETTER}
        actions={[
          { label: "Keep it separate", kind: "keep_separate", primary: true },
          { label: "Yes, same case", kind: "link", caseId: CASE },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, same case" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls).toEqual([{ url: `/api/letters/${LETTER}/case`, method: "POST", body: { decision: "link", caseId: CASE } }]);
  });

  it("asks before linking a conflicting letter, and does nothing if the user cancels", async () => {
    vi.stubGlobal("confirm", () => false);
    render(<CaseDecisionButtons letterId={LETTER} actions={[{ label: "It's the same case", kind: "link", caseId: CASE, confirm: "Sure?" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "It's the same case" }));
    expect(calls).toEqual([]);
  });

  it("shows the API's safe error message", async () => {
    responses[`/api/letters/${LETTER}/unlink`] = { status: 409, body: { error: { code: "NOT_FILED", message: "This letter isn't in a case" } } };
    render(<CaseDecisionButtons letterId={LETTER} actions={[{ label: "Undo", kind: "unlink" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((await screen.findByRole("alert")).textContent).toContain("This letter isn't in a case");
  });
});

describe("ConfirmFieldsForm", () => {
  it("posts only what the user typed and re-renders", async () => {
    render(
      <ConfirmFieldsForm
        letterId={LETTER}
        fields={[
          { path: "issueDate", label: "Date printed on the letter", value: "Septem?er 14, 2026" },
          { path: "identifiers[0]", label: "Reference number", value: "••••-•••-••••-44?1" },
        ]}
      />,
    );
    expect(screen.getByText(/We read: .Septem\?er 14, 2026./)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Reference number/), "2026-CCB-5831-4471");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and re-check" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls).toEqual([{ url: `/api/letters/${LETTER}/confirm`, method: "POST", body: { reference: "2026-CCB-5831-4471" } }]);
  });

  it("asks for at least one value", async () => {
    render(<ConfirmFieldsForm letterId={LETTER} fields={[{ path: "taxYear", label: "Tax or benefit year", value: "20?5" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm and re-check" }));
    expect((await screen.findByRole("alert")).textContent).toContain("at least one value");
    expect(calls).toEqual([]);
  });
});

describe("SubmitProofForm", () => {
  it("saves the confirmation number and refreshes the case", async () => {
    render(<SubmitProofForm taskId={TASK} />);
    await userEvent.click(screen.getByRole("button", { name: "I've submitted it" }));
    await userEvent.type(screen.getByLabelText(/Confirmation number/), "CRA-77310");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls).toEqual([
      { url: `/api/tasks/${TASK}/complete`, method: "POST", body: { confirmationNumber: "CRA-77310", notes: null } },
    ]);
  });
});

describe("ListenPanel", () => {
  it("asks the API for the chosen language and shows right-to-left text with the audio", async () => {
    responses[`/api/letters/${LETTER}/speech`] = {
      status: 200,
      body: { lang: "ar", languageName: "العربية", dir: "rtl", text: "هذا طلب", machineTranslated: true, audioUrl: `/api/letters/${LETTER}/speech?lang=ar`, note: null },
    };
    const { container } = render(<ListenPanel letterId={LETTER} />);
    await userEvent.selectOptions(screen.getByLabelText("Listen in my language"), "ar");
    await userEvent.click(screen.getByRole("button", { name: /Listen/ }));
    const text = await screen.findByText("هذا طلب");
    expect(text.getAttribute("dir")).toBe("rtl");
    expect(text.getAttribute("lang")).toBe("ar");
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(`/api/letters/${LETTER}/speech?lang=ar`);
    expect(screen.getByText(/Machine translation/)).toBeTruthy();
    expect(calls).toEqual([{ url: `/api/letters/${LETTER}/speech`, method: "POST", body: { lang: "ar" } }]);
  });

  it("plays ready-made clips in the demo without calling the server", async () => {
    const clip = (lang: string, dir: "ltr" | "rtl") => ({
      lang,
      languageName: lang,
      dir,
      text: `text-${lang}`,
      machineTranslated: lang !== "en",
      audioUrl: `/demo-audio/A-${lang}.mp3`,
      note: null,
    });
    render(<ListenPanel letterId={LETTER} preloaded={{ ar: clip("ar", "rtl"), en: clip("en", "ltr") }} />);
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["en", "ar"]);
    await userEvent.click(screen.getByRole("button", { name: /Listen/ }));
    expect(await screen.findByText("text-ar")).toBeTruthy();
    expect(calls).toEqual([]);
  });
});
