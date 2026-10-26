import type { Metadata } from "next";
import { CategoriesView } from "@/features/wholesale/categories-view";

export const metadata: Metadata = { title: "Wholesale categories" };

export default function Page() {
  return <CategoriesView />;
}
