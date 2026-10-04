import type { Metadata } from "next";
import { CompanySection } from "@/features/settings/company-section";

export const metadata: Metadata = { title: "Company settings" };

export default function Page() {
  return <CompanySection />;
}
