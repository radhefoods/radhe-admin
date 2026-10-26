import type { Metadata } from "next";
import { ProductNewView } from "@/features/wholesale/product-new-view";

export const metadata: Metadata = { title: "New wholesale product" };

export default function Page() {
  return <ProductNewView />;
}
