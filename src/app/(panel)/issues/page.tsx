import type { Metadata } from "next";
import { IssuesView } from "@/features/issues/issues-view";

export const metadata: Metadata = { title: "Problem reports" };

export default function Page() {
  return <IssuesView />;
}
