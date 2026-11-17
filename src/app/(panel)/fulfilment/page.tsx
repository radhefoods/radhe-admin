import type { Metadata } from "next";
import { FulfilmentView } from "@/features/fulfilment/fulfilment-view";

export const metadata: Metadata = { title: "Fulfilment & Returns" };

export default function Page() {
  return <FulfilmentView />;
}
