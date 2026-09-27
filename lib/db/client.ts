import "server-only";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./types";

/**
 * Database connection (lazy, so `next build` works without a database).
 *   DATABASE_URL=postgres://…     → node-postgres (production; e.g. Postgres on the Vultr VM)
 *   DATABASE_URL=pglite:./.data/db → PGlite: real Postgres compiled to WASM, in-process, no Docker (local dev)
 * Migrations in db/migrations are applied on first connection (idempotent).
 * Every query on private data must be scoped by the user id from requireUser() (see CLAUDE.md).
 */

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "db", "migrations");

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  dbPromise ??= open().catch((e) => {
    dbPromise = null; // allow a retry after a transient failure
    throw e;
  });
  return dbPromise;
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

/** Also used by tests with an in-memory database (dataDir undefined). */
export async function openPglite(dataDir?: string): Promise<Db> {
  // PGlite creates its own directory but not missing parents (e.g. ./.data on a fresh clone).
  if (dataDir) await mkdir(path.dirname(path.resolve(dataDir)), { recursive: true });
  const [{ PGlite }, { drizzle }, { migrate }, schema] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("./schema"),
  ]);
  const db = drizzle(new PGlite(dataDir), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Db;
}
