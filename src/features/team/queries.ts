"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { CreateAdminInput, Id, UpdateAdminInput } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { roleChoices, roleChoicesInUse, type RoleChoice } from "./team";

/** Every admin, newest first (the API returns the whole list, 200 at most). */
export function useAdminUsers() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.adminUsers.list(),
    queryFn: ({ signal }) => api.adminUsers.list(signal),
    enabled: can("admin_users.read"),
  });
}

/**
 * The roles an admin can be given. Reading roles is its own permission:
 * without it, only the roles that some admin already has are known.
 */
export function useRoleChoices(): {
  roles: RoleChoice[];
  /** `false`: only the roles in use are listed. */
  complete: boolean;
  loading: boolean;
} {
  const can = useCan();
  const readable = can("roles.read");
  const roles = useQuery({
    queryKey: queryKeys.roles.list(),
    queryFn: ({ signal }) => api.roles.list(signal),
    enabled: readable,
  });
  const admins = useAdminUsers();
  if (readable && roles.data) {
    return {
      roles: roleChoices(roles.data.items),
      complete: true,
      loading: false,
    };
  }
  return {
    roles: roleChoicesInUse(admins.data?.items ?? []),
    complete: false,
    loading: readable ? roles.isLoading : admins.isLoading,
  };
}

// A change to an admin can change the roles page too (who has which role).
const stale = [queryKeys.adminUsers.all] as const;

export function useInviteAdmin() {
  return useMutation({
    mutationFn: (input: CreateAdminInput) => api.adminUsers.create(input),
    meta: { invalidates: stale, silent: true },
  });
}

export function useUpdateAdmin() {
  return useMutation({
    mutationFn: async ({ id, input }: { id: Id; input: UpdateAdminInput }) =>
      (await api.adminUsers.update(id, input)).admin,
    meta: { invalidates: stale, silent: true },
  });
}

export function useResetAdminPassword() {
  return useMutation({
    mutationFn: ({
      id,
      temporaryPassword,
    }: {
      id: Id;
      temporaryPassword: string;
    }) => api.adminUsers.resetPassword(id, temporaryPassword),
    meta: { invalidates: stale, silent: true },
  });
}

export function useResetAdminMfa() {
  return useMutation({
    mutationFn: (id: Id) => api.adminUsers.resetMfa(id),
    meta: { invalidates: stale, silent: true },
  });
}

/**
 * A dialog about one record: the record stays while the dialog closes, so
 * its text does not vanish before the dialog has.
 */
export function useDialogTarget<T>(): {
  target: T | null;
  open: boolean;
  show: (target: T) => void;
  setOpen: (open: boolean) => void;
} {
  const [target, setTarget] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  return {
    target,
    open,
    show: (next) => {
      setTarget(next);
      setOpen(true);
    },
    setOpen,
  };
}
