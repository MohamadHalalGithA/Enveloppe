import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { openPglite } from "@/lib/db/client";

it("opens a file-backed PGlite database even when its parent directories don't exist yet", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "enveloppe-"));
  try {
    const db = await openPglite(path.join(root, "missing", "parents", "db"));
    const rows = await db.execute(sql`select count(*)::int as n from users`);
    expect(rows).toBeTruthy(); // migrations applied: the users table exists
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
