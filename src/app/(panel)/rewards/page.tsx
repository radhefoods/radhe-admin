import type { Metadata } from "next";
import { RewardsView } from "@/features/rewards/rewards-view";

export const metadata: Metadata = { title: "Points & Rewards" };

export default function Page() {
  return <RewardsView />;
}
