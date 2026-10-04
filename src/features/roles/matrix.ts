import {
  RESOURCES,
  RESOURCE_LABELS,
  WILDCARD,
  hasPermission,
  type Resource,
} from "@/lib/auth/permissions";
import { humanize } from "@/lib/status";

// A role is a list of permission strings (documentation, 0.5 and 3):
// `<resource>.read`, `<resource>.manage`, and the wildcards `*` and
// `<resource>.*`. The editor shows the list as a matrix, one row per
// resource, and turns the matrix back into a list. `read` and `manage` are
// independent; wildcards a role contains are kept as they are.

export type MatrixAction = "read" | "manage";
export const MATRIX_ACTIONS: readonly MatrixAction[] = ["read", "manage"];

export interface CatalogueRow {
  resource: string;
  label: string;
  /** What the resource covers; `null` for one the panel does not know yet. */
  covers: string | null;
  /** The permission of each column, when the API offers it. */
  read: string | null;
  manage: string | null;
}

export interface Catalogue {
  /** Every permission the API lists (`GET /roles/permissions`). */
  permissions: readonly string[];
  rows: CatalogueRow[];
  /** Listed permissions that are neither `read` nor `manage` of a resource. */
  other: string[];
}

function split(permission: string): { resource: string; action: string } {
  const dot = permission.indexOf(".");
  return dot === -1
    ? { resource: permission, action: "" }
    : { resource: permission.slice(0, dot), action: permission.slice(dot + 1) };
}

export function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource as Resource]?.label ?? humanize(resource);
}

/**
 * The rows of the matrix from what the API offers: the resources the panel
 * knows in the order of the navigation, then any the API added since.
 */
export function buildCatalogue(permissions: readonly string[]): Catalogue {
  const byResource = new Map<
    string,
    { read: string | null; manage: string | null }
  >();
  const other: string[] = [];
  for (const permission of permissions) {
    const { resource, action } = split(permission);
    if (action !== "read" && action !== "manage") {
      other.push(permission);
      continue;
    }
    const row = byResource.get(resource) ?? { read: null, manage: null };
    row[action] = permission;
    byResource.set(resource, row);
  }
  const known = (RESOURCES as readonly string[]).filter((resource) =>
    byResource.has(resource),
  );
  const added = [...byResource.keys()].filter(
    (resource) => !known.includes(resource),
  );
  return {
    permissions,
    rows: [...known, ...added].map((resource) => ({
      resource,
      label: resourceLabel(resource),
      covers: RESOURCE_LABELS[resource as Resource]?.covers ?? null,
      ...(byResource.get(resource) as {
        read: string | null;
        manage: string | null;
      }),
    })),
    other,
  };
}

/** The catalogue as the documentation lists it, when the API cannot be asked. */
export function defaultCatalogue(): Catalogue {
  return buildCatalogue(
    RESOURCES.flatMap((resource) => [`${resource}.read`, `${resource}.manage`]),
  );
}

export interface MatrixState {
  /** The role contains `*`: everything, also what is added later. */
  all: boolean;
  /** Resources the role holds as `<resource>.*`. */
  wildcards: string[];
  /** The single permissions that are ticked. */
  granted: string[];
  /** Permissions of the role the API does not list: kept as they are. */
  unknown: string[];
}

export const EMPTY_MATRIX: MatrixState = {
  all: false,
  wildcards: [],
  granted: [],
  unknown: [],
};

export function toMatrix(
  permissions: readonly string[],
  catalogue: Catalogue,
): MatrixState {
  const state: MatrixState = {
    all: false,
    wildcards: [],
    granted: [],
    unknown: [],
  };
  for (const permission of new Set(permissions)) {
    if (permission === WILDCARD) state.all = true;
    else if (permission.endsWith(".*"))
      state.wildcards.push(permission.slice(0, -2));
    else if (catalogue.permissions.includes(permission))
      state.granted.push(permission);
    else state.unknown.push(permission);
  }
  return state;
}

/** The list the API gets: wildcards first, then the single permissions as the API orders them. */
export function fromMatrix(state: MatrixState, catalogue: Catalogue): string[] {
  return [
    ...(state.all ? [WILDCARD] : []),
    ...state.wildcards.map((resource) => `${resource}.*`),
    ...catalogue.permissions.filter((permission) =>
      state.granted.includes(permission),
    ),
    ...state.unknown,
  ];
}

