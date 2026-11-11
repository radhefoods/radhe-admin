import type { Metadata } from "next";
import { PricingSection } from "@/features/settings/pricing-section";

export const metadata: Metadata = { title: "Pricing & supplier" };

export default function Page() {
  return <PricingSection />;
}
