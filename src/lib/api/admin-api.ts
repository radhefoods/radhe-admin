import { adminUsersApi, authApi, rolesApi } from "./endpoints/auth";
import { bannersApi } from "./endpoints/banners";
import {
  catalogSheetsApi,
  categoriesApi,
  productsApi,
} from "./endpoints/catalog";
import { announcementsApi, notificationsApi } from "./endpoints/communication";
import {
  attentionApi,
  invoicesApi,
  ordersApi,
  refundsApi,
  returnsApi,
} from "./endpoints/orders";
import { customersApi, legalApi, settingsApi } from "./endpoints/shop";
import type { SessionTransport } from "./session";

/**
 * One definition of every endpoint the panel uses, grouped like the API
 * documentation. Nothing else in the panel builds a URL of the API.
 */
export function createAdminApi(transport: SessionTransport) {
  return {
    auth: authApi(transport),
    adminUsers: adminUsersApi(transport),
    roles: rolesApi(transport),
    customers: customersApi(transport),
    settings: settingsApi(transport),
    legal: legalApi(transport),
    categories: categoriesApi(transport),
    products: productsApi(transport),
    catalogSheets: catalogSheetsApi(transport),
    orders: ordersApi(transport),
    returns: returnsApi(transport),
    refunds: refundsApi(transport),
    invoices: invoicesApi(transport),
    notifications: notificationsApi(transport),
    announcements: announcementsApi(transport),
    attention: attentionApi(transport),
    banners: bannersApi(transport),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
