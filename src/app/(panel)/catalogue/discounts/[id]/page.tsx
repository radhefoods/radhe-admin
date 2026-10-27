import type { Metadata } from "next";
import { DiscountView } from "@/features/discounts/discount-view";

export const metadata: Metadata = { title: "Discount code" };

export default function Page() {
  return <DiscountView />;
}
