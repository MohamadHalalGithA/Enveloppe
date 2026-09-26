import { describe, expect, it } from "vitest";
import { AgencyCodeZ, DocTypeZ } from "@/lib/contracts";
import { EXTRACTION_RESPONSE_SCHEMA } from "@/lib/gemini/schema";

type Node = Record<string, unknown>;

function* walk(node: unknown, path = "$"): Generator<[string, Node]> {
  if (Array.isArray(node)) {
    for (const [i, n] of node.entries()) yield* walk(n, `${path}[${i}]`);
  } else if (node && typeof node === "object") {
    yield [path, node as Node];
    for (const [k, v] of Object.entries(node)) yield* walk(v, `${path}.${k}`);
  }
}

const S = EXTRACTION_RESPONSE_SCHEMA as Node & { properties: Record<string, Node> };

describe("Gemini response schema", () => {
  it("uses only keywords Gemini accepts, and no numeric bounds (they exceed Gemini's complexity limit)", () => {
    const banned = ["minimum", "maximum", "pattern", "maxLength", "minLength", "const", "$schema", "exclusiveMinimum"];
    for (const [path, node] of walk(S)) {
      for (const key of banned) expect(Object.hasOwn(node, key) && !path.endsWith(".properties"), `${path}.${key}`).toBe(false);
      if ("items" in node) expect(typeof node.items, `${path}.items`).toBe("object");
    }
  });

  it("derives enums from the shared contract", () => {
    const agencyValue = (S.properties.agency.properties as Record<string, Node>).value;
    const docValue = (S.properties.documentType.properties as Record<string, Node>).value;
    const enumOf = (n: Node) => ((n.anyOf as Node[]).find((b) => b.type !== "null") as Node).enum;
    expect(enumOf(agencyValue)).toEqual(AgencyCodeZ.options);
    expect(enumOf(docValue)).toEqual(DocTypeZ.options);
    expect(S.properties.schemaVersion.enum).toEqual(["1"]);
  });

  it("asks for the verbatim quote before the value in every field", () => {
    let fields = 0;
    for (const [, node] of walk(S)) {
      const order = node.propertyOrdering as string[] | undefined;
      if (order?.includes("sourceText") && order.includes("value")) {
        fields++;
        expect(order[0]).toBe("sourceText");
      }
    }
    expect(fields).toBeGreaterThan(10);
  });

  it("constrains boxes to exactly four numbers", () => {
    const box = (S.properties.issueDate.properties as Record<string, Node>).box;
    const arr = (box.anyOf as Node[]).find((b) => b.type === "array") as Node;
    expect(arr).toMatchObject({ minItems: 4, maxItems: 4, items: { type: "number" } });
  });
});
