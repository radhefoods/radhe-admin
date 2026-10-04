import type { Metadata } from "next";
import { LegalView } from "@/features/legal/legal-view";

export const metadata: Metadata = { title: "Legal texts" };

export default function Page() {
  return <LegalView />;
}
