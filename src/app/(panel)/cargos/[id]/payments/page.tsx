import type { Metadata } from "next";
import { CargoPaymentsTab } from "@/features/cargos/cargo-payments-tab";

export const metadata: Metadata = { title: "Cargo payments" };

export default function Page() {
  return <CargoPaymentsTab />;
}
