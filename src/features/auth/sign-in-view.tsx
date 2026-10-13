"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import { useAuth } from "@/lib/auth/auth-provider";
import { routes, safeReturnTo } from "@/lib/routes";
import { SignInFlow } from "./sign-in-flow";

export function SignInView() {
  const { state, completeSignIn, reload } = useAuth();
  const router = useRouter();
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"));

  useEffect(() => {
    if (state.status !== "authenticated") return;
    router.replace(
      state.admin.mustChangePassword ? routes.changePassword : returnTo,
    );
  }, [state, router, returnTo]);

  if (state.status === "unreachable") {
    return (
      <Alert
        tone="danger"
        title="The API could not be reached"
        actions={<Button onClick={() => void reload()}>Try again</Button>}
      >
        {errorMessage(state.error)}
      </Alert>
    );
  }

  if (state.status !== "signedOut") {
    return <LoadingBlock label="Checking your session" />;
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">
          Sign in
        </h1>
        <p className="text-ink-muted">
          With your email, your password and the code of your authenticator app.
        </p>
      </div>
      <SignInFlow onAuthenticated={completeSignIn} />
    </div>
  );
}
