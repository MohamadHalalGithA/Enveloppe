import { apiDeps } from "@/lib/api/deps";
import { uploadLetter } from "@/lib/api/handlers";

export function POST(req: Request) {
  return uploadLetter(req, apiDeps());
}
