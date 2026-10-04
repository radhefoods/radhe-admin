import type { ReactNode } from "react";
import { SettingsFrame } from "@/features/settings/settings-frame";

/** The sections of the shop settings share one header and their tabs. */
export default function ShopSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
