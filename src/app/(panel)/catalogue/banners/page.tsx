import type { Metadata } from "next";
import { BannersView } from "@/features/banners/banners-view";

export const metadata: Metadata = { title: "Banners" };

export default function Page() {
  return <BannersView />;
}
