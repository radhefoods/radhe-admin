"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Eye, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/menu";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { AdminWithRole, Role } from "@/lib/api/types";
import { useAdmin, useCan } from "@/lib/auth/auth-provider";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import {
  buildCatalogue,
  defaultCatalogue,
  summarizeAccess,
  type Catalogue,
} from "./matrix";
import {
  useDeleteRole,
  usePermissionCatalogue,
  useRoleMembers,
  useRoles,
} from "./queries";
import { RoleDialog } from "./role-dialog";

function Access({ role, catalogue }: { role: Role; catalogue: Catalogue }) {
  const summary = summarizeAccess(role.permissions, catalogue);
  if (summary.everything) {
    return (
      <TwoLine primary="Everything" secondary="Also what is added later" />
    );
  }
  const parts = [
    summary.manages.length > 0 ? `Manages ${summary.manages.join(", ")}` : null,
    summary.readsOnly.length > 0
      ? `Reads ${summary.readsOnly.join(", ")}`
      : null,
  ].filter((part): part is string => part !== null);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="whitespace-nowrap text-ink tabular">
        {summary.granted} of {summary.total}
      </span>
      <span className="line-clamp-2 max-w-sm text-13 text-ink-subtle">
        {parts.length > 0 ? `${parts.join(". ")}.` : "Nothing yet."}
      </span>
      {summary.managesBlind.length > 0 ? (
        <Badge tone="attention" className="mt-1 self-start">
          Manage without read: {summary.managesBlind.join(", ")}
        </Badge>
      ) : null}
    </span>
  );
}

function Members({
  members,
  loading,
}: {
  members: AdminWithRole[] | null;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="w-32" />;
  if (members === null) {
    return (
      <Tooltip content="Your role does not include reading the team.">
        <span tabIndex={0} className="text-ink-subtle">
          Not shown
        </span>
      </Tooltip>
    );
  }
  if (members.length === 0)
    return <span className="text-ink-subtle">Nobody</span>;
  const disabled = members.filter(
    (member) => member.status === "disabled",
  ).length;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="line-clamp-2 max-w-xs text-ink">
        {members.map((member) => member.name).join(", ")}
      </span>
      {disabled > 0 ? (
        <span className="text-13 text-ink-subtle">
          {disabled} of them disabled
        </span>
      ) : null}
    </span>
  );
}

