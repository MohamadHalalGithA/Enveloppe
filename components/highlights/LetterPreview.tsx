"use client";

import type { LetterResult, VerificationItem } from "@/lib/contracts";

interface Props {
  image: LetterResult["image"];
  items: VerificationItem[];
  selectedId: string | null;
}

/**
 * Letter image with grounded highlights. Boxes are [ymin,xmin,ymax,xmax] in 0–1000 over the
 * sanitized image, so an SVG with viewBox 0 0 1000 1000 stretched over the image lines up at any size.
 * Until real uploads exist, a placeholder page draws each item's quote at its box position.
 */
export function LetterPreview({ image, items, selectedId }: Props) {
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const aspect = image ? `${image.width} / ${image.height}` : "8.5 / 11";

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm" style={{ aspectRatio: aspect }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- private, owner-checked route; not for next/image optimization
          <img src={image.url} alt="Your uploaded letter" className="absolute inset-0 h-full w-full" />
        ) : (
          <PlaceholderPage items={items} />
        )}
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {selected && selected.highlight.boxes.length > 0 && (
            <>
              <defs>
                <mask id="hl-mask">
                  <rect width="1000" height="1000" fill="white" />
                  {selected.highlight.boxes.map((b, i) => (
                    <rect key={i} {...toRect(b, 8)} fill="black" />
                  ))}
                </mask>
              </defs>
              <rect width="1000" height="1000" fill="rgb(15 23 42 / 0.35)" mask="url(#hl-mask)" />
              {selected.highlight.boxes.map((b, i) => (
                <rect
                  key={i}
                  {...toRect(b, 8)}
                  fill="none"
                  stroke="rgb(3 105 161)"
                  strokeWidth={4}
                  strokeDasharray={selected.highlight.lowConfidence ? "10 8" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          )}
        </svg>
      </div>
      <figcaption aria-live="polite" className="min-h-6 text-sm text-slate-700">
        {selected?.highlight.quote ? (
          <>
            From the letter: <q className="font-mono">{selected.highlight.quote}</q>
            {selected.highlight.lowConfidence && " (location uncertain)"}
          </>
        ) : (
          "Tap a row to see where it appears on the letter."
        )}
      </figcaption>
    </figure>
  );
}

function toRect([ymin, xmin, ymax, xmax]: [number, number, number, number], pad: number) {
  const x = Math.max(0, xmin - pad);
  const y = Math.max(0, ymin - pad);
  return { x, y, width: Math.min(1000, xmax + pad) - x, height: Math.min(1000, ymax + pad) - y };
}

function PlaceholderPage({ items }: { items: VerificationItem[] }) {
  return (
    <div className="absolute inset-0">
      <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-slate-400">
        Letter image placeholder
      </p>
      {items.flatMap((item) =>
        item.highlight.boxes.slice(0, 1).map((b, i) => (
          <span
            key={`${item.id}-${i}`}
            className="absolute overflow-hidden text-[clamp(6px,1.4vw,12px)] leading-tight text-slate-500"
            style={{
              top: `${b[0] / 10}%`,
              left: `${b[1] / 10}%`,
              height: `${(b[2] - b[0]) / 10}%`,
              width: `${(b[3] - b[1]) / 10}%`,
            }}
          >
            {item.claimType === "qr" ? "▦ QR" : item.highlight.quote}
          </span>
        )),
      )}
    </div>
  );
}
