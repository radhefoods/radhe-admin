import type { Metadata } from "next";
import { ProductsView } from "@/features/catalogue/products-view";

export const metadata: Metadata = { title: "Products" };

export default function Page() {
  return <ProductsView />;
}
