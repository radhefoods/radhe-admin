import type { Metadata } from "next";
import { AnnouncementView } from "@/features/announcements/announcement-view";

export const metadata: Metadata = { title: "Announcement" };

export default function Page() {
  return <AnnouncementView />;
}
