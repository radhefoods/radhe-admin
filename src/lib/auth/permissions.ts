// The permission model of the admin API (documentation, 0.5 and 17.1),
// mirrored exactly: the panel shows what the API would allow, and the API
// enforces it anyway.

export const RESOURCES = [
  "orders",
  "payments",
  "customers",
  "catalog",
  "notifications",
  "settings",
  "legal",
  "admin_users",
  "roles",
] as const;
export type Resource = (typeof RESOURCES)[number];
export type PermissionAction = "read" | "manage";
export type Permission = `${Resource}.${PermissionAction}`;

export const WILDCARD = "*";
export const SUPER_ADMIN_ROLE_KEY = "super_admin";

/** What a resource covers (17.1), for the role editor and the "no access" hints. */
export const RESOURCE_LABELS: Record<
  Resource,
  { label: string; covers: string }
> = {
  orders: {
    label: "Orders",
    covers:
      "Orders and their status, actions on chosen orders, returns, the Today overview",
  },
  payments: {
    label: "Payments",
    covers: "The payment of an order, refunds, invoices and credit notes",
  },
  customers: {
    label: "Customers",
    covers: "Customer accounts and blocking",
  },
  catalog: {
    label: "Catalogue",
    covers: "Categories, products, stock, pictures, import and export",
  },
  notifications: {
    label: "Communication",
    covers: "The log of messages to customers, and announcements",
  },
  settings: {
    label: "Shop settings",
    covers:
      "Company, delivery fee and estimate, order rules, returns, the payment page",
  },
  legal: { label: "Legal texts", covers: "Terms and the privacy policy" },
  admin_users: {
    label: "Team",
    covers: "Admin accounts, password and authenticator resets",
  },
  roles: { label: "Roles", covers: "Roles and their permissions" },
};

/**
 * A granted permission matches when it is the wildcard, the exact string,
 * or a resource wildcard such as `orders.*`. `read` and `manage` are
 * independent: `orders.manage` does not imply `orders.read`.
 */
export function hasPermission(
  granted: readonly string[] | null | undefined,
  required: string,
): boolean {
  if (!granted) return false;
  if (granted.includes(WILDCARD)) return true;
  if (granted.includes(required)) return true;
  const resource = required.split(".")[0];
  return granted.includes(`${resource}.*`);
}

export function hasAllPermissions(
  granted: readonly string[] | null | undefined,
  required: readonly string[],
): boolean {
  return required.every((permission) => hasPermission(granted, permission));
}

export function hasAnyPermission(
  granted: readonly string[] | null | undefined,
  required: readonly string[],
): boolean {
  return required.some((permission) => hasPermission(granted, permission));
}

/** `orders.manage` reads as `Orders: manage`. */
export function describePermission(permission: string): string {
  if (permission === WILDCARD) return "Everything";
  const [resource, action] = permission.split(".");
  const label =
    RESOURCE_LABELS[resource as Resource]?.label ?? resource ?? permission;
  if (action === "*") return `${label}: everything`;
  return `${label}: ${action === "manage" ? "manage" : "read"}`;
}

/** The sentence under a disabled button. */
export function missingPermissionHint(permission: string): string {
  return `Your role does not include "${describePermission(permission)}".`;
}
