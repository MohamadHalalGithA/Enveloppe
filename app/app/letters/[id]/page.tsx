import { notFound } from "next/navigation";
import { LetterView } from "@/components/views/LetterView";
import { getMockLetter } from "@/lib/mock/fixtures";

export default async function LetterPage({ params }: PageProps<"/app/letters/[id]">) {
  const { id } = await params;
  const letter = getMockLetter(id);
  if (!letter) notFound();
  return <LetterView letter={letter} />;
}