function DeleteRoleDialog({
  role,
  members,
  open,
  onOpenChange,
}: {
  role: Role | null;
  members: AdminWithRole[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const remove = useDeleteRole();
  const teamReadable = useCan()("admin_users.read");
  if (!role) return null;
  const inUse = members !== null && members.length > 0;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete the role "${role.name}"?`}
      description={
        inUse
          ? "A role that an admin still has cannot be deleted."
          : members === null
            ? `The role is removed for good. The API refuses while an admin still has it${
                teamReadable
                  ? "."
                  : "; your role does not show the team, so the panel cannot check that first."
              }`
            : "No admin has this role. It is removed for good."
      }
      facts={[
        { label: "Key", value: <span className="font-mono">{role.key}</span> },
        ...(members !== null
          ? [{ label: "Admins with this role", value: members.length }]
          : []),
      ]}
      confirmLabel="Delete the role"
      cancelLabel={inUse ? "Close" : "Keep it"}
      tone="danger"
      canConfirm={!inUse}
      onConfirm={async () => {
        try {
          await remove.mutateAsync(role.id);
        } catch (error) {
          // The lists were out of date: who has the role is loaded again.
          if (
            hasErrorCode(
              error,
              "ROLE_IN_USE",
              "ROLE_NOT_FOUND",
              "ROLE_IS_SYSTEM",
            )
          ) {
            void client.invalidateQueries({
              queryKey: queryKeys.adminUsers.all,
            });
            void client.invalidateQueries({ queryKey: queryKeys.roles.all });
          }
          throw error;
        }
        notify.success(`Role "${role.name}" deleted`);
      }}
    >
      {inUse ? (
        <Alert
          tone="warning"
          title={`Still assigned to ${plural(members.length, "admin")}`}
        >
          {members.map((member) => member.name).join(", ")}. Give them another
          role on the <Link href={routes.team}>Team page</Link> first.
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}

/** The roles of the panel: what each allows and who has it. */
export function RolesView() {
  const me = useAdmin();
  const can = useCan();
  const manage = can("roles.manage");
  const roles = useRoles();
  const permissions = usePermissionCatalogue();
  const members = useRoleMembers();
  const catalogue = permissions.data
    ? buildCatalogue(permissions.data.items)
    : defaultCatalogue();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRoleId, setEditorRoleId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null);
  const byId = (id: string | null) =>
    id ? (roles.data?.items.find((role) => role.id === id) ?? null) : null;
  const membersOf = (role: Role | null) =>
    role && members.known ? members.of(role.id) : null;

  function openEditor(role: Role | null) {
    setEditorRoleId(role?.id ?? null);
    setEditorOpen(true);
  }

  const columns: Column<Role>[] = [
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => (
        <TwoLine
          primary={
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openEditor(row.original)}
                className="truncate rounded-xs font-semibold text-accent-text hover:underline"
              >
                {row.original.name}
              </button>
              {row.original.isSystem ? (
                <Badge tone="neutral" dot={false}>
                  System
                </Badge>
              ) : null}
              {row.original.id === me.roleId ? (
                <Badge tone="planned" dot={false}>
                  Your role
                </Badge>
              ) : null}
            </span>
          }
          secondary={
            <span className="font-mono text-xs">{row.original.key}</span>
          }
        />
      ),
      meta: { skeleton: "w-36" },
    },
    {
      id: "description",
      header: "Description",
      cell: ({ row }) =>
        row.original.description ? (
          <span className="line-clamp-2 max-w-xs text-ink-muted">
            {row.original.description}
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
      meta: { from: "lg", skeleton: "w-48" },
    },
    {
      id: "permissions",
      header: "Permissions",
      cell: ({ row }) => <Access role={row.original} catalogue={catalogue} />,
      meta: { skeleton: "w-40" },
    },
    {
      id: "admins",
      header: "Admins",
      cell: ({ row }) => (
        <Members members={membersOf(row.original)} loading={members.loading} />
      ),
      meta: { from: "md", skeleton: "w-32" },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const role = row.original;
        const editable = manage && !role.isSystem;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${role.name}`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => openEditor(role)}>
                {editable ? <Pencil /> : <Eye />}
                {editable ? "Edit" : "Show the permissions"}
              </DropdownMenuItem>
              {editable ? (
                <DropdownMenuItem
                  danger
                  onSelect={() => {
                    setDeleteRoleId(role.id);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      meta: { align: "right", className: "w-12", skeleton: "w-6" },
    },
  ];

  const editorRole = byId(editorRoleId);
  const deleteRole = byId(deleteRoleId);

  return (
    <RequirePermission permission="roles.read">
      <PageHeader
        title="Roles"
        description="A role is a set of permissions, and every admin has exactly one. Reading and managing are separate permissions: a page opens with read, a change needs manage."
        actions={
          <ActionButton
            permission="roles.manage"
            variant="primary"
            icon={<Plus />}
            onClick={() => openEditor(null)}
          >
            New role
          </ActionButton>
        }
      />
      <PageBody>
        <DataTable
          caption="Roles, sorted by key"
          columns={columns}
          data={roles.data?.items}
          getRowId={(role) => role.id}
          error={roles.error}
          onRetry={() => void roles.refetch()}
          empty={
            <EmptyState icon={<KeyRound />} title="No role yet">
              A role says what an admin may read and change. Create one and give
              it to the people of the team.
            </EmptyState>
          }
        />
      </PageBody>

      <RoleDialog
        role={editorRole}
        catalogue={catalogue}
        ready={!permissions.isLoading}
        members={membersOf(editorRole)}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />
      <DeleteRoleDialog
        role={deleteRole}
        members={membersOf(deleteRole)}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </RequirePermission>
  );
}
