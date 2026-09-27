import { createHash } from "node:crypto";
import sharp from "sharp";
import { PipelineError } from "@/lib/errors";
import { detectImageMime } from "@/lib/gemini/image";

/**
 * Upload sanitizer (Blueprint Parts 5 and 21). Every stored and analyzed image goes through here:
 *   magic-byte check → decode with a pixel limit (decompression bombs) → bake in EXIF rotation →
 *   cap the long edge → re-encode as JPEG. Re-encoding drops EXIF/GPS and any embedded payloads.
 * Gemini's boxes are relative to this exact image, and it's the same image the user sees highlighted.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_EDGE = 2000;

export interface SanitizedImage {
  bytes: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  /** Hash of the original upload: the same photo uploaded twice maps to the same letter. */
  sha256: string;
}

export async function sanitizeUpload(original: Buffer): Promise<SanitizedImage> {
  if (original.length === 0 || !detectImageMime(original)) throw new PipelineError("IMAGE_UNSUPPORTED");
  if (original.length > MAX_UPLOAD_BYTES) throw new PipelineError("IMAGE_TOO_LARGE");
  try {
    const { data, info } = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      mime: "image/jpeg",
      width: info.width,
      height: info.height,
      sha256: createHash("sha256").update(original).digest("hex"),
    };
  } catch {
    throw new PipelineError("IMAGE_UNREADABLE");
  }
}
