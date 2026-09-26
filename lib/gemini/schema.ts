import { z } from "zod";
import { ExtractionZ } from "@/lib/contracts/extraction";

/**
 * Gemini `responseJsonSchema`, derived from the shared Zod contract so the two can't drift.
 * Gemini supports only a subset of JSON Schema, so unsupported keywords are dropped here and the
 * full Zod contract is enforced after the response arrives.
 *
 * Numeric minimum/maximum are dropped on purpose: Gemini rejects schemas above a constraint-complexity
 * limit (generic 400 INVALID_ARGUMENT), and the full schema with numeric bounds exceeds it. Zod and the
 * Contract Guard still enforce ranges (e.g. boxes within 0-1000) after the response arrives.
 */

const SUPPORTED = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items",
  "prefixItems", "minItems", "maxItems", "anyOf", "oneOf", "properties",
  "additionalProperties", "required", "propertyOrdering",
]);

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

type Json = Record<string, unknown>;

function adapt(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(adapt);
  if (!node || typeof node !== "object") return node;
  const src = node as Json;
  const out: Json = {};

  if ("const" in src) out.enum = [src.const];
  if (src.pattern === DATE_PATTERN) {
    out.format = "date";
    out.description = "Calendar date as YYYY-MM-DD.";
  }
  // Boxes: a 4-tuple becomes a plain 4-number array, which models handle more reliably than prefixItems.
  if (Array.isArray(src.prefixItems) && src.prefixItems.length === 4 && src.maxItems === 4) {
    return {
      type: "array",
      items: { type: "number" },
      minItems: 4,
      maxItems: 4,
      description: "Bounding box [ymin, xmin, ymax, xmax] normalized 0-1000 over the image.",
    };
  }

  for (const [k, v] of Object.entries(src)) {
    if (!SUPPORTED.has(k) || k in out) continue;
    if (k === "items" && typeof v === "boolean") continue;
    if (k === "properties") {
      // Quote first: the model writes the verbatim sourceText before the value it derives from it.
      const keys = Object.keys(v as Json).sort((a, b) => Number(b === "sourceText") - Number(a === "sourceText"));
      out.properties = Object.fromEntries(keys.map((pk) => [pk, adapt((v as Json)[pk])]));
      out.propertyOrdering = keys;
    } else {
      out[k] = adapt(v);
    }
  }
  return out;
}

export const EXTRACTION_RESPONSE_SCHEMA = adapt(
  z.toJSONSchema(ExtractionZ, { target: "draft-2020-12" }),
) as Json;
