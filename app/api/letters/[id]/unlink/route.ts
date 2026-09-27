import { apiDeps } from "@/lib/api/deps";
import { unlink } from "@/lib/api/handlers";

export async function POST(req: Request, ctx: RouteContext<"/api/letters/[id]/unlink">) {
  return unlink(req, (await ctx.params).id, apiDeps());
}
