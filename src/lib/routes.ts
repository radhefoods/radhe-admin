import type { Route } from "next";
import type { Id } from "@/lib/api/types";

/**
 * Every address of the panel, in one place. Links are checked against the
 * routes that exist (`typedRoutes`), so a page that is renamed breaks the
 * build here and nowhere else.
 */
export const routes = {
  signIn: "/sign-in" as Route,
  changePassword: "/change-password" as Route,
  today: "/" as Route,
  profile: "/profile" as Route,

  orders: "/orders" as Route,
  order: (id: Id) => `/orders/${id}` as Route,
  returns: "/returns" as Route,
  return: (id: Id) => `/returns/${id}` as Route,

  payments: "/payments" as Route,
  refunds: "/payments/refunds" as Route,
  refund: (id: Id) => `/payments/refunds/${id}` as Route,
  invoices: "/payments/invoices" as Route,
  invoice: (id: Id) => `/payments/invoices/${id}` as Route,

  customers: "/customers" as Route,
  customer: (id: Id) => `/customers/${id}` as Route,

  products: "/catalogue/products" as Route,
  productNew: "/catalogue/products/new" as Route,
  product: (id: Id) => `/catalogue/products/${id}` as Route,
  categories: "/catalogue/categories" as Route,
  /** The display order of the products of a category. */
  categoryProducts: (id: Id) => `/catalogue/categories/${id}/products` as Route,
  banners: "/catalogue/banners" as Route,

  /** The start page with its Analytics tab open. */
  analytics: "/?tab=analytics" as Route,

  faq: "/content/faq" as Route,
  blog: "/content/blog" as Route,
  blogPostNew: "/content/blog/new" as Route,
  blogPost: (id: Id) => `/content/blog/${id}` as Route,
  blogCategories: "/content/blog/categories" as Route,

  notifications: "/communication/notifications" as Route,
  notification: (id: Id) => `/communication/notifications/${id}` as Route,
  announcements: "/communication/announcements" as Route,
  announcementNew: "/communication/announcements/new" as Route,
  announcement: (id: Id) => `/communication/announcements/${id}` as Route,

  settings: "/settings" as Route,
  settingsCompany: "/settings/company" as Route,
  settingsDeliveryFee: "/settings/delivery-fee" as Route,
  settingsOrders: "/settings/orders" as Route,
  settingsPayments: "/settings/payments" as Route,
  legal: "/settings/legal" as Route,
  legalDocument: (id: Id) => `/settings/legal/${id}` as Route,
  team: "/settings/team" as Route,
  roles: "/settings/roles" as Route,

  styleguide: "/styleguide" as Route,
} as const;

/** An address with query parameters; empty values are left out. */
export function withQuery(
  path: Route,
  query: Record<string, string | number | boolean | null | undefined>,
): Route {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return (search ? `${path}?${search}` : path) as Route;
}

/**
 * Where to go after signing in. Only an address inside the panel is
 * accepted: a link from outside can never send the admin elsewhere.
 */
export function safeReturnTo(value: string | null | undefined): Route {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return routes.today;
  }
  if (value.includes("\\") || value.startsWith("/sign-in")) return routes.today;
  return value as Route;
}
