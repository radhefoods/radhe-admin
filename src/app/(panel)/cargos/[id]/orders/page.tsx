import type { Metadata } from "next";
import { CargoOrdersTab } from "@/features/cargos/cargo-orders-tab";

export const metadata: Metadata = { title: "Cargo orders" };

export default function Page() {
  return <CargoOrdersTab />;
}
