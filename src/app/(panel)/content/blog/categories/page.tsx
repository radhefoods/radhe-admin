import type { Metadata } from "next";
import { BlogCategoriesView } from "@/features/blog/categories-view";

export const metadata: Metadata = { title: "Blog categories" };

export default function Page() {
  return <BlogCategoriesView />;
}
