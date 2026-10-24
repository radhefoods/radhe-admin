import type { Metadata } from "next";
import { PostsView } from "@/features/blog/posts-view";

export const metadata: Metadata = { title: "Blog" };

export default function Page() {
  return <PostsView />;
}
