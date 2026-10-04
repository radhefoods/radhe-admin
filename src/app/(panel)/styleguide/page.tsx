import type { Metadata } from "next";
import { StyleguideView } from "@/features/styleguide/styleguide-view";

export const metadata: Metadata = { title: "Styleguide" };

export default function StyleguidePage() {
  return <StyleguideView />;
}
