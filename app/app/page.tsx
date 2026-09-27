import { UploadPanel } from "@/components/upload/UploadPanel";
import { InboxView } from "@/components/views/InboxView";
import { pageUser } from "@/lib/auth/page-user";
import { getInbox } from "@/lib/cases/service";
import { getDb } from "@/lib/db/client";

export default async function InboxPage() {
  const user = await pageUser("/app");
  const inbox = await getInbox(await getDb(), user.id);
  return (
    <div className="flex flex-col gap-8">
      <UploadPanel />
      <InboxView inbox={inbox} basePath="/app" />
    </div>
  );
}
