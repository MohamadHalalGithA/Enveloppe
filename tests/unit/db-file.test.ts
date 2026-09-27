import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
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

it("opens a folder once per process, even when this module is loaded again (next dev hot reload)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "enveloppe-"));
  try {
    const dir = path.join(root, "db");
    const first = await openPglite(dir);
    vi.resetModules();
    const reloaded = await import("@/lib/db/client");
    expect(await reloaded.openPglite(dir)).toBe(first); // a second PGlite on the same folder would corrupt it
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

it("refuses a folder another running process holds, and takes over a lock left by one that exited", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "enveloppe-"));
  try {
    const busy = path.join(root, "busy");
    await writeFile(`${busy}.lock`, String(process.ppid)); // the test runner: running, and not us
    await expect(openPglite(busy)).rejects.toThrow(/in use by another process/);

    const stale = path.join(root, "stale");
    await writeFile(`${stale}.lock`, String(spawnSync(process.execPath, ["-e", ""]).pid)); // has exited
    await expect(openPglite(stale)).resolves.toBeTruthy();
    expect(await readFile(`${stale}.lock`, "utf8")).toBe(String(process.pid));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
