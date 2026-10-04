"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notify } from "@/components/ui/toast";
import { generateTemporaryPassword } from "@/features/auth/schemas";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { AdminWithRole } from "@/lib/api/types";
import { useAdmin } from "@/lib/auth/auth-provider";
import { useResetAdminMfa, useResetAdminPassword } from "./queries";
import { firstName } from "./team";
import {
  TemporaryPasswordField,
  temporaryPasswordProblem,
  type Handover,
} from "./temporary-password";

function PasswordReset({
  admin,
  open,
  onOpenChange,
  onReset,
}: {
  admin: AdminWithRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: (handover: Handover) => void;
}) {
  const client = useQueryClient();
  const reset = useResetAdminPassword();
  const [password, setPassword] = useState(() => generateTemporaryPassword());
  const [touched, setTouched] = useState(false);
  const problem = temporaryPasswordProblem(password);
  const first = firstName(admin.name);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // The next time the dialog opens, it proposes another password.
          setPassword(generateTemporaryPassword());
          setTouched(false);
        }
        onOpenChange(next);
      }}
      title={`Reset the password of ${admin.name}?`}
      description={`${first} gets a temporary password and must choose an own one at the next sign-in. The account is unlocked, and ${first} is signed out everywhere. No email is sent: you hand the password over.`}
      facts={[
        { label: "Admin", value: admin.email },
        { label: "Signed out everywhere", value: "At once" },
      ]}
      confirmLabel="Reset the password"
      tone="danger"
      canConfirm={problem === null}
      onConfirm={async () => {
        try {
          await reset.mutateAsync({
            id: admin.id,
            temporaryPassword: password,
          });
        } catch (error) {
          if (hasErrorCode(error, "ADMIN_NOT_FOUND")) {
            void client.invalidateQueries({
              queryKey: queryKeys.adminUsers.all,
            });
          }
          throw error;
        }
        onReset({
          name: admin.name,
          email: admin.email,
          temporaryPassword: password,
          reason: "reset",
        });
      }}
    >
      <TemporaryPasswordField
        value={password}
        onChange={(value) => {
          setPassword(value);
          setTouched(true);
        }}
        error={touched ? problem : null}
        hint="12 to 128 characters. It is shown once more after the reset, to hand it over."
      />
    </ConfirmDialog>
  );
}

/**
 * A new temporary password for an admin: forces a change, unlocks the
 * account and signs the admin out everywhere (documentation, 2).
 */
export function ResetPasswordDialog({
  admin,
  open,
  onOpenChange,
  onReset,
}: {
  admin: AdminWithRole | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: (handover: Handover) => void;
}) {
  if (!admin) return null;
  // A fresh password for every admin the dialog is opened for.
  return (
    <PasswordReset
      key={admin.id}
      admin={admin}
      open={open}
      onOpenChange={onOpenChange}
      onReset={onReset}
    />
  );
}

/**
 * Removes the authenticator of an admin who lost it: they enrol again at
 * the next sign-in, and are signed out everywhere (documentation, 2).
 */
export function ResetMfaDialog({
  admin,
  open,
  onOpenChange,
}: {
  admin: AdminWithRole | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useAdmin();
  const client = useQueryClient();
  const reset = useResetAdminMfa();
  if (!admin) return null;
  const self = admin.id === me.id;
  const first = firstName(admin.name);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        self
          ? "Reset your own two-factor?"
          : `Reset the two-factor of ${admin.name}?`
      }
      description={
        self
          ? "Your authenticator is removed and you are signed out everywhere, here too. At your next sign-in you set up the authenticator again: have your phone at hand."
          : `The authenticator of ${first} is removed, for example because the phone was lost. ${first} is signed out everywhere and sets up a new authenticator at the next sign-in. The password stays as it is.`
      }
      facts={[
        { label: "Admin", value: admin.email },
        { label: "Signed out everywhere", value: "At once" },
      ]}
      confirmLabel="Reset two-factor"
      tone="danger"
      onConfirm={async () => {
        try {
          await reset.mutateAsync(admin.id);
        } catch (error) {
          if (hasErrorCode(error, "ADMIN_NOT_FOUND")) {
            void client.invalidateQueries({
              queryKey: queryKeys.adminUsers.all,
            });
          }
          throw error;
        }
        if (!self) {
          notify.success(
            `Two-factor of ${admin.name} reset`,
            `${first} sets up the authenticator again at the next sign-in.`,
          );
        }
      }}
    />
  );
}
