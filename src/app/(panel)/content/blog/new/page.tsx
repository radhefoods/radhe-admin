import type { Metadata } from "next";
import { PostNewView } from "@/features/blog/post-new-view";

export const metadata: Metadata = { title: "New post" };

export default function Page() {
  return <PostNewView />;
}
