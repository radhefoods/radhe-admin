import type { Metadata } from "next";
import { CategoryNewView } from "@/features/wholesale/category-view";

export const metadata: Metadata = { title: "New wholesale category" };

export default function Page() {
  return <CategoryNewView />;
}
