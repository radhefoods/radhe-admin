import type { Metadata } from "next";
import { OrdersSection } from "@/features/settings/orders-section";

export const metadata: Metadata = { title: "Orders and returns settings" };

export default function Page() {
  return <OrdersSection />;
}
