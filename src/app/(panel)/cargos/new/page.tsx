import type { Metadata } from "next";
import { CargoNewView } from "@/features/cargos/cargo-new-view";

export const metadata: Metadata = { title: "New cargo" };

export default function Page() {
  return <CargoNewView />;
}
