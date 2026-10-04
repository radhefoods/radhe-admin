import type { Metadata } from "next";
import { RefundView } from "@/features/payments/refunds";

export const metadata: Metadata = { title: "Refund" };

export default function Page() {
  return <RefundView />;
}
