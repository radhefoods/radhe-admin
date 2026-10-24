import type { Metadata } from "next";
import { FaqView } from "@/features/faq/faq-view";

export const metadata: Metadata = { title: "FAQ" };

export default function Page() {
  return <FaqView />;
}
