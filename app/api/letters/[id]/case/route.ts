import { apiDeps } from "@/lib/api/deps";
import { decide } from "@/lib/api/handlers";

export async function POST(req: Request, ctx: RouteContext<"/api/letters/[id]/case">) {
  return decide(req, (await ctx.params).id, apiDeps());
}
