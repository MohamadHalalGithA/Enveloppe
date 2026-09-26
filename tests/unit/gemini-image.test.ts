import { describe, expect, it } from "vitest";
import { assertModelImage, detectImageMime, MAX_IMAGE_BYTES } from "@/lib/gemini/image";

const bytes = (...b: number[]) => Uint8Array.from(b);

describe("detectImageMime", () => {
  it("identifies JPEG, PNG and WebP by magic bytes", () => {
    expect(detectImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectImageMime(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "latin1"))).toBe("image/webp");
  });

  it("rejects everything else, including PDFs and HTML", () => {
    expect(detectImageMime(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(detectImageMime(Buffer.from("<html><script>"))).toBeNull();
    expect(detectImageMime(bytes())).toBeNull();
  });
});

describe("assertModelImage", () => {
  it("rejects oversized and unsupported input with safe error codes", () => {
    expect(() => assertModelImage(Buffer.from("%PDF-1.7"))).toThrow(expect.objectContaining({ code: "IMAGE_UNSUPPORTED" }));
    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    huge.set([0xff, 0xd8, 0xff]);
    expect(() => assertModelImage(huge)).toThrow(expect.objectContaining({ code: "IMAGE_TOO_LARGE" }));
  });
});
