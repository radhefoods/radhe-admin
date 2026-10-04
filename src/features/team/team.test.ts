import { describe, expect, it } from "vitest";
import type { AdminWithRole } from "@/lib/api/types";
import {
  accessLock,
  changesAccess,
  firstName,
  isLastActiveSuperAdmin,
  roleChoicesInUse,
  toAdminPatch,
} from "./team";
import { temporaryPasswordProblem } from "./temporary-password";

const SUPER = { key: "super_admin", name: "Super Admin", permissions: ["*"] };
const ORDERS = {
  key: "order_manager",
  name: "Order manager",
  permissions: ["orders.read"],
};

const admin = (
  id: string,
  role: AdminWithRole["role"],
  status: AdminWithRole["status"] = "active",
): AdminWithRole => ({
  id,
  email: `${id}@radhefoods.de`,
  name: `Admin ${id}`,
  status,
  roleId: `role-${role.key}`,
  role,
  mfaEnabled: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
});

describe("who may be changed", () => {
  const owner = admin("owner", SUPER);
  const second = admin("second", SUPER);
  const former = admin("former", SUPER, "disabled");
  const nisha = admin("nisha", ORDERS);

  it("locks the role and status of the signed-in admin", () => {
    expect(accessLock(nisha, "nisha", [owner, nisha])).toMatch(
      /You cannot change your own role or status/,
    );
    expect(accessLock(nisha, "owner", [owner, nisha])).toBeNull();
  });

  it("keeps the last active super admin", () => {
    expect(isLastActiveSuperAdmin(owner, [owner, nisha])).toBe(true);
    // A disabled super admin does not count as a second one.
    expect(isLastActiveSuperAdmin(owner, [owner, former, nisha])).toBe(true);
    expect(isLastActiveSuperAdmin(owner, [owner, second])).toBe(false);
    expect(isLastActiveSuperAdmin(nisha, [owner, nisha])).toBe(false);
    expect(isLastActiveSuperAdmin(former, [owner, former])).toBe(false);
    expect(accessLock(owner, "second-admin", [owner, nisha])).toMatch(
      /only active super admin/,
    );
    expect(accessLock(owner, "second", [owner, second])).toBeNull();
  });
});

describe("what an edit sends", () => {
  const nisha = admin("nisha", ORDERS);

  it("sends only what changed", () => {
    expect(
      toAdminPatch(
        { name: nisha.name, roleId: nisha.roleId, active: true },
        nisha,
      ),
    ).toEqual({});
    expect(
      toAdminPatch(
        { name: "Nisha P.", roleId: nisha.roleId, active: true },
        nisha,
      ),
    ).toEqual({ name: "Nisha P." });
    expect(
      toAdminPatch(
        { name: nisha.name, roleId: "role-viewer", active: false },
        nisha,
      ),
    ).toEqual({ roleId: "role-viewer", status: "disabled" });
    expect(
      toAdminPatch(
        { name: nisha.name, roleId: nisha.roleId, active: true },
        { ...nisha, status: "disabled" },
      ),
    ).toEqual({ status: "active" });
  });

  it("knows which changes sign the admin out everywhere", () => {
    expect(changesAccess({ name: "New name" })).toBe(false);
    expect(changesAccess({ roleId: "role-viewer" })).toBe(true);
    expect(changesAccess({ status: "disabled" })).toBe(true);
  });
});

describe("helpers", () => {
  it("lists the roles that are in use when roles cannot be read", () => {
    const choices = roleChoicesInUse([
      admin("a", SUPER),
      admin("b", ORDERS),
      admin("c", ORDERS, "disabled"),
    ]);
    expect(choices).toEqual([
      {
        id: "role-order_manager",
        key: "order_manager",
        name: "Order manager",
        description: null,
      },
      {
        id: "role-super_admin",
        key: "super_admin",
        name: "Super Admin",
        description: null,
      },
    ]);
  });

  it("uses the first name in a sentence", () => {
    expect(firstName("Nisha Patel")).toBe("Nisha");
    expect(firstName("  Tobias  ")).toBe("Tobias");
  });

  it("applies the API's rule for a temporary password", () => {
    expect(temporaryPasswordProblem("short")).toBe("At least 12 characters.");
    expect(temporaryPasswordProblem("x".repeat(129))).toBe(
      "At most 128 characters.",
    );
    expect(temporaryPasswordProblem("temporary-pass-123")).toBeNull();
  });
});
