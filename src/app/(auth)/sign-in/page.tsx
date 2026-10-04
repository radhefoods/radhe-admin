import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/ui/spinner";
import { SignInView } from "@/features/auth/sign-in-view";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SignInView />
    </Suspense>
  );
}
