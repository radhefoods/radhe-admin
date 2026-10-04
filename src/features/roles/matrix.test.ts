import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "../../../mocks/seed.ts";
import {
  EMPTY_MATRIX,
  ROLE_KEY,
  buildCatalogue,
  cellState,
  defaultCatalogue,
  expandWildcard,
  fromMatrix,
  keyFromName,
  manageWithoutRead,
  permissionChange,
  samePermissions,
  setColumn,
  setPermission,
  summarizeAccess,
  toMatrix,
} from "./matrix";

// The list of `GET /roles/permissions`, in the API's order.
const catalogue = buildCatalogue(ALL_PERMISSIONS);

describe("the rows of the matrix", () => {
  it("has one row per resource, in the order of the navigation, with both columns", () => {
    expect(catalogue.rows.map((row) => row.resource)).toEqual([
      "orders",
      "cargos",
      "payments",
      "customers",
      "catalog",
      "notifications",
      "settings",
      "legal",
      "admin_users",
      "roles",
    ]);
    expect(catalogue.rows[0]).toEqual({
      resource: "orders",
      label: "Orders",
      covers:
        "Orders, returns, bulk order actions per cargo, the Today overview",
      read: "orders.read",
      manage: "orders.manage",
    });
    expect(catalogue.other).toEqual([]);
  });

  it("is the same as the documented list when the API cannot be asked", () => {
    expect([...defaultCatalogue().permissions].sort()).toEqual(
      [...ALL_PERMISSIONS].sort(),
    );
  });

  it("takes in what a newer API offers", () => {
    const newer = buildCatalogue([
      ...ALL_PERMISSIONS,
      "reports.read",
      "orders.export",
    ]);
    const reports = newer.rows[newer.rows.length - 1];
    expect(reports).toEqual({
      resource: "reports",
      label: "Reports",
      covers: null,
      read: "reports.read",
      manage: null,
    });
    expect(newer.other).toEqual(["orders.export"]);
  });
});

describe("a permission list as a matrix, and back", () => {
  it("round-trips single permissions in the API's order", () => {
    const permissions = ["orders.manage", "cargos.read", "orders.read"];
    const state = toMatrix(permissions, catalogue);
    expect(state).toEqual({
      all: false,
      wildcards: [],
      granted: ["orders.manage", "cargos.read", "orders.read"],
      unknown: [],
    });
    expect(fromMatrix(state, catalogue)).toEqual([
      "cargos.read",
      "orders.read",
      "orders.manage",
    ]);
    expect(samePermissions(fromMatrix(state, catalogue), permissions)).toBe(
      true,
    );
  });

  it("keeps read and manage independent", () => {
    const state = toMatrix(["orders.manage"], catalogue);
    expect(cellState(state, "orders.manage")).toEqual({
      checked: true,
      lockedBy: null,
    });
    expect(cellState(state, "orders.read")).toEqual({
      checked: false,
      lockedBy: null,
    });
    // Ticking manage never ticks read by itself.
    const ticked = setPermission(EMPTY_MATRIX, "payments.manage", true);
    expect(fromMatrix(ticked, catalogue)).toEqual(["payments.manage"]);
  });

  it("shows `*` as everything and keeps it", () => {
    const state = toMatrix(["*"], catalogue);
    expect(state.all).toBe(true);
    for (const permission of ALL_PERMISSIONS) {
      expect(cellState(state, permission)).toEqual({
        checked: true,
        lockedBy: "*",
      });
    }
    expect(fromMatrix(state, catalogue)).toEqual(["*"]);
    // What the wildcard grants cannot be unticked on its own.
    expect(setPermission(state, "orders.read", false)).toBe(state);
  });

  it("shows a resource wildcard as such and keeps it", () => {
    const permissions = ["orders.*", "cargos.read"];
    const state = toMatrix(permissions, catalogue);
    expect(state.wildcards).toEqual(["orders"]);
    expect(cellState(state, "orders.read")).toEqual({
      checked: true,
      lockedBy: "orders.*",
    });
    expect(cellState(state, "orders.manage")).toEqual({
      checked: true,
      lockedBy: "orders.*",
    });
    expect(cellState(state, "cargos.read")).toEqual({
      checked: true,
      lockedBy: null,
    });
    expect(cellState(state, "cargos.manage")).toEqual({
      checked: false,
      lockedBy: null,
    });

    const edited = setPermission(
      setPermission(state, "payments.read", true),
      "orders.read",
      false,
    );
    expect(fromMatrix(edited, catalogue)).toEqual([
      "orders.*",
      "cargos.read",
      "payments.read",
    ]);
  });

  it("keeps single permissions that a wildcard covers, and ones the API does not list", () => {
    const permissions = ["orders.*", "orders.read", "reports.read", "*"];
    const state = toMatrix(permissions, catalogue);
    expect(state.unknown).toEqual(["reports.read"]);
    expect(samePermissions(fromMatrix(state, catalogue), permissions)).toBe(
      true,
    );
  });

  it("drops duplicates", () => {
    expect(
      fromMatrix(
        toMatrix(["orders.read", "orders.read"], catalogue),
        catalogue,
      ),
    ).toEqual(["orders.read"]);
  });

  it("ticks and unticks a whole column without touching wildcards", () => {
    const state = toMatrix(["orders.*"], catalogue);
    const all = setColumn(state, catalogue, "read", true);
    expect(all.wildcards).toEqual(["orders"]);
    expect(fromMatrix(all, catalogue)).toEqual([
      "orders.*",
      ...ALL_PERMISSIONS.filter(
        (permission) =>
          permission.endsWith(".read") && permission !== "orders.read",
      ),
    ]);
    expect(
      fromMatrix(setColumn(all, catalogue, "read", false), catalogue),
    ).toEqual(["orders.*"]);
  });

  it("replaces a wildcard by the single permissions it stands for, on request", () => {
    const resource = expandWildcard(
      toMatrix(["orders.*"], catalogue),
      catalogue,
      "orders.*",
    );
    expect(fromMatrix(resource, catalogue)).toEqual([
      "orders.read",
      "orders.manage",
    ]);
    expect(cellState(resource, "orders.read")).toEqual({
      checked: true,
      lockedBy: null,
    });

    const everything = expandWildcard(
      toMatrix(["*"], catalogue),
      catalogue,
      "*",
    );
    expect(everything.all).toBe(false);
    expect(fromMatrix(everything, catalogue)).toEqual(ALL_PERMISSIONS);
  });
});

