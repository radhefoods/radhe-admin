// Sections 1 (authentication), 2 (admin users) and 3 (roles).

import type { SessionTransport } from "../session";
import type {
  Admin,
  AdminWithRole,
  Authenticated,
  CreateAdminInput,
  CreateRoleInput,
  Id,
  ListResult,
  LoginResult,
  MfaSetup,
  Role,
  UpdateAdminInput,
  UpdateRoleInput,
} from "../types";

export function authApi({ request }: SessionTransport) {
  const base = "/v1/admin/auth";
  return {
    login: (input: { email: string; password: string }) =>
      request<LoginResult>(`${base}/login`, { method: "POST", body: input }),
    mfaSetup: (mfaToken: string) =>
      request<MfaSetup>(`${base}/mfa/setup`, {
        method: "POST",
        body: { mfaToken },
      }),
    mfaVerify: (input: { mfaToken: string; code: string }) =>
      request<Authenticated>(`${base}/mfa/verify`, {
        method: "POST",
        body: input,
      }),
    me: (signal?: AbortSignal) =>
      request<{ admin: AdminWithRole }>(`${base}/me`, { signal }),
    logout: () => request<void>(`${base}/logout`, { method: "POST" }),
    logoutAll: () => request<void>(`${base}/logout-all`, { method: "POST" }),
    changePassword: (input: { currentPassword: string; newPassword: string }) =>
      request<void>(`${base}/change-password`, { method: "POST", body: input }),
  };
}

export function adminUsersApi({ request }: SessionTransport) {
  const base = "/v1/admin/admin-users";
  return {
    list: (signal?: AbortSignal) =>
      request<ListResult<AdminWithRole>>(base, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ admin: AdminWithRole }>(`${base}/${id}`, { signal }),
    create: (input: CreateAdminInput) =>
      request<{ admin: Admin }>(base, { method: "POST", body: input }),
    update: (id: Id, input: UpdateAdminInput) =>
      request<{ admin: Admin }>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    resetPassword: (id: Id, temporaryPassword: string) =>
      request<void>(`${base}/${id}/reset-password`, {
        method: "POST",
        body: { temporaryPassword },
      }),
    resetMfa: (id: Id) =>
      request<void>(`${base}/${id}/reset-mfa`, { method: "POST" }),
  };
}

export function rolesApi({ request }: SessionTransport) {
  const base = "/v1/admin/roles";
  return {
    list: (signal?: AbortSignal) => request<ListResult<Role>>(base, { signal }),
    permissions: (signal?: AbortSignal) =>
      request<ListResult<string>>(`${base}/permissions`, { signal }),
    create: (input: CreateRoleInput) =>
      request<{ role: Role }>(base, { method: "POST", body: input }),
    update: (id: Id, input: UpdateRoleInput) =>
      request<{ role: Role }>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
  };
}
