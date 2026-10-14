import type { Metadata } from "next";
import { ImportExportView } from "@/features/catalogue/import-export-view";

export const metadata: Metadata = { title: "Import and export" };

export default function Page() {
  return <ImportExportView />;
}
