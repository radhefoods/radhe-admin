import type { Metadata } from "next";
import { InvoicesView } from "@/features/payments/invoices";

export const metadata: Metadata = { title: "Invoices" };

export default function Page() {
  return <InvoicesView />;
}
