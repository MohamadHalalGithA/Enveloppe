import { apiDeps } from "@/lib/api/deps";
import { getImage } from "@/lib/api/handlers";

export async function GET(req: Request, ctx: RouteContext<"/api/letters/[id]/image">) {
  return getImage(req, (await ctx.params).id, apiDeps());
}
