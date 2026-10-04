import type { Metadata } from "next";
import { InvoiceView } from "@/features/payments/invoices";

export const metadata: Metadata = { title: "Invoice" };

export default function Page() {
  return <InvoiceView />;
}
