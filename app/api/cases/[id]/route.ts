import { apiDeps } from "@/lib/api/deps";
import { caseDetail, removeCase } from "@/lib/api/handlers";

export async function GET(req: Request, ctx: RouteContext<"/api/cases/[id]">) {
  return caseDetail(req, (await ctx.params).id, apiDeps());
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/cases/[id]">) {
  return removeCase(req, (await ctx.params).id, apiDeps());
}
