import { apiDeps } from "@/lib/api/deps";
import { confirmFields } from "@/lib/api/handlers";

export async function POST(req: Request, ctx: RouteContext<"/api/letters/[id]/confirm">) {
  return confirmFields(req, (await ctx.params).id, apiDeps());
}
