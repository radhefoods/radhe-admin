// Sections 2 (admin users) and 3 (roles).

import { z } from "zod";
import type { Role } from "../../src/lib/api/types/index.ts";
import { adminView, revokeSessions } from "../auth.ts";
import type { AdminRecord, Db } from "../db.ts";
import { fail, json, newId, noContent, zId } from "../http.ts";
import type { Router } from "../router.ts";
import { ALL_PERMISSIONS } from "../seed.ts";
import { iso } from "../time.ts";

function adminById(db: Db, id: string): AdminRecord {
  const admin = db.admins.find((entry) => entry.id === id);
  if (!admin)
    throw fail(404, "ADMIN_NOT_FOUND", "The admin user was not found.");
  return admin;
}

function roleById(db: Db, id: string): Role {
  const role = db.roles.find((entry) => entry.id === id);
  if (!role) throw fail(404, "ROLE_NOT_FOUND", "The role was not found.");
  return role;
}

function isSuperAdmin(db: Db, admin: AdminRecord): boolean {
  return (
    db.roles.find((role) => role.id === admin.roleId)?.key === "super_admin"
  );
}

/** One active super admin must remain. */
function assertNotLastSuperAdmin(db: Db, admin: AdminRecord): void {
  if (!isSuperAdmin(db, admin) || admin.status !== "active") return;
  const others = db.admins.filter(
    (entry) =>
      entry.id !== admin.id &&
      entry.status === "active" &&
      isSuperAdmin(db, entry),
  );
  if (others.length === 0) {
    throw fail(
      409,
      "ADMIN_SELF_MODIFICATION",
      "At least one active super admin must remain.",
    );
  }
}

function isKnownPermission(value: string): boolean {
  if (value === "*" || ALL_PERMISSIONS.includes(value)) return true;
  if (!value.endsWith(".*")) return false;
  const resource = value.slice(0, -2);
  return ALL_PERMISSIONS.some((permission) =>
    permission.startsWith(`${resource}.`),
  );
}

function assertKnownPermissions(permissions: string[]): void {
  const unknown = permissions.filter(
    (permission) => !isKnownPermission(permission),
  );
  if (unknown.length > 0) {
    throw fail(
      400,
      "ROLE_PERMISSION_UNKNOWN",
      "The role contains unknown permissions.",
      { unknown },
    );
  }
}

const temporaryPassword = z.string().min(12).max(128);
const createAdmin = z.strictObject({
  email: z.email().max(254),
  name: z.string().min(1).max(120),
  temporaryPassword,
  roleId: zId,
});
const updateAdmin = z.strictObject({
  name: z.string().min(1).max(120).optional(),
  roleId: zId.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
const createRole = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,40}$/, "key must match ^[a-z][a-z0-9_]{2,40}$"),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string()).max(200),
});
const updateRole = z.strictObject({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string()).max(200).optional(),
});