export interface CellState {
  checked: boolean;
  /** The wildcard that grants the cell; it cannot be unticked on its own. */
  lockedBy: string | null;
}

export function cellState(state: MatrixState, permission: string): CellState {
  if (state.all) return { checked: true, lockedBy: WILDCARD };
  const { resource } = split(permission);
  if (state.wildcards.includes(resource))
    return { checked: true, lockedBy: `${resource}.*` };
  return { checked: state.granted.includes(permission), lockedBy: null };
}

export function setPermission(
  state: MatrixState,
  permission: string,
  checked: boolean,
): MatrixState {
  if (cellState(state, permission).lockedBy) return state;
  const granted = state.granted.filter((entry) => entry !== permission);
  return { ...state, granted: checked ? [...granted, permission] : granted };
}

/** Ticks or unticks a whole column, leaving alone what a wildcard grants. */
export function setColumn(
  state: MatrixState,
  catalogue: Catalogue,
  action: MatrixAction,
  checked: boolean,
): MatrixState {
  let next = state;
  for (const row of catalogue.rows) {
    const permission = row[action];
    if (permission) next = setPermission(next, permission, checked);
  }
  return next;
}

/**
 * Replaces a wildcard by the single permissions it stands for today, so
 * that they can be unticked one by one. `*` becomes every listed
 * permission; `orders.*` becomes the listed permissions of orders.
 */
export function expandWildcard(
  state: MatrixState,
  catalogue: Catalogue,
  wildcard: string,
): MatrixState {
  const covered =
    wildcard === WILDCARD
      ? catalogue.permissions
      : catalogue.permissions.filter(
          (permission) => split(permission).resource === wildcard.slice(0, -2),
        );
  const granted = [...new Set([...state.granted, ...covered])];
  return wildcard === WILDCARD
    ? { ...state, all: false, granted }
    : {
        ...state,
        wildcards: state.wildcards.filter(
          (resource) => `${resource}.*` !== wildcard,
        ),
        granted,
      };
}

/**
 * Rows that have manage without read. The API accepts it, but the pages
 * of the panel need read: such a role could change what it cannot open.
 */
export function manageWithoutRead(
  state: MatrixState,
  catalogue: Catalogue,
): CatalogueRow[] {
  return catalogue.rows.filter(
    (row) =>
      row.read !== null &&
      row.manage !== null &&
      cellState(state, row.manage).checked &&
      !cellState(state, row.read).checked,
  );
}

/** Whether two permission lists grant the same, whatever their order. */
export function samePermissions(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

export interface PermissionChange {
  added: string[];
  removed: string[];
}

export function permissionChange(
  before: readonly string[],
  after: readonly string[],
): PermissionChange {
  return {
    added: after.filter((permission) => !before.includes(permission)),
    removed: before.filter((permission) => !after.includes(permission)),
  };
}

export interface AccessSummary {
  /** `*`: everything, also what is added later. */
  everything: boolean;
  /** How many of the listed permissions the role grants. */
  granted: number;
  total: number;
  /** Labels of the resources by what the role may do with them. */
  manages: string[];
  readsOnly: string[];
  /** Manage without read: the pages cannot be opened. */
  managesBlind: string[];
}

/** What a list of permissions allows, in words, for the role list and the profile. */
export function summarizeAccess(
  permissions: readonly string[],
  catalogue: Catalogue = defaultCatalogue(),
): AccessSummary {
  const summary: AccessSummary = {
    everything: permissions.includes(WILDCARD),
    granted: catalogue.permissions.filter((permission) =>
      hasPermission(permissions, permission),
    ).length,
    total: catalogue.permissions.length,
    manages: [],
    readsOnly: [],
    managesBlind: [],
  };
  for (const row of catalogue.rows) {
    const read = row.read !== null && hasPermission(permissions, row.read);
    const manage =
      row.manage !== null && hasPermission(permissions, row.manage);
    if (read && manage) summary.manages.push(row.label);
    else if (read) summary.readsOnly.push(row.label);
    else if (manage) summary.managesBlind.push(row.label);
  }
  return summary;
}

/** `Order manager` becomes `order_manager`: a proposal for the key of a new role. */
export function keyFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 41);
}

export const ROLE_KEY = /^[a-z][a-z0-9_]{2,40}$/;
