import type { Metadata } from "next";
import { CargosView } from "@/features/cargos/cargos-view";

export const metadata: Metadata = { title: "Cargos" };

export default function Page() {
  return <CargosView />;
}
