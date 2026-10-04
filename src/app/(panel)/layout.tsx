import type { ReactNode } from "react";
import { PanelGate } from "@/components/shell/app-shell";

/** Every page in here needs a signed-in admin. */
export default function PanelLayout({ children }: { children: ReactNode }) {
  return <PanelGate>{children}</PanelGate>;
}
