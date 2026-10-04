import type { Metadata } from "next";
import { ReturnsView } from "@/features/returns/returns-view";

export const metadata: Metadata = { title: "Returns" };

export default function Page() {
  return <ReturnsView />;
}
