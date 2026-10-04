"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  FormError,
  TextField,
  TextareaField,
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
import { Alert, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { AdminWithRole, Role, UpdateRoleInput } from "@/lib/api/types";
import { useAdmin, useAuth, useCan } from "@/lib/auth/auth-provider";
import { describePermission } from "@/lib/auth/permissions";
import { plural } from "@/lib/format/names";
import { zText } from "@/lib/validation";
import {
  EMPTY_MATRIX,
  ROLE_KEY,
  fromMatrix,
  keyFromName,
  permissionChange,
  samePermissions,
  toMatrix,
  type Catalogue,
  type MatrixState,
} from "./matrix";
import { PermissionMatrix } from "./permission-matrix";
import { useCreateRole, useUpdateRole } from "./queries";

// The rules of the API for a role (documentation, 3).
const roleSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      ROLE_KEY,
      "3 to 41 characters: lower-case letters, digits and _, starting with a letter.",
    ),
  name: zText(80, "Give the role a name."),
  description: z.string().trim().max(300, "At most 300 characters."),
});

function names(admins: readonly AdminWithRole[]): string {
  return admins.map((admin) => admin.name).join(", ");
}

function RoleForm({
  role,
  catalogue,
  members,
  onClose,
  onDirtyChange,
}: {
  /** The role to change; `null` creates one. */
  role: Role | null;
  catalogue: Catalogue;
  /** The admins who have the role; `null` when the team cannot be read. */
  members: AdminWithRole[] | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const me = useAdmin();
  const { reload } = useAuth();
  const client = useQueryClient();
  const can = useCan();
  const canManage = can("roles.manage");
  const canReadTeam = can("admin_users.read");
  const create = useCreateRole();
  const update = useUpdateRole();
  const readOnly = !canManage || (role?.isSystem ?? false);
  const own = role !== null && role.id === me.roleId;

  const form = useZodForm(roleSchema, {
    defaultValues: {
      key: role?.key ?? "",
      name: role?.name ?? "",
      description: role?.description ?? "",
    },
  });
  const [matrix, setMatrix] = useState<MatrixState>(() =>
    role ? toMatrix(role.permissions, catalogue) : EMPTY_MATRIX,
  );
  const permissions = fromMatrix(matrix, catalogue);
  const permissionsChanged = role
    ? !samePermissions(permissions, role.permissions)
    : permissions.length > 0;
  const dirty = form.formState.isDirty || permissionsChanged;

  const [pendingPatch, setPendingPatch] = useState<UpdateRoleInput | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // A new role gets its key from its name, until a key is typed.
  const keyTyped = useRef(false);
  useEffect(() => {
    if (role) return;
    const subscription = form.watch((values, change) => {
      // A change with a type comes from the keyboard, not from the line below.
      if (change.name === "key" && change.type) keyTyped.current = true;
      if (change.name !== "name" || keyTyped.current) return;
      form.setValue("key", keyFromName(values.name ?? ""), {
        shouldValidate: form.formState.isSubmitted,
      });
    });
    return () => subscription.unsubscribe();
  }, [form, role]);

  async function patchRole(target: Role, patch: UpdateRoleInput) {
    try {
      await update.mutateAsync({ id: target.id, input: patch });
    } catch (error) {
      if (hasErrorCode(error, "ROLE_NOT_FOUND", "ROLE_IS_SYSTEM")) {
        void client.invalidateQueries({ queryKey: queryKeys.roles.all });
      }
      if (hasErrorCode(error, "ROLE_PERMISSION_UNKNOWN")) {
        void client.invalidateQueries({
          queryKey: queryKeys.roles.permissions(),
        });
      }
      throw error;
    }
    // The permissions that changed may be the admin's own.
    if (own && patch.permissions) void reload();
    notify.success(`Role "${patch.name ?? target.name}" saved`);
    onClose();
  }

  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    if (!role) {
      try {
        const created = await create.mutateAsync({
          key: values.key,
          name: values.name,
          description: values.description || undefined,
          permissions,
        });
        notify.success(
          `Role "${created.name}" created`,
          "Give it to an admin on the Team page.",
        );
        onClose();
      } catch (error) {
        if (hasErrorCode(error, "ROLE_KEY_TAKEN")) {
          form.setError(
            "key",
            { type: "server", message: errorMessage(error) },
            { shouldFocus: true },
          );
          return;
        }
        if (hasErrorCode(error, "ROLE_PERMISSION_UNKNOWN")) {
          void client.invalidateQueries({
            queryKey: queryKeys.roles.permissions(),
          });
        }
        throw error;
      }
      return;
    }

    if (role.description && values.description === "") {
      form.setError(
        "description",
        {
          type: "server",
          message:
            "A description cannot be removed once it is saved: the API keeps it. Write a new one instead.",
        },
        { shouldFocus: true },
      );
      return;
    }
    const patch: UpdateRoleInput = {};
    if (values.name !== role.name) patch.name = values.name;
    if (values.description !== (role.description ?? ""))
      patch.description = values.description;
    if (permissionsChanged) patch.permissions = permissions;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    // What admins may do changes at once: that is confirmed first.
    const affectsAdmins = members === null || members.length > 0 || own;
    if (patch.permissions && affectsAdmins) {
      setPendingPatch(patch);
      setConfirming(true);
      return;
    }
    await patchRole(role, patch);
  });

  const difference = role
    ? permissionChange(role.permissions, permissions)
    : null;
  const affected = members === null ? null : members.length;

  return (
    <>
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex min-h-0 flex-1 flex-col"
      >
        <DialogBody>
          {role?.isSystem ? (
            <Alert tone="info" title="The system role cannot be changed">
              Super Admin always exists and grants everything, including roles.
              It can be neither edited nor deleted.
            </Alert>
          ) : own && !readOnly ? (
            <Alert tone="warning" title="This is your own role">
              What you untick here you lose at once, including the right to
              manage roles.
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="name"
              label="Name"
              required={!readOnly}
              maxLength={80}
              autoComplete="off"
              autoFocus={!role}
              disabled={readOnly}
            />
            {role ? (
              <dl className="flex min-w-0 flex-col gap-1.5">
                <dt className="text-13 font-medium text-ink">Key</dt>
                <dd className="flex h-[34px] items-center font-mono text-sm text-ink-muted">
                  {role.key}
                </dd>
                <dd className="text-13 text-ink-subtle">
                  The key of a role cannot change.
                </dd>
              </dl>
            ) : (
              <TextField
                form={form}
                name="key"
                label="Key"
                hint="Lower-case letters, digits and _. It cannot change later."
                required
                maxLength={41}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </div>
          <TextareaField
            form={form}
            name="description"
            label="Description"
            hint={readOnly ? undefined : "Who gets this role, in a sentence."}
            optional={!readOnly}
            rows={2}
            maxLength={300}
            disabled={readOnly}
          />

          <div className="flex flex-col gap-2">
            <div>
              <h3 className="text-13 font-medium text-ink">Permissions</h3>
              <p className="text-13 text-ink-muted">
                Read opens the pages of an area; manage allows changes there.
                The two are separate: give both to someone who works in an area.
              </p>
            </div>
            <PermissionMatrix
              state={matrix}
              catalogue={catalogue}
              onChange={setMatrix}
              readOnly={readOnly}
            />
          </div>
          <FormError state={state} />
        </DialogBody>
        <DialogFooter>
          {readOnly ? (
            <Button size="lg" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="lg"
                onClick={onClose}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={pending}
                disabled={role !== null && !dirty}
              >
                {role ? "Save the role" : "Create the role"}
              </Button>
            </>
          )}
        </DialogFooter>
      </form>

      {role ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={
            affected === null
              ? `Change what "${role.name}" allows?`
              : `Change what ${plural(affected, "admin")} may do?`
          }
          description={
            <>
              The new permissions apply at once to every admin with this role;
              they may have to sign in again.
              {affected === null && !canReadTeam
                ? " Your role does not show the team, so the panel cannot say who they are."
                : ""}
              {own ? " This is your own role." : ""}
            </>
          }
          facts={[
            ...(members && members.length > 0
              ? [{ label: "Admins with this role", value: names(members) }]
              : []),
            ...(difference && difference.added.length > 0
              ? [
                  {
                    label: "Added",
                    value: difference.added.map(describePermission).join(", "),
                  },
                ]
              : []),
            ...(difference && difference.removed.length > 0
              ? [
                  {
                    label: "Removed",
                    value: difference.removed
                      .map(describePermission)
                      .join(", "),
                  },
                ]
              : []),
          ]}
          tone={
            difference && difference.removed.length > 0 ? "danger" : "primary"
          }
          confirmLabel="Save the role"
          onConfirm={async () => {
            if (pendingPatch) await patchRole(role, pendingPatch);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The editor of a role: its name and its permissions as a matrix. A new
 * role also gets its key; the system role and a reader see it locked.
 */
export function RoleDialog({
  role,
  catalogue,
  ready = true,
  members,
  open,
  onOpenChange,
}: {
  role: Role | null;
  catalogue: Catalogue;
  /** `false` while the list of permissions is on its way: the matrix waits for it. */
  ready?: boolean;
  members: AdminWithRole[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const canManage = useCan()("roles.manage");
  const [dirty, setDirty] = useState(false);
  const readOnly = !canManage || (role?.isSystem ?? false);

  function change(next: boolean) {
    if (!next) setDirty(false);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        size="lg"
        // A click next to the dialog must not throw away a half-built role.
        onInteractOutside={(event) => {
          if (dirty) event.preventDefault();
        }}
      >
        <DialogHeader
          title={
            role ? (readOnly ? role.name : `Edit "${role.name}"`) : "New role"
          }
          description={
            role
              ? readOnly
                ? "What this role allows."
                : "Changes apply to every admin with this role as soon as they are saved."
              : "A set of permissions you can give to admins on the Team page."
          }
        />
        {ready ? (
          <RoleForm
            key={role ? `${role.id}-${role.updatedAt}` : "new"}
            role={role}
            catalogue={catalogue}
            members={members}
            onClose={() => change(false)}
            onDirtyChange={setDirty}
          />
        ) : (
          <DialogBody aria-busy="true" className="pb-6">
            <span className="sr-only" role="status">
              Loading the permissions
            </span>
            <Skeleton className="h-9" />
            <Skeleton className="h-64 rounded-lg" />
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}
