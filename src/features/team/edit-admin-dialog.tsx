"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { SwitchField } from "@/components/form/fields";
import {
  FormError,
  SelectField,
  TextField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { AdminWithRole, UpdateAdminInput } from "@/lib/api/types";
import { useAdmin } from "@/lib/auth/auth-provider";
import { ADMIN_STATUS } from "@/lib/status";
import { zText } from "@/lib/validation";
import { useRoleChoices, useUpdateAdmin } from "./queries";
import { accessLock, changesAccess, firstName, toAdminPatch } from "./team";

// The rules of the API (documentation, 2: PATCH admin-users).
const editSchema = z.object({
  name: zText(120, "Enter the name."),
  roleId: z.string().regex(/^[0-9a-f]{24}$/, "Choose a role."),
  active: z.boolean(),
});

function EditForm({
  admin,
  admins,
  onClose,
}: {
  admin: AdminWithRole;
  admins: readonly AdminWithRole[];
  onClose: () => void;
}) {
  const me = useAdmin();
  const client = useQueryClient();
  const update = useUpdateAdmin();
  const { roles, complete } = useRoleChoices();
  const lock = accessLock(admin, me.id, admins);
  const form = useZodForm(editSchema, {
    defaultValues: {
      name: admin.name,
      roleId: admin.roleId,
      active: admin.status === "active",
    },
  });
  /** A change of role or status waits here until it is confirmed. */
  const [pendingPatch, setPendingPatch] = useState<UpdateAdminInput | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);

  async function save(patch: UpdateAdminInput) {
    try {
      await update.mutateAsync({ id: admin.id, input: patch });
    } catch (error) {
      // The lists the dialog was built from are out of date.
      if (
        hasErrorCode(
          error,
          "ADMIN_NOT_FOUND",
          "ROLE_NOT_FOUND",
          "ADMIN_SELF_MODIFICATION",
        )
      ) {
        void client.invalidateQueries({ queryKey: queryKeys.adminUsers.all });
        void client.invalidateQueries({ queryKey: queryKeys.roles.all });
      }
      throw error;
    }
    notify.success(
      `${admin.name} saved`,
      changesAccess(patch)
        ? `${firstName(admin.name)} was signed out everywhere.`
        : undefined,
    );
    onClose();
  }

  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const patch = toAdminPatch(values, admin);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    if (changesAccess(patch)) {
      setPendingPatch(patch);
      setConfirming(true);
      return;
    }
    await save(patch);
  });

  // The roles to choose from always contain the one the admin has.
  const options = roles.some((role) => role.id === admin.roleId)
    ? roles
    : [
        {
          id: admin.roleId,
          key: admin.role.key,
          name: admin.role.name,
          description: null,
        },
        ...roles,
      ];
  const newRole = options.find((role) => role.id === pendingPatch?.roleId);
  const disabling = pendingPatch?.status === "disabled";
  const first = firstName(admin.name);

  return (
    <>
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
          />
          <SelectField
            form={form}
            name="roleId"
            label="Role"
            required
            disabled={Boolean(lock)}
            hint={
              lock
                ? undefined
                : complete
                  ? `A new role signs ${first} out everywhere.`
                  : `A new role signs ${first} out everywhere. Only roles that an admin already has are listed.`
            }
          >
            {options.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </SelectField>
          <SwitchField
            form={form}
            name="active"
            label="The account is active"
            hint={
              lock
                ? undefined
                : `A disabled admin cannot sign in. Disabling signs ${first} out everywhere.`
            }
            disabled={Boolean(lock)}
          />
          {lock ? (
            <Alert tone="info" title="Role and status are locked">
              {lock}
            </Alert>
          ) : null}
          <FormError state={state} />
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="lg" loading={pending}>
            Save
          </Button>
        </DialogFooter>
      </form>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          disabling
            ? `Disable the account of ${admin.name}?`
            : pendingPatch?.status === "active"
              ? `Enable the account of ${admin.name} again?`
              : `Change the role of ${admin.name}?`
        }
        description={
          disabling
            ? `${first} is signed out everywhere at once and cannot sign in until the account is enabled again.`
            : pendingPatch?.status === "active"
              ? `${first} can sign in again${pendingPatch.roleId ? ", with the new role" : ""}.`
              : `${first} is signed out everywhere at once and works with the new role after signing in again.`
        }
        facts={[
          ...(pendingPatch?.roleId
            ? [
                {
                  label: "Role",
                  value: `${admin.role.name} → ${newRole?.name ?? "another role"}`,
                },
              ]
            : []),
          ...(pendingPatch?.status
            ? [
                {
                  label: "Status",
                  value: `${ADMIN_STATUS[admin.status].label} → ${ADMIN_STATUS[pendingPatch.status].label}`,
                },
              ]
            : []),
          ...(pendingPatch?.name
            ? [{ label: "Name", value: pendingPatch.name }]
            : []),
          { label: "Signed out everywhere", value: admin.name },
        ]}
        tone={disabling ? "danger" : "primary"}
        confirmLabel={
          disabling
            ? "Disable and sign out"
            : pendingPatch?.status === "active"
              ? "Enable the account"
              : "Change the role and sign out"
        }
        onConfirm={async () => {
          if (pendingPatch) await save(pendingPatch);
        }}
      />
    </>
  );
}

/** Name, role and status of an admin (documentation, 2: PATCH). */
export function EditAdminDialog({
  admin,
  admins,
  open,
  onOpenChange,
}: {
  admin: AdminWithRole | null;
  admins: readonly AdminWithRole[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!admin) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={`Edit ${admin.name}`} description={admin.email} />
        <EditForm
          key={`${admin.id}-${admin.updatedAt}`}
          admin={admin}
          admins={admins}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
