import type {
  AdminWithRole,
  Id,
  Role,
  UpdateAdminInput,
} from "@/lib/api/types";
import { SUPER_ADMIN_ROLE_KEY } from "@/lib/auth/permissions";

// The rules of the API for admin users (documentation, 2), as far as the
// panel can know them before asking: it disables what would be refused and
// says why. The API decides in any case.

export interface RoleChoice {
  id: Id;
  key: string;
  name: string;
  description: string | null;
}

/** The roles an admin can be given, from the list of roles. */
export function roleChoices(roles: readonly Role[]): RoleChoice[] {
  return roles.map(({ id, key, name, description }) => ({
    id,
    key,
    name,
    description,
  }));
}

/**
 * Without the right to read roles, the roles that are in use are still
 * known: every admin of the team list carries the name of their role.
 */
export function roleChoicesInUse(
  admins: readonly AdminWithRole[],
): RoleChoice[] {
  const byId = new Map<Id, RoleChoice>();
  for (const admin of admins) {
    if (!byId.has(admin.roleId)) {
      byId.set(admin.roleId, {
        id: admin.roleId,
        key: admin.role.key,
        name: admin.role.name,
        description: null,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function isSuperAdmin(admin: AdminWithRole): boolean {
  return admin.role.key === SUPER_ADMIN_ROLE_KEY;
}

/** One active super admin must remain (`409 ADMIN_SELF_MODIFICATION`). */
export function isLastActiveSuperAdmin(
  admin: AdminWithRole,
  admins: readonly AdminWithRole[],
): boolean {
  if (!isSuperAdmin(admin) || admin.status !== "active") return false;
  return !admins.some(
    (other) =>
      other.id !== admin.id && other.status === "active" && isSuperAdmin(other),
  );
}

/**
 * Why the role and the status of an admin cannot change, or `null` when
 * they can: nobody changes their own (`403 ADMIN_SELF_MODIFICATION`), and
 * the last active super admin stays one.
 */
export function accessLock(
  admin: AdminWithRole,
  myId: Id,
  admins: readonly AdminWithRole[],
): string | null {
  if (admin.id === myId) {
    return "You cannot change your own role or status. Another admin with the Team permission can.";
  }
  if (isLastActiveSuperAdmin(admin, admins)) {
    return "This is the only active super admin. One must remain: make another admin a super admin first.";
  }
  return null;
}

export interface AdminEdit {
  name: string;
  roleId: Id;
  active: boolean;
}

/** Only what changed: a changed role or status signs the admin out everywhere. */
export function toAdminPatch(
  values: AdminEdit,
  admin: AdminWithRole,
): UpdateAdminInput {
  const patch: UpdateAdminInput = {};
  if (values.name !== admin.name) patch.name = values.name;
  if (values.roleId !== admin.roleId) patch.roleId = values.roleId;
  const status = values.active ? "active" : "disabled";
  if (status !== admin.status) patch.status = status;
  return patch;
}

/** A change of role or status ends every session of that admin. */
export function changesAccess(patch: UpdateAdminInput): boolean {
  return patch.roleId !== undefined || patch.status !== undefined;
}

/** `Nisha` for a sentence about Nisha Patel. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
