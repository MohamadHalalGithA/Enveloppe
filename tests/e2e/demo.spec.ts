import { expect, test, type Page } from "@playwright/test";

/** The public twin-letter demo in a real browser. Also fails on any CSP violation or page error. */

function watchForErrors(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to|Hydration|hydrat/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

test("walk the twin-letter demo: inbox → scam twin → highlight → listen in Arabic", async ({ page }) => {
  const problems = watchForErrors(page);

  await page.goto("/");
  await page.getByRole("link", { name: "See the demo (no sign-in)" }).click();
  await expect(page.getByRole("heading", { name: "Civic Inbox" })).toBeVisible();
  await expect(page.getByText("CRA: 2023 reassessment")).toBeVisible();
  await expect(page.getByText(/CRA: Canada child benefit review/i)).toBeVisible();
  await expect(page.getByText("IRCC: biometrics request")).toBeVisible();

  // The scam twin.
  await page.getByRole("link", { name: /Contradictions found/ }).first().click();
  await expect(page.getByRole("heading", { name: "Contradictions found" })).toBeVisible();
  await expect(page.getByText("claims to relate to your case")).toBeVisible();
  await expect(page.getByText("1-800-387-1193").first()).toBeVisible();

  // Grounded highlight: selecting the phone row draws a box on the letter image (proves JS runs under the CSP).
  const phoneRow = page.getByRole("button", { name: /Phone number/ }).first();
  await phoneRow.click();
  await expect(phoneRow).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("figure svg rect[stroke]").first()).toBeAttached();
  await expect(page.locator("figcaption")).toContainText("555-0147");

  // Listen in Arabic (pre-generated clip in the demo).
  await page.getByLabel("Listen in my language").selectOption("ar");
  await page.getByRole("button", { name: /Listen/ }).click();
  const arabic = page.locator('p[dir="rtl"][lang="ar"]');
  await expect(arabic).toBeVisible();
  await expect(arabic).toContainText("1-800-387-1193");
  await expect(page.locator("audio")).toHaveAttribute("src", /\/demo-audio\/B-ar\.mp3$/);

  expect(problems).toEqual([]);
});

test("the legitimate letter shows its deadline, process and official channel", async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto("/demo");
  // Two letters are requests for documents (A, and its blurry photo E); pick the one that checked out.
  await page.getByRole("link", { name: /Matches trusted sources.*Request for documents/ }).first().click();
  await expect(page.getByRole("heading", { name: "Matches trusted sources" })).toBeVisible();
  await expect(page.getByText("You are here")).toBeVisible();
  await expect(page.getByText("October 14, 2026").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "CRA Submit documents online" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("clickable things look clickable; read-only demo buttons don't", async ({ page, isMobile }) => {
  await page.goto("/");
  const demo = page.getByRole("link", { name: "See the demo (no sign-in)" });
  if (!isMobile) {
    // Tailwind only applies hover styles on devices that can hover.
    const before = await demo.evaluate((el) => getComputedStyle(el).backgroundColor);
    await demo.hover();
    await expect.poll(() => demo.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
  }
  await demo.click();
  await page.getByRole("link", { name: /Matches trusted sources.*Request for documents/ }).first().click();
  await expect(page.getByRole("button", { name: /Listen/ })).toHaveCSS("cursor", "pointer");
  await expect(page.getByRole("button", { name: "I've submitted it" })).toHaveCSS("cursor", "not-allowed");
});
