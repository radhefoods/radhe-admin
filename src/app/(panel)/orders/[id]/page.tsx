import type { Metadata } from "next";
import { OrderView } from "@/features/orders/order-view";

export const metadata: Metadata = { title: "Order" };

export default function Page() {
  return <OrderView />;
}
