"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { useAuth } from "@/lib/auth/auth-provider";
import { routes } from "@/lib/routes";
import { ChangePasswordForm } from "./change-password-form";

/**
 * The forced password change (documentation, 1.9): a new admin, or one
 * whose password was reset, can do nothing else until it is done.
 */
export function ChangePasswordView() {
  const { state, reload, signOut } = useAuth();
  const router = useRouter();

  // This screen has no sign-in of its own to open over it: a session that
  // ended here goes back to the sign-in, as one that never was does.
  const signedOut = state.status === "signedOut" || state.status === "expired";
  useEffect(() => {
    if (signedOut) router.replace(routes.signIn);
  }, [signedOut, router]);

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

  if (state.status !== "authenticated") {
    return <LoadingBlock label="Checking your session" />;
  }
  const forced = state.admin.mustChangePassword;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="text-gradient font-display text-[1.75rem] leading-tight text-ink">
          {forced ? "Set your own password" : "Change your password"}
        </h1>
        <p className="text-ink-muted">
          {forced
            ? "Your password was set by another admin. Choose one only you know before anything else. Other devices are signed out."
            : "Other devices are signed out when the password changes."}
        </p>
      </div>
      <ChangePasswordForm
        submitLabel={forced ? "Set password and continue" : "Change password"}
        onChanged={async () => {
          await reload();
          notify.success("Password changed");
          router.replace(routes.today);
        }}
      />
      <Button
        variant="link"
        className="self-start"
        onClick={() =>
          void signOut().catch((error: unknown) =>
            notify.error(error, "You are still signed in"),
          )
        }
      >
        Sign out instead
      </Button>
    </div>
  );
}
