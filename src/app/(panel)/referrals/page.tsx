import type { Metadata } from "next";
import { ReferralsView } from "@/features/referrals/referrals-view";

export const metadata: Metadata = { title: "Referrals" };

export default function Page() {
  return <ReferralsView />;
}
