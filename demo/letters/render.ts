/**
 * Renders the synthetic demo letters to PNG (npm run demo:letters).
 * Output: demo/letters/out/*.png + ground-truth.json (normalized 0–1000 boxes per keyed line).
 * Sample E is Sample A photographed badly: glare over the date, a handwritten note, tilt, blur, JPEG.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { LETTER_A, LETTERS, type LetterSpec, type Line } from "./specs";

const W = 1275;
const H = 1650;
const OUT = path.join(import.meta.dirname, "out");
const FONT = "Arial, Helvetica, sans-serif";

type Box = [number, number, number, number];

const px = (nx: number) => (nx / 1000) * W;
const py = (ny: number) => (ny / 1000) * H;
const round = (n: number) => Math.round(n * 10) / 10;

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Approximate text box. Arial averages ~0.5em per character (bold slightly wider). */
function lineBox(l: Line): Box {
  const size = l.size ?? 22;
  const width = l.text.length * size * (l.weight === "bold" ? 0.56 : 0.5);
  return [round(l.y), round(l.x), round(l.y + ((size * 1.2) / H) * 1000), round(Math.min(1000, l.x + (width / W) * 1000))];
}

function svgFor(spec: LetterSpec, extra = ""): string {
  const texts = spec.lines
    .map((l) => {
      const size = l.size ?? 22;
      return `<text x="${px(l.x)}" y="${py(l.y) + size * 0.85}" font-family="${l.font ?? FONT}" font-size="${size}" font-weight="${l.weight ?? "normal"}" fill="${l.color ?? "#111827"}">${escapeXml(l.text)}</text>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="100%" height="100%" fill="#ffffff"/>
<line x1="${px(60)}" y1="${py(108)}" x2="${px(940)}" y2="${py(108)}" stroke="#9ca3af" stroke-width="2"/>
${texts}
${extra}
</svg>`;
}

async function renderLetter(spec: LetterSpec): Promise<{ png: Buffer; truth: Record<string, Box> }> {
  const truth: Record<string, Box> = {};
  for (const l of spec.lines) if (l.key) truth[l.key] = lineBox(l);

  let img = sharp(Buffer.from(svgFor(spec)));
  if (spec.qr) {
    const qr = await QRCode.toBuffer(spec.qr.url, { width: spec.qr.sizePx, margin: 1 });
    const left = Math.round(px(spec.qr.x));
    const top = Math.round(py(spec.qr.y));
    img = sharp(await img.png().toBuffer()).composite([{ input: qr, left, top }]);
    truth[spec.qr.key] = [
      round(spec.qr.y),
      round(spec.qr.x),
      round(((top + spec.qr.sizePx) / H) * 1000),
      round(((left + spec.qr.sizePx) / W) * 1000),
    ];
  }
  return { png: await img.png().toBuffer(), truth };
}

/** Sample E: Sample A with glare over the date/reference, a handwritten note, tilt, blur and heavy JPEG. */
async function renderLowQuality(): Promise<Buffer> {
  const glare = `<defs><radialGradient id="g"><stop offset="0%" stop-color="#fff" stop-opacity="0.97"/>
    <stop offset="70%" stop-color="#fff" stop-opacity="0.85"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${px(800)}" cy="${py(150)}" rx="${px(230)}" ry="${py(55)}" fill="url(#g)"/>
    <ellipse cx="${px(330)}" cy="${py(500)}" rx="${px(160)}" ry="${py(22)}" fill="url(#g)"/>
    <text x="${px(620)}" y="${py(640)}" font-family="Segoe Script, Comic Sans MS, cursive" font-size="34" fill="#1d3a8a" transform="rotate(-8 ${px(620)} ${py(640)})">call Tues? ask about CCB</text>`;
  const base = await sharp(Buffer.from(svgFor(LETTER_A, glare))).png().toBuffer();
  return sharp(base)
    .rotate(3.5, { background: "#d6d3cd" })
    .blur(1.4)
    .modulate({ brightness: 0.93 })
    .resize({ width: 900 })
    .jpeg({ quality: 45 })
    .toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const groundTruth: Record<string, Record<string, Box>> = {};
  for (const spec of LETTERS) {
    const { png, truth } = await renderLetter(spec);
    await writeFile(path.join(OUT, spec.file), png);
    groundTruth[spec.id] = truth;
    console.log(`rendered ${spec.file}`);
  }
  await writeFile(path.join(OUT, "E_low_quality.jpg"), await renderLowQuality());
  console.log("rendered E_low_quality.jpg");
  await writeFile(path.join(OUT, "ground-truth.json"), JSON.stringify(groundTruth, null, 2) + "\n");
  console.log("wrote ground-truth.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
