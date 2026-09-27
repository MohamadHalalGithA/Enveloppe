import { apiDeps } from "@/lib/api/deps";
import { getLetter, removeLetter } from "@/lib/api/handlers";

export async function GET(req: Request, ctx: RouteContext<"/api/letters/[id]">) {
  return getLetter(req, (await ctx.params).id, apiDeps());
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/letters/[id]">) {
  return removeLetter(req, (await ctx.params).id, apiDeps());
}
