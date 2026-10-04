import type { Metadata } from "next";
import { CustomerView } from "@/features/customers/customer-view";

export const metadata: Metadata = { title: "Customer" };

export default function Page() {
  return <CustomerView />;
}
