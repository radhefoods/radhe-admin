import type { Metadata } from "next";
import { CategoryView } from "@/features/wholesale/category-view";

export const metadata: Metadata = { title: "Wholesale category" };

export default function Page() {
  return <CategoryView />;
}
