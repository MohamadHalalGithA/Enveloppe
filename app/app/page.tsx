import { InboxView } from "@/components/views/InboxView";
import { getMockInbox } from "@/lib/mock/fixtures";

export default function InboxPage() {
  return <InboxView inbox={getMockInbox()} basePath="/app" />;
}
