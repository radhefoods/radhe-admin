import type { Metadata } from "next";
import { OrderCostsSection } from "@/features/settings/order-costs-section";

export const metadata: Metadata = { title: "Order costs" };

export default function Page() {
  return <OrderCostsSection />;
}
