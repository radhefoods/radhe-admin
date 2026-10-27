import type { Metadata } from "next";
import { DiscountsView } from "@/features/discounts/discounts-view";

export const metadata: Metadata = { title: "Discount codes" };

export default function Page() {
  return <DiscountsView />;
}
