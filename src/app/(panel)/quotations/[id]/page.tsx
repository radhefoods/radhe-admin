import type { Metadata } from "next";
import { QuotationView } from "@/features/quotations/quotation-view";

export const metadata: Metadata = { title: "Quotation" };

export default function Page() {
  return <QuotationView />;
}
