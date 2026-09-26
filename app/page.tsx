import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-bold">Enveloppe</h1>
      <p className="text-xl">
        Photograph a government letter. Enveloppe checks it against trusted government information and your
        existing cases, tells you what needs to happen next, and tracks it until it&apos;s done.
      </p>
      <Link href="/app" className="self-start rounded-lg bg-sky-800 px-5 py-3 text-lg font-semibold text-white">
        Open my Civic Inbox
      </Link>
    </main>
  );
}
