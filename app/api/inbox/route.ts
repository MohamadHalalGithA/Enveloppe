import { apiDeps } from "@/lib/api/deps";
import { inbox } from "@/lib/api/handlers";

export function GET(req: Request) {
  return inbox(req, apiDeps());
}
