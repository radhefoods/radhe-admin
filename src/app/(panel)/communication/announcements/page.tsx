import type { Metadata } from "next";
import { AnnouncementsView } from "@/features/announcements/announcements-view";

export const metadata: Metadata = { title: "Announcements" };

export default function Page() {
  return <AnnouncementsView />;
}
