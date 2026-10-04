import type { Metadata } from "next";
import { ProductView } from "@/features/catalogue/product-view";

export const metadata: Metadata = { title: "Product" };

export default function Page() {
  return <ProductView />;
}
