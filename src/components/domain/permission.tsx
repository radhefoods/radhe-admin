"use client";

import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/surface";
import { useAdmin, useCan } from "@/lib/auth/auth-provider";
import {
  describePermission,
  missingPermissionHint,
  type Permission,
} from "@/lib/auth/permissions";

/**
 * A page (or a part of one) that needs a permission to be read. Without
 * it, the admin sees why instead of an error from the API.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const can = useCan();
  const admin = useAdmin();
  if (can(permission)) return <>{children}</>;
  return (
    <EmptyState icon={<Lock />} title="Your role does not open this page">
      It needs “{describePermission(permission)}”. Your role is “
      {admin.role.name}”. An admin who manages roles can change that.
    </EmptyState>
  );
}

/** Renders its children only with the permission. For whole sections. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return <>{useCan()(permission) ? children : fallback}</>;
}

export interface ActionButtonProps extends ButtonProps {
  /** The permission the action needs (`orders.manage`). */
  permission: Permission;
  /**
   * Why the action is not possible right now although the role allows it
   * (the status of the record, for example). Disables with this hint.
   */
  blocked?: string | null;
}

/**
 * A button for something that changes data. Without the permission it
 * stays visible, disabled, and says what is missing: the admin learns that
 * the action exists and who can do it. The API enforces it in any case.
 */
export function ActionButton({
  permission,
  blocked,
  disabled,
  children,
  ...props
}: ActionButtonProps) {
  const allowed = useCan()(permission);
  const hint = !allowed ? missingPermissionHint(permission) : blocked || null;

  if (!hint) {
    return (
      <Button disabled={disabled} {...props}>
        {children}
      </Button>
    );
  }
  return (
    <Tooltip content={hint}>
      {/* A disabled button takes no pointer or focus: the wrapper carries the hint. */}
      <span tabIndex={0} className="inline-flex rounded-md" aria-label={hint}>
        <Button {...props} disabled aria-disabled="true" tabIndex={-1}>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}
