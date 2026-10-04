import type { Metadata } from "next";
import { DeliveryFeeSection } from "@/features/settings/delivery-fee-section";

export const metadata: Metadata = { title: "Delivery fee" };

export default function Page() {
  return <DeliveryFeeSection />;
}
