import type { Metadata } from "next";
import { CargoProductsTab } from "@/features/cargos/cargo-products-tab";

export const metadata: Metadata = { title: "Cargo products" };

export default function Page() {
  return <CargoProductsTab />;
}
