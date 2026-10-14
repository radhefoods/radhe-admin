"use client";

import { Check, LogOut, Minus, ShieldCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Fact,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { ChangePasswordForm } from "@/features/auth/change-password-form";
import { defaultCatalogue, summarizeAccess } from "@/features/roles/matrix";
import { useAdmin, useAuth } from "@/lib/auth/auth-provider";
import { hasPermission } from "@/lib/auth/permissions";
import { initials } from "@/lib/format/names";
import { routes } from "@/lib/routes";

function Allowed({ allowed, label }: { allowed: boolean; label: string }) {
  return allowed ? (
    <span className="inline-flex items-center justify-center text-success-fg">
      <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
      <span className="sr-only">{label}: yes</span>
    </span>
  ) : (
    <span className="inline-flex items-center justify-center text-ink-subtle">
      <Minus aria-hidden="true" className="size-4" />
      <span className="sr-only">{label}: no</span>
    </span>
  );
}

/** What the role of the signed-in admin allows, area by area. */
function RoleAccess() {
  const admin = useAdmin();
  const permissions = admin.role.permissions;
  const catalogue = defaultCatalogue();
  const summary = summarizeAccess(permissions, catalogue);

  return (
    <Card>
      <CardHeader
        title={`What the role "${admin.role.name}" allows`}
        description={
          summary.everything
            ? "Everything, including what is added to the panel later."
            : "Read opens the pages of an area; manage allows changes there. An admin who manages roles can change this."
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Your permissions by area</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-line px-4 py-2 text-left text-xs font-semibold text-ink-muted sm:px-5"
              >
                Area
              </th>
              <th
                scope="col"
                className="w-20 border-b border-line px-3 py-2 text-center text-xs font-semibold text-ink-muted"
              >
                Read
              </th>
              <th
                scope="col"
                className="w-20 border-b border-line px-3 py-2 text-center text-xs font-semibold text-ink-muted"
              >
                Manage
              </th>
            </tr>
          </thead>
          <tbody>
            {catalogue.rows.map((row) => (
              <tr key={row.resource} className="[&:last-child>*]:border-b-0">
                <th
                  scope="row"
                  className="border-b border-line px-4 py-2 text-left font-normal sm:px-5"
                >
                  <span className="font-medium text-ink">{row.label}</span>
                  <span className="block text-13 text-ink-muted">
                    {row.covers}
                  </span>
                </th>
                {(["read", "manage"] as const).map((action) => (
                  <td
                    key={action}
                    className="border-b border-line px-3 py-2 text-center"
                  >
                    <Allowed
                      allowed={hasPermission(
                        permissions,
                        `${row.resource}.${action}`,
                      )}
                      label={`${row.label}, ${action}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * The signed-in admin: who they are, what their role allows, their
 * password, their second factor and their sessions.
 */
export function ProfileView() {
  const admin = useAdmin();
  const { can, reload, signOut, signOutEverywhere } = useAuth();
  const [everywhere, setEverywhere] = useState(false);
  const [leaving, setLeaving] = useState(false);

  return (
    <>
      <PageHeader
        title="Profile and security"
        description="Your account in this panel. Your name, role and status are changed by an admin with the Team permission."
      />
      <PageBody className="max-w-6xl">
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardBody className="flex flex-col gap-5">
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg font-bold text-accent-text"
                  >
                    {initials(admin.name)}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-xl leading-tight text-ink">
                      {admin.name}
                    </h2>
                    <p className="truncate text-sm text-ink-muted">
                      {admin.email}
                    </p>
                  </div>
                </div>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Fact label="Role">
                    {admin.role.name}{" "}
                    <span className="font-mono text-xs text-ink-subtle">
                      {admin.role.key}
                    </span>
                  </Fact>
                  <Fact label="Status">
                    <StatusBadge kind="admin" value={admin.status} />
                  </Fact>
                  <Fact label="Last sign-in">
                    {admin.lastLoginAt ? (
                      <DateTime value={admin.lastLoginAt} />
                    ) : (
                      <span className="text-ink-subtle">Not recorded</span>
                    )}
                  </Fact>
                  <Fact label="Admin since">
                    <DateTime value={admin.createdAt} />
                  </Fact>
                </dl>
              </CardBody>
            </Card>

            <RoleAccess />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader
                title="Password"
                description="When the password changes, every other device is signed out. You stay signed in here."
              />
              <CardBody>
                <ChangePasswordForm
                  onChanged={async () => {
                    await reload();
                    notify.success(
                      "Password changed",
                      "Your other devices were signed out.",
                    );
                  }}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Two-factor sign-in"
                description="Every admin signs in with a code from an authenticator app."
                actions={
                  admin.mfaEnabled ? (
                    <Badge tone="success">Set up</Badge>
                  ) : (
                    <Badge tone="attention">Not set up</Badge>
                  )
                }
              />
              <CardBody className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  {admin.mfaEnabled ? (
                    <ShieldCheck
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-success-fg"
                    />
                  ) : (
                    <ShieldAlert
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-attention-fg"
                    />
                  )}
                  <p className="text-sm text-ink">
                    {admin.mfaEnabled
                      ? "Your authenticator app is set up. You are asked for its 6-digit code at every sign-in."
                      : "No authenticator is set up for your account. You are asked to set one up at your next sign-in."}
                  </p>
                </div>
                <Alert tone="warning" title="There are no recovery codes">
                  If you lose the phone with the authenticator, you cannot sign
                  in and cannot fix it yourself. Another admin with the Team
                  permission resets your two-factor; you then set up the
                  authenticator again at your next sign-in.
                </Alert>
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-13 text-ink-muted">
                  <li>
                    Keep the authenticator on a second device as well, or in a
                    password manager that stores one-time codes. Then a lost
                    phone does not lock you out.
                  </li>
                  <li>
                    To move to a new phone while you still have the old one, an
                    admin with the Team permission resets your two-factor on the{" "}
                    {can("admin_users.read") ? (
                      <Link
                        href={routes.team}
                        className="font-medium text-accent-text underline underline-offset-2"
                      >
                        Team page
                      </Link>
                    ) : (
                      "Team page"
                    )}
                    , and you set it up again at your next sign-in.
                    {can("admin_users.manage")
                      ? " Your role includes that permission: you can reset your own there."
                      : ""}
                  </li>
                  <li>
                    If you are the only admin who can reset two-factor, a lost
                    phone locks you out of the panel. Give a second person you
                    trust the Team permission. The way out without one is on the
                    server: whoever runs the API enters{" "}
                    <code className="rounded-xs bg-sunken px-1 font-mono text-xs">
                      npm run reset:mfa -- {admin.email}
                    </code>{" "}
                    there, which removes your authenticator and ends your
                    sessions; you sign in with your password and set it up
                    again.
                  </li>
                </ul>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Sessions"
                description="A session ends by itself after 12 hours without use, and after 72 hours in any case."
              />
              <CardBody className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">This device</p>
                    <p className="text-13 text-ink-muted">
                      Ends the session in this browser.
                    </p>
                  </div>
                  <Button
                    icon={<LogOut />}
                    loading={leaving}
                    onClick={async () => {
                      setLeaving(true);
                      await signOut();
                    }}
                  >
                    Sign out
                  </Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 sm:flex-nowrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">Every device</p>
                    <p className="text-13 text-ink-muted">
                      For a lost laptop or a browser you forgot to sign out of.
                    </p>
                  </div>
                  <Button
                    variant="danger-outline"
                    onClick={() => setEverywhere(true)}
                  >
                    Sign out everywhere
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </PageBody>

      <ConfirmDialog
        open={everywhere}
        onOpenChange={setEverywhere}
        title="Sign out everywhere?"
        description="Every session of your account ends at once: this browser and every other device. You sign in again with your password and the code from your authenticator."
        confirmLabel="Sign out everywhere"
        cancelLabel="Stay signed in"
        tone="danger"
        onConfirm={signOutEverywhere}
      />
    </>
  );
}
