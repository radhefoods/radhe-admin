import type { Metadata } from "next";
import { CategoryProductsView } from "@/features/catalogue/category-products-view";

export const metadata: Metadata = { title: "Product order" };

export default function Page() {
  return <CategoryProductsView />;
}
