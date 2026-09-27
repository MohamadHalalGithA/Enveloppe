import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Driver-independent database handle (node-postgres in production, PGlite in dev/tests). Transactions are assignable. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
