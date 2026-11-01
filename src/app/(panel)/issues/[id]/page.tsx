import type { Metadata } from "next";
import { IssueView } from "@/features/issues/issue-view";

export const metadata: Metadata = { title: "Problem report" };

export default function Page() {
  return <IssueView />;
}
