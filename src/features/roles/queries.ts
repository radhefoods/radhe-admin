"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  AdminWithRole,
  CreateRoleInput,
  Id,
  UpdateRoleInput,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

/** Every role, sorted by key. */
export function useRoles() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.roles.list(),
    queryFn: ({ signal }) => api.roles.list(signal),
    enabled: can("roles.read"),
  });
}

/** Every permission a role can contain, for the matrix of the editor. */
export function usePermissionCatalogue() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.roles.permissions(),
    queryFn: ({ signal }) => api.roles.permissions(signal),
    enabled: can("roles.read"),
    staleTime: 5 * 60_000,
  });
}

/**
 * Who has which role. The team list needs its own permission: without it
 * `known` is `false`, and the page says that it cannot tell.
 */
export function useRoleMembers(): {
  known: boolean;
  loading: boolean;
  of: (roleId: Id) => AdminWithRole[];
} {
  const can = useCan();
  const readable = can("admin_users.read");
  const admins = useQuery({
    queryKey: queryKeys.adminUsers.list(),
    queryFn: ({ signal }) => api.adminUsers.list(signal),
    enabled: readable,
  });
  const items = admins.data?.items;
  return {
    known: readable && items !== undefined,
    loading: readable && admins.isLoading,
    of: (roleId) => (items ?? []).filter((admin) => admin.roleId === roleId),
  };
}

// The name of a role is shown with every admin, and the signed-in admin's
// own permissions may be the ones that changed.
const stale = [queryKeys.roles.all, queryKeys.adminUsers.all] as const;

export function useCreateRole() {
  return useMutation({
    mutationFn: async (input: CreateRoleInput) =>
      (await api.roles.create(input)).role,
    meta: { invalidates: stale, silent: true },
  });
}

export function useUpdateRole() {
  return useMutation({
    mutationFn: async ({ id, input }: { id: Id; input: UpdateRoleInput }) =>
      (await api.roles.update(id, input)).role,
    meta: { invalidates: stale, silent: true },
  });
}

export function useDeleteRole() {
  return useMutation({
    mutationFn: (id: Id) => api.roles.remove(id),
    meta: { invalidates: stale, silent: true },
  });
}