export function registerTeam(router: Router): void {
  const users = "/v1/admin/admin-users";

  router.get(users, { permission: "admin_users.read" }, (ctx) =>
    json({
      items: [...ctx.db.admins]
        .sort((a, b) => (a.id < b.id ? 1 : -1))
        .slice(0, 200)
        .map((admin) => adminView(ctx.db, admin)),
    }),
  );

  router.post(users, { permission: "admin_users.manage" }, async (ctx) => {
    const input = await ctx.body(createAdmin);
    roleById(ctx.db, input.roleId);
    const email = input.email.toLowerCase();
    if (ctx.db.admins.some((entry) => entry.email === email)) {
      throw fail(
        409,
        "ADMIN_EMAIL_TAKEN",
        "An admin with this email exists already.",
      );
    }
    const admin: AdminRecord = {
      id: newId(ctx.now),
      email,
      name: input.name,
      status: "active",
      roleId: input.roleId,
      password: input.temporaryPassword,
      totpSecret: null,
      pendingTotpSecret: null,
      lastTotpStep: null,
      mustChangePassword: true,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.admins.push(admin);
    return json({ admin: adminView(ctx.db, admin, false) }, 201);
  });

  router.get(`${users}/:id`, { permission: "admin_users.read" }, (ctx) =>
    json({ admin: adminView(ctx.db, adminById(ctx.db, ctx.params.id ?? "")) }),
  );

  router.patch(
    `${users}/:id`,
    { permission: "admin_users.manage" },
    async (ctx) => {
      const input = await ctx.body(updateAdmin);
      const admin = adminById(ctx.db, ctx.params.id ?? "");
      const changesAccess =
        (input.roleId !== undefined && input.roleId !== admin.roleId) ||
        (input.status !== undefined && input.status !== admin.status);
      if (changesAccess) {
        if (admin.id === ctx.admin.id) {
          throw fail(
            403,
            "ADMIN_SELF_MODIFICATION",
            "You cannot change your own role or status.",
          );
        }
        assertNotLastSuperAdmin(ctx.db, admin);
      }
      if (input.roleId !== undefined) roleById(ctx.db, input.roleId);
      if (input.name !== undefined) admin.name = input.name;
      if (input.roleId !== undefined) admin.roleId = input.roleId;
      if (input.status !== undefined) admin.status = input.status;
      admin.updatedAt = iso(ctx.now);
      if (changesAccess) revokeSessions(ctx.db, admin.id);
      return json({ admin: adminView(ctx.db, admin, false) });
    },
  );

  router.post(
    `${users}/:id/reset-password`,
    { permission: "admin_users.manage" },
    async (ctx) => {
      const input = await ctx.body(z.strictObject({ temporaryPassword }));
      const admin = adminById(ctx.db, ctx.params.id ?? "");
      admin.password = input.temporaryPassword;
      admin.mustChangePassword = true;
      admin.failedLogins = 0;
      admin.lockedUntil = null;
      admin.updatedAt = iso(ctx.now);
      revokeSessions(ctx.db, admin.id);
      return noContent();
    },
  );

  router.post(
    `${users}/:id/reset-mfa`,
    { permission: "admin_users.manage" },
    (ctx) => {
      const admin = adminById(ctx.db, ctx.params.id ?? "");
      admin.totpSecret = null;
      admin.pendingTotpSecret = null;
      admin.lastTotpStep = null;
      admin.updatedAt = iso(ctx.now);
      revokeSessions(ctx.db, admin.id);
      return noContent();
    },
  );

  // --- Roles ----------------------------------------------------------------
  const roles = "/v1/admin/roles";

  router.get(roles, { permission: "roles.read" }, (ctx) =>
    json({
      items: [...ctx.db.roles].sort((a, b) => a.key.localeCompare(b.key)),
    }),
  );

  router.get(`${roles}/permissions`, { permission: "roles.read" }, () =>
    json({ items: ALL_PERMISSIONS }),
  );

  router.post(roles, { permission: "roles.manage" }, async (ctx) => {
    const input = await ctx.body(createRole);
    assertKnownPermissions(input.permissions);
    if (ctx.db.roles.some((role) => role.key === input.key)) {
      throw fail(409, "ROLE_KEY_TAKEN", "A role with this key exists already.");
    }
    const role: Role = {
      id: newId(ctx.now),
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      permissions: [...new Set(input.permissions)],
      isSystem: false,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.roles.push(role);
    return json({ role }, 201);
  });

  router.patch(`${roles}/:id`, { permission: "roles.manage" }, async (ctx) => {
    const input = await ctx.body(updateRole);
    const role = roleById(ctx.db, ctx.params.id ?? "");
    if (role.isSystem) {
      throw fail(
        403,
        "ROLE_IS_SYSTEM",
        "The super admin role cannot be edited.",
      );
    }
    if (input.permissions !== undefined) {
      assertKnownPermissions(input.permissions);
      role.permissions = [...new Set(input.permissions)];
      // A changed role signs its admins out everywhere (0.3).
      for (const admin of ctx.db.admins) {
        if (admin.roleId === role.id && admin.id !== ctx.admin.id) {
          revokeSessions(ctx.db, admin.id);
        }
      }
    }
    if (input.name !== undefined) role.name = input.name;
    if (input.description !== undefined) role.description = input.description;
    role.updatedAt = iso(ctx.now);
    return json({ role });
  });

  router.delete(`${roles}/:id`, { permission: "roles.manage" }, (ctx) => {
    const role = roleById(ctx.db, ctx.params.id ?? "");
    if (role.isSystem) {
      throw fail(
        403,
        "ROLE_IS_SYSTEM",
        "The super admin role cannot be deleted.",
      );
    }
    if (ctx.db.admins.some((admin) => admin.roleId === role.id)) {
      throw fail(409, "ROLE_IN_USE", "The role is still assigned to an admin.");
    }
    ctx.db.roles = ctx.db.roles.filter((entry) => entry.id !== role.id);
    return noContent();
  });
}
