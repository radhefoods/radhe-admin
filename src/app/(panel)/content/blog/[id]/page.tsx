import type { Metadata } from "next";
import { PostView } from "@/features/blog/post-view";

export const metadata: Metadata = { title: "Post" };

export default function Page() {
  return <PostView />;
}
