import Link from "next/link";
import { notFound } from "next/navigation";
import { LetterView } from "@/components/views/LetterView";
import { getDemoLetter, getDemoSpeech } from "@/lib/demo/cache";

export default async function DemoLetterPage({ params }: PageProps<"/demo/letters/[id]">) {
  const { id } = await params;
  const [letter, speech] = await Promise.all([getDemoLetter(id), getDemoSpeech(id)]);
  if (!letter) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/demo" className="text-sky-800 underline">
        ← Civic Inbox
      </Link>
      <LetterView letter={letter} speech={speech} />
    </div>
  );
}
