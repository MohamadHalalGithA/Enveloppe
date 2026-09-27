import { notFound } from "next/navigation";
import { z } from "zod";
import { CaseView } from "@/components/views/CaseView";
import type { CaseDetail } from "@/lib/contracts";
import { pageUser } from "@/lib/auth/page-user";
import { getCaseDetail } from "@/lib/cases/service";
import { getDb } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";

export default async function CasePage({ params }: PageProps<"/app/cases/[id]">) {
  const { id } = await params;
  const user = await pageUser(`/app/cases/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  let detail: CaseDetail;
  try {
    detail = await getCaseDetail(await getDb(), user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound(); // missing or not this user's case
    throw e;
  }
  return <CaseView detail={detail} />;
}
