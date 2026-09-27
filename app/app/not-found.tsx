import Link from "next/link";

export default function NotFound() {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p>This letter or case doesn&apos;t exist, or it isn&apos;t yours.</p>
      <Link href="/app" className="underline">
        Back to Civic Inbox
      </Link>
    </section>
  );
}
