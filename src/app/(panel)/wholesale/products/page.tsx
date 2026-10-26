import type { Metadata } from "next";
import { ProductsView } from "@/features/wholesale/products-view";

export const metadata: Metadata = { title: "Wholesale products" };

export default function Page() {
  return <ProductsView />;
}
