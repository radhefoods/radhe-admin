import type { Metadata } from "next";
import { AnnouncementComposeView } from "@/features/announcements/announcement-compose-view";

export const metadata: Metadata = { title: "New announcement" };

export default function Page() {
  return <AnnouncementComposeView />;
}
