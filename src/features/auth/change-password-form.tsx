"use client";

import { useMutation } from "@tanstack/react-query";
import {
  FormError,
  TextField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { PASSWORD_MIN, changePasswordSchema } from "./schemas";

/**
 * Changes the admin's own password (documentation, 1: change-password).
 * The API signs out every other device and clears a forced change.
 */
export function ChangePasswordForm({
  submitLabel = "Change password",
  onChanged,
}: {
  submitLabel?: string;
  onChanged: () => void | Promise<void>;
}) {
  const form = useZodForm(changePasswordSchema, {
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });
  const change = useMutation({
    mutationFn: api.auth.changePassword,
    meta: { silent: true },
  });
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    await change.mutateAsync({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    form.reset();
    await onChanged();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <TextField
        form={form}
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
      />
      <TextField
        form={form}
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN} characters. A long sentence is better than a short puzzle.`}
      />
      <TextField
        form={form}
        name="confirmPassword"
        label="New password, again"
        type="password"
        autoComplete="new-password"
      />
      <FormError state={state} />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        className="sm:self-start"
      >
        {submitLabel}
      </Button>
    </form>
  );
}
