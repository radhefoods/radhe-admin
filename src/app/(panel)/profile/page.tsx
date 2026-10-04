import type { Metadata } from "next";
import { ProfileView } from "@/features/profile/profile-view";

export const metadata: Metadata = { title: "Profile and security" };

export default function Page() {
  return <ProfileView />;
}
