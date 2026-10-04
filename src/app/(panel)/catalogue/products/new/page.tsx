import type { Metadata } from "next";
import { ProductNewView } from "@/features/catalogue/product-new-view";

export const metadata: Metadata = { title: "New product" };

export default function Page() {
  return <ProductNewView />;
}
