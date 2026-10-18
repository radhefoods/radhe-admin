import { describe, expect, it } from "vitest";
import {
  NAVIGATION,
  isActive,
  visibleNavigation,
} from "@/components/shell/nav";
import {
  describePermission,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} from "./permissions";

const can = (granted: string[]) => (permission: string) =>
  hasPermission(granted, permission);

describe("hasPermission mirrors the API's rule (0.5)", () => {
  it("matches the exact permission", () => {
    expect(hasPermission(["orders.read"], "orders.read")).toBe(true);
    expect(hasPermission(["orders.read"], "orders.manage")).toBe(false);
  });

  it("keeps read and manage independent", () => {
    // `orders.manage` does not imply `orders.read`.
    expect(hasPermission(["orders.manage"], "orders.read")).toBe(false);
  });

  it("understands the wildcard of the super admin", () => {
    expect(hasPermission(["*"], "roles.manage")).toBe(true);
    expect(hasPermission(["*"], "something.new")).toBe(true);
  });

  it("understands a resource wildcard", () => {
    expect(hasPermission(["orders.*"], "orders.read")).toBe(true);
    expect(hasPermission(["orders.*"], "orders.manage")).toBe(true);
    expect(hasPermission(["orders.*"], "payments.read")).toBe(false);
    // A resource whose name only starts the same is another resource.
    expect(hasPermission(["admin.*"], "admin_users.read")).toBe(false);
  });

  it("grants nothing without a role", () => {
    expect(hasPermission(null, "orders.read")).toBe(false);
    expect(hasPermission([], "orders.read")).toBe(false);
  });

  it("combines permissions", () => {
    const granted = ["orders.read", "payments.read"];
    expect(hasAllPermissions(granted, ["orders.read", "payments.read"])).toBe(
      true,
    );
    expect(hasAllPermissions(granted, ["orders.read", "payments.manage"])).toBe(
      false,
    );
    expect(hasAnyPermission(granted, ["legal.read", "payments.read"])).toBe(
      true,
    );
    expect(hasAnyPermission(granted, ["legal.read"])).toBe(false);
  });

  it("names a permission for a person", () => {
    expect(describePermission("orders.manage")).toBe("Orders: manage");
    expect(describePermission("catalog.read")).toBe("Catalogue: read");
    expect(describePermission("admin_users.manage")).toBe("Team: manage");
    expect(describePermission("orders.*")).toBe("Orders: everything");
    expect(describePermission("*")).toBe("Everything");
  });
});

describe("the navigation follows the permissions", () => {
  const labels = (granted: string[]) =>
    visibleNavigation(can(granted)).flatMap((group) =>
      group.items.map((item) => item.label),
    );

  it("shows everything to the super admin", () => {
    const all = NAVIGATION.flatMap((group) =>
      group.items.map((item) => item.label),
    );
    expect(labels(["*"])).toEqual(all);
  });

  it("shows only what the role may read", () => {
    expect(labels(["catalog.read", "catalog.manage", "legal.read"])).toEqual([
      "Today",
      "Products",
      "Categories",
      "Banners",
      "Legal texts",
    ]);
  });

  it("does not open a page for a manage permission alone", () => {
    expect(labels(["orders.manage"])).toEqual(["Today"]);
  });

  it("drops groups that are empty for the role", () => {
    const groups = visibleNavigation(can(["customers.read"])).map(
      (group) => group.label,
    );
    expect(groups).toEqual([null, "Customers"]);
  });

  it("always shows the start page", () => {
    expect(labels([])).toEqual(["Today"]);
  });
});

describe("the active navigation entry", () => {
  const item = (label: string) => {
    const found = NAVIGATION.flatMap((group) => group.items).find(
      (entry) => entry.label === label,
    );
    if (!found) throw new Error(`No entry ${label}`);
    return found;
  };

  it("marks an entry for its own pages", () => {
    expect(isActive(item("Orders"), "/orders")).toBe(true);
    expect(isActive(item("Orders"), "/orders/66f0a1b2c3d4e5f6a7b8c9d0")).toBe(
      true,
    );
    expect(isActive(item("Orders"), "/orders-archive")).toBe(false);
  });

  it("marks the start page only for itself", () => {
    expect(isActive(item("Today"), "/")).toBe(true);
    expect(isActive(item("Today"), "/orders")).toBe(false);
  });

  it("gives nested sections to their own entry", () => {
    expect(isActive(item("Payments"), "/payments")).toBe(true);
    expect(isActive(item("Payments"), "/payments/refunds")).toBe(false);
    expect(isActive(item("Refunds"), "/payments/refunds/abc")).toBe(true);
    expect(isActive(item("Shop settings"), "/settings/company")).toBe(true);
    expect(isActive(item("Shop settings"), "/settings/legal")).toBe(false);
    expect(isActive(item("Team"), "/settings/team")).toBe(true);
  });
});
