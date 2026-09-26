import jsQR from "jsqr";
import sharp, { type Sharp } from "sharp";
import type { Box } from "@/lib/contracts";

/**
 * Server-side QR decoding (Blueprint Part 9). The server never trusts a client-decoded value, never
 * opens the decoded link, and treats the payload as untrusted text for the URL analyzer.
 */

export interface QrFinding {
  box: Box | null;
  page: number;
  nearbyText: string | null;
  /** Decoded payload (capped, control characters stripped), or null if unreadable. */
  decoded: string | null;
}

const MAX_PAYLOAD = 2048;

function clean(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_PAYLOAD);
}

async function tryDecode(img: Sharp): Promise<{ text: string; px: { x: number; y: number }[] } | null> {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  if (!result?.data) return null;
  const l = result.location;
  return {
    text: result.data,
    px: [l.topLeftCorner, l.topRightCorner, l.bottomLeftCorner, l.bottomRightCorner].map((p) => ({
      x: p.x / info.width,
      y: p.y / info.height,
    })),
  };
}

/** Several preprocessing variants: jsQR fails on small or low-contrast codes that a 2× or thresholded copy reads. */
async function decodeRegion(image: Buffer, region?: { left: number; top: number; width: number; height: number }) {
  const base = () => (region ? sharp(image).rotate().extract(region) : sharp(image).rotate());
  const w = region?.width ?? (await sharp(image).rotate().metadata()).width ?? 1000;
  const variants = [
    () => base(),
    () => base().resize({ width: Math.min(2400, w * 2) }),
    () => base().greyscale().normalise().threshold(128).toColourspace("srgb"),
  ];
  for (const v of variants) {
    const r = await tryDecode(v()).catch(() => null);
    if (r) return r;
  }
  return null;
}

export async function findQrCodes(
  image: Buffer,
  located: { box: Box | null; page: number; nearbyText: string | null }[],
): Promise<QrFinding[]> {
  const meta = await sharp(image).rotate().metadata();
  const W = meta.autoOrient?.width ?? meta.width ?? 0;
  const H = meta.autoOrient?.height ?? meta.height ?? 0;

  const results: QrFinding[] = [];
  for (const q of located) {
    let decoded: string | null = null;
    if (q.box && W && H) {
      const [ymin, xmin, ymax, xmax] = q.box;
      const padX = ((xmax - xmin) / 1000) * W * 0.3;
      const padY = ((ymax - ymin) / 1000) * H * 0.3;
      const left = Math.max(0, Math.floor((xmin / 1000) * W - padX));
      const top = Math.max(0, Math.floor((ymin / 1000) * H - padY));
      const right = Math.min(W, Math.ceil((xmax / 1000) * W + padX));
      const bottom = Math.min(H, Math.ceil((ymax / 1000) * H + padY));
      if (right - left > 8 && bottom - top > 8) {
        decoded = (await decodeRegion(image, { left, top, width: right - left, height: bottom - top }))?.text ?? null;
      }
    }
    // Box missing or off: fall back to scanning the whole page.
    decoded ??= (await decodeRegion(image))?.text ?? null;
    results.push({ ...q, decoded: decoded === null ? null : clean(decoded) });
  }

  // The reader may miss a QR code entirely; a whole-page scan still catches it.
  if (located.length === 0) {
    const r = await decodeRegion(image);
    if (r) {
      const ys = r.px.map((p) => p.y * 1000);
      const xs = r.px.map((p) => p.x * 1000);
      const box: Box = [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)].map((n) =>
        Math.max(0, Math.min(1000, Math.round(n))),
      ) as Box;
      results.push({ box, page: 1, nearbyText: null, decoded: clean(r.text) });
    }
  }
  return results;
}
