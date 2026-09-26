import { readFile } from "node:fs/promises";
import QRCode from "qrcode";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Box } from "@/lib/contracts";
import { findQrCodes } from "@/lib/qr/decode";
import groundTruth from "@/demo/letters/out/ground-truth.json";

const letter = (f: string) => readFile(`demo/letters/out/${f}`);
const SCAM_URL = "https://cra-canada-verify.example/ccb?ref=8902";

describe("findQrCodes", () => {
  it("decodes the twin letter's QR code from the located box", async () => {
    const [q] = await findQrCodes(await letter("B_cra_twin_scam.png"), [
      { box: groundTruth.B.qr as Box, page: 1, nearbyText: "Scan to verify your identity" },
    ]);
    expect(q.decoded).toBe(SCAM_URL);
    expect(q.nearbyText).toBe("Scan to verify your identity");
  });

  it("falls back to the whole page when the box is wrong", async () => {
    const [q] = await findQrCodes(await letter("B_cra_twin_scam.png"), [{ box: [10, 10, 60, 60], page: 1, nearbyText: null }]);
    expect(q.decoded).toBe(SCAM_URL);
  });

  it("finds a QR code the reader missed, with a normalized box", async () => {
    const found = await findQrCodes(await letter("B_cra_twin_scam.png"), []);
    expect(found).toHaveLength(1);
    expect(found[0].decoded).toBe(SCAM_URL);
    const [ymin, xmin, ymax, xmax] = found[0].box!;
    expect(ymin).toBeGreaterThan(650);
    expect(xmin).toBeGreaterThan(650);
    expect(ymax).toBeLessThan(900);
    expect(xmax).toBeLessThan(950);
  });

  it("returns nothing for a letter without a QR code", async () => {
    expect(await findQrCodes(await letter("A_cra_ccb_review.png"), [])).toEqual([]);
  });

  it("strips control characters and caps hostile payloads", async () => {
    const payload = `javascript:alert(1)\u0007${"x".repeat(2080)}`;
    const png = await QRCode.toBuffer(payload, { width: 1100, margin: 4, errorCorrectionLevel: "L" });
    const page = await sharp({ create: { width: 1300, height: 1300, channels: 3, background: "#fff" } })
      .composite([{ input: png, left: 100, top: 100 }])
      .png()
      .toBuffer();
    const [q] = await findQrCodes(page, []);
    expect(q.decoded).not.toContain("\u0007");
    expect(q.decoded!.length).toBeLessThanOrEqual(2048);
  });
});
