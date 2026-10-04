"use client";

import {
  Ellipsis,
  KeyRound,
  Pencil,
  ShieldOff,
  User,
  UserCog,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/surface";
import type { AdminWithRole } from "@/lib/api/types";
import { useAdmin, useCan } from "@/lib/auth/auth-provider";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { EditAdminDialog } from "./edit-admin-dialog";
import { InviteDialog } from "./invite-dialog";
import { useAdminUsers, useDialogTarget } from "./queries";
import { ResetMfaDialog, ResetPasswordDialog } from "./reset-dialogs";
import { HandoverDialog, type Handover } from "./temporary-password";

function TwoFactor({ admin }: { admin: AdminWithRole }) {
  return admin.mfaEnabled ? (
    <Badge tone="success">Set up</Badge>
  ) : (
    <Badge tone="attention">Not set up</Badge>
  );
}

function Password({ admin }: { admin: AdminWithRole }) {
  return admin.mustChangePassword ? (
    <Badge tone="attention">Must change</Badge>
  ) : (
    <span className="text-ink-muted">Own password</span>
  );
}

function LastSignIn({ admin }: { admin: AdminWithRole }) {
  return admin.lastLoginAt ? (
    <DateTime value={admin.lastLoginAt} short />
  ) : (
    <span className="text-ink-subtle">Never</span>
  );
}

function Summary({ admins }: { admins: readonly AdminWithRole[] }) {
  const active = admins.filter((admin) => admin.status === "active");
  const disabled = admins.length - active.length;
  const withoutMfa = active.filter((admin) => !admin.mfaEnabled).length;
  return (
    <p className="text-13 text-ink-muted">
      {plural(admins.length, "admin")}: {active.length} active
      {disabled > 0 ? `, ${disabled} disabled` : ""}.
      {withoutMfa > 0
        ? ` ${withoutMfa} active ${withoutMfa === 1 ? "admin has" : "admins have"} no authenticator yet: it is set up at the next sign-in.`
        : ""}
    </p>
  );
}

/** The admins of the panel: who they are, what role they have, how they sign in. */
export function TeamView() {
  const me = useAdmin();
  const can = useCan();
  const manage = can("admin_users.manage");
  const list = useAdminUsers();
  const admins = list.data?.items;

  const [inviting, setInviting] = useState(false);
  const editing = useDialogTarget<AdminWithRole>();
  const password = useDialogTarget<AdminWithRole>();
  const mfa = useDialogTarget<AdminWithRole>();
  const handover = useDialogTarget<Handover>();
  /** The admin as the list knows them now, not as they were when the dialog opened. */
  const fresh = (target: AdminWithRole | null) =>
    target ? (admins?.find((admin) => admin.id === target.id) ?? target) : null;

  const columns: Column<AdminWithRole>[] = [
    {
      id: "admin",
      header: "Admin",
      cell: ({ row }) => (
        <TwoLine
          primary={
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold">
                {row.original.name}
              </span>
              {row.original.id === me.id ? (
                <Badge tone="planned" dot={false}>
                  You
                </Badge>
              ) : null}
            </span>
          }
          secondary={
            <>
              {row.original.email}
              {/* On a phone the role has no column of its own. */}
              <span className="block truncate sm:hidden">
                {row.original.role.name}
              </span>
            </>
          }
        />
      ),
      meta: { skeleton: "w-40" },
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => row.original.role.name,
      meta: { from: "sm" },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge kind="admin" value={row.original.status} />
      ),
    },
    {
      id: "mfa",
      header: "Two-factor",
      cell: ({ row }) => <TwoFactor admin={row.original} />,
      meta: { from: "md" },
    },
    {
      id: "password",
      header: "Password",
      cell: ({ row }) => <Password admin={row.original} />,
      meta: { from: "lg" },
    },
    {
      id: "lastLogin",
      header: "Last sign-in",
      cell: ({ row }) => <LastSignIn admin={row.original} />,
      meta: { from: "md", skeleton: "w-20" },
    },
    ...(manage
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }) => {
              const admin = row.original;
              const self = admin.id === me.id;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${admin.name}`}
                    >
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => editing.show(admin)}>
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {self ? (
                      <DropdownMenuItem asChild>
                        <Link href={routes.profile}>
                          <User />
                          Change your password in your profile
                        </Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => password.show(admin)}>
                        <KeyRound />
                        Reset the password
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      danger={admin.mfaEnabled}
                      disabled={!admin.mfaEnabled}
                      onSelect={() => mfa.show(admin)}
                    >
                      <ShieldOff />
                      {admin.mfaEnabled
                        ? "Reset two-factor"
                        : "Reset two-factor (none set up)"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
            meta: {
              align: "right" as const,
              className: "w-12",
              skeleton: "w-6",
            },
          } satisfies Column<AdminWithRole>,
        ]
      : []),
  ];

  return (
    <RequirePermission permission="admin_users.read">
      <PageHeader
        title="Team"
        description="The people who use this panel. Everyone signs in with email, password and an authenticator app; what they may do is set by their role."
        actions={
          <ActionButton
            permission="admin_users.manage"
            variant="primary"
            icon={<UserPlus />}
            onClick={() => setInviting(true)}
          >
            Invite an admin
          </ActionButton>
        }
      />
      <PageBody className="gap-3">
        {admins ? <Summary admins={admins} /> : null}
        <DataTable
          caption="Admins, newest first"
          columns={columns}
          data={admins}
          getRowId={(admin) => admin.id}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={
            <EmptyState icon={<UserCog />} title="No admin yet">
              Invite the people who run the shop with you. Each gets a role that
              says what they may read and change.
            </EmptyState>
          }
        />
      </PageBody>

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        onInvited={(invited) => {
          setInviting(false);
          handover.show(invited);
        }}
      />
      <EditAdminDialog
        admin={fresh(editing.target)}
        admins={admins ?? []}
        open={editing.open}
        onOpenChange={editing.setOpen}
      />
      <ResetPasswordDialog
        admin={fresh(password.target)}
        open={password.open}
        onOpenChange={password.setOpen}
        onReset={handover.show}
      />
      <ResetMfaDialog
        admin={fresh(mfa.target)}
        open={mfa.open}
        onOpenChange={mfa.setOpen}
      />
      <HandoverDialog
        handover={handover.target}
        open={handover.open}
        onOpenChange={handover.setOpen}
      />
    </RequirePermission>
  );
}
