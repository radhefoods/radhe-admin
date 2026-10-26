import type { Metadata } from "next";
import { ProductView } from "@/features/wholesale/product-view";

export const metadata: Metadata = { title: "Wholesale product" };

export default function Page() {
  return <ProductView />;
}
