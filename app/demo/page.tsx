import { InboxView } from "@/components/views/InboxView";
import { getDemoInbox } from "@/lib/demo/cache";

export default async function DemoInboxPage() {
  const inbox = await getDemoInbox();
  if (!inbox) {
    return (
      <p className="text-lg">
        The demo hasn&apos;t been built yet. Run <code className="rounded bg-slate-100 px-1">npm run demo:build</code> and reload.
      </p>
    );
  }
  return <InboxView inbox={inbox} basePath="/demo" />;
}
