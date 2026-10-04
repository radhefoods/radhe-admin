import type { Metadata } from "next";
import { PaymentsSection } from "@/features/settings/payments-section";

export const metadata: Metadata = { title: "Payment settings" };

export default function Page() {
  return <PaymentsSection />;
}
