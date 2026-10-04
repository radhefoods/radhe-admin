"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import {
  FormError,
  SelectField,
  TextField,
  fieldMessage,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/surface";
import {
  generateTemporaryPassword,
  temporaryPasswordSchema,
} from "@/features/auth/schemas";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { zText } from "@/lib/validation";
import { useInviteAdmin, useRoleChoices } from "./queries";
import { TemporaryPasswordField, type Handover } from "./temporary-password";

// The rules of the API for a new admin (documentation, 2: POST admin-users).
export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter the email address.")
    .max(254, "At most 254 characters.")
    .pipe(z.email("This is not an email address.")),
  name: zText(120, "Enter the name."),
  roleId: z.string().regex(/^[0-9a-f]{24}$/, "Choose a role."),
  temporaryPassword: temporaryPasswordSchema,
});

function InviteForm({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (handover: Handover) => void;
}) {
  const client = useQueryClient();
  const invite = useInviteAdmin();
  const { roles, complete, loading } = useRoleChoices();
  // Ready to hand over; "Generate" makes another one.
  const [firstPassword] = useState(() => generateTemporaryPassword());
  const form = useZodForm(inviteSchema, {
    defaultValues: {
      email: "",
      name: "",
      roleId: "",
      temporaryPassword: firstPassword,
    },
  });

  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    try {
      const admin = await invite.mutateAsync(values);
      onInvited({
        name: admin.name,
        email: admin.email,
        temporaryPassword: values.temporaryPassword,
        reason: "invited",
      });
    } catch (error) {
      if (hasErrorCode(error, "ADMIN_EMAIL_TAKEN")) {
        form.setError(
          "email",
          { type: "server", message: errorMessage(error) },
          { shouldFocus: true },
        );
        return;
      }
      if (hasErrorCode(error, "ROLE_NOT_FOUND")) {
        // The role was deleted in the meantime: the choices are loaded again.
        void client.invalidateQueries({ queryKey: queryKeys.roles.all });
        void client.invalidateQueries({ queryKey: queryKeys.adminUsers.all });
        form.setError("roleId", {
          type: "server",
          message: "This role does not exist any more. Choose another one.",
        });
        return;
      }
      throw error;
    }
  });

  const chosen = roles.find((role) => role.id === form.watch("roleId"));

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogBody>
        <TextField
          form={form}
          name="name"
          label="Name"
          required
          maxLength={120}
          autoComplete="off"
          autoFocus
        />
        <TextField
          form={form}
          name="email"
          label="Email"
          hint="The admin signs in with it."
          required
          type="email"
          inputMode="email"
          maxLength={254}
          autoComplete="off"
        />
        <SelectField
          form={form}
          name="roleId"
          label="Role"
          required
          disabled={loading}
          hint={
            chosen?.description ??
            (complete
              ? "What the admin may read and change. It can be changed later."
              : "Only roles that an admin already has are listed: your role does not include reading roles.")
          }
        >
          <option value="">
            {loading ? "Loading the roles…" : "Choose a role"}
          </option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </SelectField>
        <Controller
          control={form.control}
          name="temporaryPassword"
          render={({ field }) => (
            <TemporaryPasswordField
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldMessage(form, "temporaryPassword")}
            />
          )}
        />
        <Alert tone="info" title="No email is sent">
          You hand the password over yourself. At the first sign-in the new
          admin sets up the authenticator app (two-factor is required for
          everyone) and must then choose an own password.
        </Alert>
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Invite the admin
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A new admin account with a temporary password (documentation, 2). */
export function InviteDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account exists: the password has to be handed over now. */
  onInvited: (handover: Handover) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Invite an admin"
          description="Creates the account with a temporary password."
        />
        <InviteForm onClose={() => onOpenChange(false)} onInvited={onInvited} />
      </DialogContent>
    </Dialog>
  );
}
