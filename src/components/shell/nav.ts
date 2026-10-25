import {
  Bell,
  BookOpenText,
  CircleHelp,
  CreditCard,
  FileText,
  FolderTree,
  GalleryHorizontal,
  HandCoins,
  KeyRound,
  Megaphone,
  Newspaper,
  ReceiptText,
  ScrollText,
  Settings,
  ShoppingBag,
  Sun,
  Tags,
  Undo2,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import type { Attention } from "@/lib/api/types";
import type { Permission } from "@/lib/auth/permissions";
import { routes } from "@/lib/routes";
import type { Tone } from "@/lib/status";

export interface NavItem {
  label: string;
  href: Route;
  icon: LucideIcon;
  /** Hidden without this permission. `null`: every admin sees it. */
  requires: Permission | null;
  /** Addresses that belong to another entry although they start the same. */
  except?: readonly string[];
  /** What waits here, from the attention overview. */
  count?: (attention: Attention) => { count: number; tone: Tone };
  /** Words the search finds this page by. */
  keywords?: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * The navigation, grouped by workflow. An entry is shown only to an admin
 * who may read what is behind it; the API enforces it anyway.
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: null,
    items: [
      {
        label: "Today",
        href: routes.today,
        icon: Sun,
        requires: null,
        keywords: "dashboard start attention overview home",
      },
    ],
  },
  {
    label: "Orders",
    items: [
      {
        label: "Orders",
        href: routes.orders,
        icon: ShoppingBag,
        requires: "orders.read",
        count: (a) => ({ count: a.orders.toProcess, tone: "attention" }),
        keywords: "paid processing dispatch tracking delivery",
      },
      {
        label: "Returns",
        href: routes.returns,
        icon: Undo2,
        requires: "orders.read",
        count: (a) => ({ count: a.returns.requested, tone: "attention" }),
        keywords: "send back credit",
      },
    ],
  },
  {
    label: "Wholesale",
    items: [
      {
        label: "Quotations",
        href: routes.quotations,
        icon: FileText,
        requires: "quotations.read",
        count: (a) => ({ count: a.quotations.new, tone: "attention" }),
        keywords: "b2b wholesale business cartons prices quote request pdf",
      },
    ],
  },
  {
    label: "Payments",
    items: [
      {
        label: "Payments",
        href: routes.payments,
        icon: CreditCard,
        requires: "payments.read",
        except: [routes.refunds, routes.invoices],
        count: (a) => ({ count: a.refunds.needed, tone: "attention" }),
        keywords: "stripe card paypal paid failed waiting refund",
      },
      {
        label: "Refunds",
        href: routes.refunds,
        icon: HandCoins,
        requires: "payments.read",
        count: (a) =>
          a.refunds.failed > 0
            ? { count: a.refunds.failed + a.refunds.pending, tone: "danger" }
            : { count: a.refunds.pending, tone: "attention" },
        keywords: "money back stripe bank transfer",
      },
      {
        label: "Invoices",
        href: routes.invoices,
        icon: ReceiptText,
        requires: "payments.read",
        keywords: "credit notes pdf documents",
      },
    ],
  },
  {
    label: "Customers",
    items: [
      {
        label: "Customers",
        href: routes.customers,
        icon: Users,
        requires: "customers.read",
        keywords: "accounts blocked",
      },
    ],
  },
  {
    label: "Catalogue",
    items: [
      {
        label: "Products",
        href: routes.products,
        icon: Tags,
        requires: "catalog.read",
        keywords: "sku pack sizes prices stock images vat",
      },
      {
        label: "Categories",
        href: routes.categories,
        icon: FolderTree,
        requires: "catalog.read",
        keywords: "tree groups",
      },
      {
        label: "Banners",
        href: routes.banners,
        icon: GalleryHorizontal,
        requires: "catalog.read",
        keywords: "homepage hero carousel slides promotion offer pictures",
      },
    ],
  },
  {
    label: "Content",
    items: [
      {
        label: "Blog",
        href: routes.blog,
        icon: Newspaper,
        requires: "content.read",
        except: [routes.blogCategories],
        keywords: "posts articles recipes news publish schedule markdown",
      },
      {
        label: "Blog categories",
        href: routes.blogCategories,
        icon: BookOpenText,
        requires: "content.read",
        keywords: "blog sections order",
      },
      {
        label: "FAQ",
        href: routes.faq,
        icon: CircleHelp,
        requires: "content.read",
        keywords: "questions answers help groups published",
      },
    ],
  },
  {
    label: "Communication",
    items: [
      {
        label: "Notifications",
        href: routes.notifications,
        icon: Bell,
        requires: "notifications.read",
        count: (a) => ({ count: a.notifications.failed, tone: "danger" }),
        keywords: "emails whatsapp messages log failed retry",
      },
      {
        label: "Announcements",
        href: routes.announcements,
        icon: Megaphone,
        requires: "notifications.read",
        keywords: "news notify customers marketing",
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        label: "Shop settings",
        href: routes.settings,
        icon: Settings,
        requires: "settings.read",
        except: [routes.legal, routes.team, routes.roles],
        keywords: "company delivery fee estimate returns payment page",
      },
      {
        label: "Legal texts",
        href: routes.legal,
        icon: ScrollText,
        requires: "legal.read",
        keywords: "terms privacy versions publish",
      },
      {
        label: "Team",
        href: routes.team,
        icon: UserCog,
        requires: "admin_users.read",
        keywords: "admin users invite password authenticator",
      },
      {
        label: "Roles",
        href: routes.roles,
        icon: KeyRound,
        requires: "roles.read",
        keywords: "permissions rbac access",
      },
    ],
  },
];

/** Whether an address belongs to a navigation entry. */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  const inside = pathname === item.href || pathname.startsWith(`${item.href}/`);
  if (!inside) return false;
  return !(item.except ?? []).some(
    (other) => pathname === other || pathname.startsWith(`${other}/`),
  );
}

/** The entries an admin may see, without groups that are empty for them. */
export function visibleNavigation(
  can: (permission: string) => boolean,
): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.requires === null || can(item.requires),
    ),
  })).filter((group) => group.items.length > 0);
}
