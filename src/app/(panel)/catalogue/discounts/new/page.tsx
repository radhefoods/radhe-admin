import type { Metadata } from "next";
import { DiscountNewView } from "@/features/discounts/discount-view";

export const metadata: Metadata = { title: "New discount code" };

export default function Page() {
  return <DiscountNewView />;
}
