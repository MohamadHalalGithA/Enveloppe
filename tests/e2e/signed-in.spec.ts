import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The full twin-letter demo while signed in, through Auth0's real login page. Needs an Auth0 test user:
 *   E2E_USER=… E2E_PASSWORD=… npm run test:e2e
 * and the app's Allowed Callback URLs must include <baseURL>/auth/callback. Uses real Gemini unless the
 * server runs with DEMO_MODE=offline. Cleans up after itself.
 */
const user = process.env.E2E_USER;
const password = process.env.E2E_PASSWORD;
const sample = (f: string) => path.join(process.cwd(), "demo", "letters", "out", f);

test.skip(!user || !password, "Set E2E_USER and E2E_PASSWORD (an Auth0 test user) to run the signed-in flow.");

test("sign in, catch the scam twin, and track the real letter to 'waiting'", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/app");
  // Auth0 Universal Login
  await page.getByLabel(/email/i).fill(user!);
  await page.getByLabel(/password/i).first().fill(password!);
  await page.getByRole("button", { name: /continue|log in/i }).first().click();
  await expect(page.getByRole("heading", { name: "Civic Inbox" })).toBeVisible({ timeout: 60_000 });

  // Letter A: upload → read → consistent → track as a case.
  await page.getByLabel("Photo of the letter").setInputFiles(sample("A_cra_ccb_review.png"));
  await expect(page.getByRole("heading", { name: "Matches trusted sources" })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Track it as a case" }).click();
  await expect(page.getByText("Filed in your case")).toBeVisible();

  // Letter B: the scam twin conflicts with that case.
  await page.goto("/app");
  await page.getByLabel("Photo of the letter").setInputFiles(sample("B_cra_twin_scam.png"));
  await expect(page.getByRole("heading", { name: "Contradictions found" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("claims to relate to your case")).toBeVisible();
  await page.getByRole("button", { name: "Keep it separate" }).click();
  await expect(page.getByText("You chose to keep this letter separate")).toBeVisible();

  // Proof of submission on the case page.
  await page.goto("/app");
  await page.getByRole("link", { name: /Canada child benefit review/i }).first().click();
  await page.getByRole("button", { name: "I've submitted it" }).click();
  await page.getByLabel(/Confirmation number/).fill("E2E-77310");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Waiting for the government")).toBeVisible();

  // Clean up: delete the case (and its letter) and the scam letter.
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete this case" }).click();
  await expect(page.getByRole("heading", { name: "Civic Inbox" })).toBeVisible();
  await page.getByRole("link", { name: /Contradictions found/ }).first().click();
  await page.getByRole("button", { name: "Delete this letter" }).click();
  await expect(page.getByRole("heading", { name: "Civic Inbox" })).toBeVisible();
});
