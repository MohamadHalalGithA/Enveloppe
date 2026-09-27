import "server-only";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./types";

/**
 * Database connection (lazy, so `next build` works without a database).
 *   DATABASE_URL=postgres://…     → node-postgres (production; e.g. Postgres on the Vultr VM)
 *   DATABASE_URL=pglite:./.data/db → PGlite: real Postgres compiled to WASM, in-process, no Docker (local dev)
 * Migrations in db/migrations are applied on first connection (idempotent).
 * Every query on private data must be scoped by the user id from requireUser() (see CLAUDE.md).
 *
 * One connection per process, kept on globalThis: `next dev` hot reloads can evaluate this module again, and two
 * PGlite instances on one folder corrupt it for good ("PANIC: could not locate a valid checkpoint record").
 * A lock file next to the folder keeps a second process out too (e.g. `npm run demo:reset` during `npm run dev`).
 */

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "db", "migrations");

const shared = globalThis as typeof globalThis & {
  __enveloppeDb?: Promise<Db>;
  __enveloppePglite?: Map<string, Promise<Db>>;
};

export function getDb(): Promise<Db> {
  shared.__enveloppeDb ??= open().catch((e) => {
    shared.__enveloppeDb = undefined; // allow a retry after a transient failure
    throw e;
  });
  return shared.__enveloppeDb;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("pglite:")) return openPglite(url.slice("pglite:".length) || undefined);

  const [{ Pool }, { drizzle }, { migrate }, schema] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
    import("./schema"),
  ]);
  const db = drizzle(new Pool({ connectionString: url, max: 10 }), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Db;
}

/**
 * In memory when `dataDir` is undefined (tests: always a fresh database). A folder is opened once per process
 * and shared by every caller.
 */
export function openPglite(dataDir?: string): Promise<Db> {
  if (!dataDir) return createPglite(undefined);
  const dir = path.resolve(dataDir);
  const folders = (shared.__enveloppePglite ??= new Map());
  let db = folders.get(dir);
  if (!db) {
    db = createPglite(dir).catch((e) => {
      folders.delete(dir);
      throw e;
    });
    folders.set(dir, db);
  }
  return db;
}

async function createPglite(dir: string | undefined): Promise<Db> {
  if (dir) {
    // PGlite creates its own directory but not missing parents (e.g. ./.data on a fresh clone).
    await mkdir(path.dirname(dir), { recursive: true });
    lockFolder(dir);
  }
  const [{ PGlite }, { drizzle }, { migrate }, schema] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("./schema"),
  ]);
  try {
    const db = drizzle(new PGlite(dir), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return db as unknown as Db;
  } catch (e) {
    if (!dir) throw e;
    throw new Error(
      `Couldn't open the local database in ${dir}. If it's damaged, stop the server, move that folder aside and start again: a new, empty one is created.`,
      { cause: e },
    );
  }
}

/** Refuses a folder that another running process has open. A lock left by a process that has exited is taken over. */
function lockFolder(dir: string, retry = true): void {
  const lock = `${dir}.lock`;
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const owner = Number(readFileSync(lock, "utf8"));
    if (owner === process.pid) return; // a retry in this process
    if (owner > 0 && isRunning(owner)) {
      throw new Error(
        `The local database in ${dir} is in use by another process (pid ${owner}). Stop it first: only one of npm run dev, npm start or a script that uses the database can run at a time.`,
      );
    }
    if (!retry) throw e;
    rmSync(lock, { force: true });
    return lockFolder(dir, false);
  }
  process.once("exit", () => rmSync(lock, { force: true }));
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
