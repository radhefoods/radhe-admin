import type { Metadata } from "next";
import { ReturnView } from "@/features/returns/return-view";

export const metadata: Metadata = { title: "Return" };

export default function Page() {
  return <ReturnView />;
}
