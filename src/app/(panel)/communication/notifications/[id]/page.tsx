import type { Metadata } from "next";
import { NotificationView } from "@/features/notifications/notification-view";

export const metadata: Metadata = { title: "Message" };

export default function Page() {
  return <NotificationView />;
}
