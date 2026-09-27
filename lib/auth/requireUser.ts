import "server-only";
import { getDb } from "@/lib/db/client";
import { auth0 } from "./auth0";
import { resolveUser, type AppUser } from "./resolve";

/**
 * The ONLY way private route handlers and server components get the current user.
 * Identity comes from the Auth0 SDK's validated session cookie; a missing session throws AuthError (401).
 */
export async function requireUser(): Promise<AppUser> {
  const session = await auth0.getSession();
  return resolveUser(await getDb(), session?.user?.sub);
}
