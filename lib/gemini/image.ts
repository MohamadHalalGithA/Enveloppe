import { PipelineError } from "@/lib/errors";

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Identify an image by magic bytes. Never trust a client-supplied filename or content type. */
export function detectImageMime(buf: Uint8Array): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)
  )
    return "image/png";
  if (
    buf.length >= 12 &&
    String.fromCharCode(...buf.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

export function assertModelImage(buf: Uint8Array): ImageMime {
  if (buf.length > MAX_IMAGE_BYTES) throw new PipelineError("IMAGE_TOO_LARGE");
  const mime = detectImageMime(buf);
  if (!mime) throw new PipelineError("IMAGE_UNSUPPORTED");
  return mime;
}
