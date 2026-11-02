import type { Metadata } from "next";
import { RewardAccountView } from "@/features/rewards/reward-account-view";

export const metadata: Metadata = { title: "Coins of a customer" };

export default function Page() {
  return <RewardAccountView />;
}