describe("what a role allows", () => {
  it("warns about manage without read", () => {
    const blind = manageWithoutRead(
      toMatrix(
        ["orders.manage", "cargos.read", "cargos.manage", "payments.read"],
        catalogue,
      ),
      catalogue,
    );
    expect(blind.map((row) => row.resource)).toEqual(["orders"]);
    expect(
      manageWithoutRead(toMatrix(["orders.*"], catalogue), catalogue),
    ).toEqual([]);
    expect(manageWithoutRead(toMatrix(["*"], catalogue), catalogue)).toEqual(
      [],
    );
  });

  it("summarizes a role in words", () => {
    expect(
      summarizeAccess(
        ["orders.read", "orders.manage", "cargos.read", "payments.manage"],
        catalogue,
      ),
    ).toEqual({
      everything: false,
      granted: 4,
      total: 20,
      manages: ["Orders"],
      readsOnly: ["Cargos"],
      managesBlind: ["Payments"],
    });
    const superAdmin = summarizeAccess(["*"], catalogue);
    expect(superAdmin.everything).toBe(true);
    expect(superAdmin.granted).toBe(20);
    expect(summarizeAccess(["orders.*"], catalogue).manages).toEqual([
      "Orders",
    ]);
  });

  it("compares permission lists as sets", () => {
    expect(samePermissions(["a", "b"], ["b", "a", "a"])).toBe(true);
    expect(samePermissions(["a"], ["a", "b"])).toBe(false);
    expect(permissionChange(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });
});

describe("the key of a new role", () => {
  it("is proposed from the name", () => {
    expect(keyFromName("Order manager")).toBe("order_manager");
    expect(keyFromName("  Lager & Versand (früh) ")).toBe("lager_versand_fruh");
    expect(keyFromName("2nd shift")).toBe("nd_shift");
    expect(keyFromName("x".repeat(60))).toHaveLength(41);
  });

  it("follows the rule of the API", () => {
    expect(ROLE_KEY.test("order_manager")).toBe(true);
    expect(ROLE_KEY.test("ab")).toBe(false);
    expect(ROLE_KEY.test("Order")).toBe(false);
    expect(ROLE_KEY.test("1order")).toBe(false);
    expect(ROLE_KEY.test(`a${"b".repeat(40)}`)).toBe(true);
    expect(ROLE_KEY.test(`a${"b".repeat(41)}`)).toBe(false);
  });
});
