import type { Metadata } from "next";
import { LegalDocumentView } from "@/features/legal/legal-document-view";

export const metadata: Metadata = { title: "Legal text" };

export default function Page() {
  return <LegalDocumentView />;
}
