import type { Metadata } from "next";
import { RefundsView } from "@/features/payments/refunds";

export const metadata: Metadata = { title: "Refunds" };

export default function Page() {
  return <RefundsView />;
}
