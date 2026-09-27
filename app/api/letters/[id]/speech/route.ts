import { apiDeps } from "@/lib/api/deps";
import { speak, speechAudio } from "@/lib/api/handlers";

export async function POST(req: Request, ctx: RouteContext<"/api/letters/[id]/speech">) {
  return speak(req, (await ctx.params).id, apiDeps());
}

export async function GET(req: Request, ctx: RouteContext<"/api/letters/[id]/speech">) {
  return speechAudio(req, (await ctx.params).id, apiDeps());
}
