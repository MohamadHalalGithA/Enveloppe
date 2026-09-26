import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Lazy so `next build` and pages that don't touch the DB work without DATABASE_URL.
// Every query on private data must be scoped by the user id from requireUser() (see CLAUDE.md).

let db: NodePgDatabase<typeof schema> | null = null;

export function getDb(): NodePgDatabase<typeof schema> {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  db = drizzle(new Pool({ connectionString: url, max: 10 }), { schema });
  return db;
}
