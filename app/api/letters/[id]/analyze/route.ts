import { apiDeps } from "@/lib/api/deps";
import { analyze } from "@/lib/api/handlers";

export async function POST(req: Request, ctx: RouteContext<"/api/letters/[id]/analyze">) {
  return analyze(req, (await ctx.params).id, apiDeps());
}
