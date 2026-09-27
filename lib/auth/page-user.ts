import "server-only";
import { redirect } from "next/navigation";
import { AuthError } from "@/lib/errors";
import type { AppUser } from "./resolve";
import { requireUser } from "./requireUser";

/** For server-rendered /app pages: the signed-in user, or a redirect to sign-in (e.g. an expired session). */
export async function pageUser(returnTo: string): Promise<AppUser> {
  try {
    return await requireUser();
  } catch (e) {
    if (e instanceof AuthError) redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    throw e;
  }
}
