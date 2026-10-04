import type { Metadata } from "next";
import { ChangePasswordView } from "@/features/auth/change-password-view";

export const metadata: Metadata = { title: "Set your password" };

export default function ChangePasswordPage() {
  return <ChangePasswordView />;
}
