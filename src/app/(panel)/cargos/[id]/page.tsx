import type { Metadata } from "next";
import { CargoOverviewTab } from "@/features/cargos/cargo-overview-tab";

export const metadata: Metadata = { title: "Cargo" };

export default function Page() {
  return <CargoOverviewTab />;
}
