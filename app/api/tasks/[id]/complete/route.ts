import { apiDeps } from "@/lib/api/deps";
import { completeTask } from "@/lib/api/handlers";

export async function POST(req: Request, ctx: RouteContext<"/api/tasks/[id]/complete">) {
  return completeTask(req, (await ctx.params).id, apiDeps());
}
