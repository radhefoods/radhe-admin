import type { ReactNode } from "react";
import { CargoFrame } from "@/features/cargos/cargo-frame";

/** Every section of a cargo shares its header and its tabs. */
export default function CargoLayout({ children }: { children: ReactNode }) {
  return <CargoFrame>{children}</CargoFrame>;
}
