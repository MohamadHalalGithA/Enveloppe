import { upsertUserBySub } from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { AuthError } from "@/lib/errors";

export interface AppUser {
  /** Internal user id. Every private query is scoped by this, never by anything the client sends. */
  id: string;
}

/** Validated Auth0 `sub` (from the SDK session, never from the request) → internal user. Fails closed. */
export async function resolveUser(db: Db, sub: unknown): Promise<AppUser> {
  if (typeof sub !== "string" || !sub.trim() || sub.length > 255) throw new AuthError();
  return upsertUserBySub(db, sub);
}
