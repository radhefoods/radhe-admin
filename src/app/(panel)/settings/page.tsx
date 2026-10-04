import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

/** The shop settings open on their first section. */
export default function Page() {
  redirect(routes.settingsCompany);
}
