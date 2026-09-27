import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AnalyzeStatus } from "@/components/actions/AnalyzeStatus";
import { LetterView } from "@/components/views/LetterView";
import type { LetterStatus } from "@/lib/contracts";
import { failureMessage } from "@/lib/api/handlers";
import { pageUser } from "@/lib/auth/page-user";
import { getDb } from "@/lib/db/client";
import { getLetterRow } from "@/lib/db/repo";
import { isAnalyzed, letterResultFor } from "@/lib/pipeline/analyze";

export default async function LetterPage({ params }: PageProps<"/app/letters/[id]">) {
  const { id } = await params;
  const user = await pageUser(`/app/letters/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  const row = await getLetterRow(db, user.id, id); // scoped: someone else's letter is simply not found
  if (!row) notFound();

  const back = (
    <Link href="/app" className="text-sky-800 underline">
      ← Civic Inbox
    </Link>
  );
  if (!isAnalyzed(row.status)) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <AnalyzeStatus letterId={id} status={row.status as LetterStatus} error={row.errorCode ? failureMessage(row.errorCode) : null} />
      </div>
    );
  }
  const letter = await letterResultFor(db, user.id, id, new Date());
  return (
    <div className="flex flex-col gap-4">
      {back}
      <LetterView letter={letter} mode="app" />
    </div>
  );
}
