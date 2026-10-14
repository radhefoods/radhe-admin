// Sections 1 (authentication), 2 (admin users) and 3 (roles).

import type { Id, IsoDateTime } from "./common";

export type AdminStatus = "active" | "disabled";

export interface AdminRoleSummary {
  key: string;
  name: string;
  permissions: string[];
}

/** 1.1. `role` is absent in the answers of create/update admin user. */
export interface Admin {
  id: Id;
  email: string;
  name: string;
  status: AdminStatus;
  roleId: Id;
  role?: AdminRoleSummary;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type AdminWithRole = Admin & { role: AdminRoleSummary };

export interface Authenticated {
  status: "authenticated";
  admin: AdminWithRole;
  accessTokenExpiresInSeconds: number;
}

export type LoginResult =
  | { status: "mfa_required"; mfaToken: string }
  | { status: "mfa_setup_required"; mfaToken: string }
  | Authenticated;

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
}

export interface RefreshResult {
  admin: AdminWithRole;
  accessTokenExpiresInSeconds: number;
}

export interface CreateAdminInput {
  email: string;
  name: string;
  temporaryPassword: string;
  roleId: Id;
  /** Default `true`: the new admin is emailed the password and the link. */
  sendInvitation?: boolean;
}

export interface UpdateAdminInput {
  name?: string;
  roleId?: Id;
  status?: AdminStatus;
}

/** Section 3. */
export interface Role {
  id: Id;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateRoleInput {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleInput {
  name?: string;
  /** `null` removes the description. */
  description?: string | null;
  permissions?: string[];
}
