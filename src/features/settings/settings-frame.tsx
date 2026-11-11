"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { tabClass } from "@/components/ui/controls";
import { Alert, Skeleton } from "@/components/ui/surface";
import { describeError } from "@/lib/api/error-text";
import type { CompanyMissingField, Settings } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { useSettings } from "./queries";

/**
 * The sections of the shop settings, each with the permission that opens
 * it. Most are groups of `GET /settings` (5) and need `settings.read`;
 * "Order costs" belongs to costs and profit (32) and needs `finance.read`.
 */
export const SETTINGS_SECTIONS: {
  href: Route;
  label: string;
  requires: Permission;
}[] = [
  { href: routes.settingsCompany, label: "Company", requires: "settings.read" },
  {
    href: routes.settingsDeliveryFee,
    label: "Delivery fee",
    requires: "settings.read",
  },
  {
    href: routes.settingsOrderCosts,
    label: "Order costs",
    requires: "finance.read",
  },
  {
    href: routes.settingsOrders,
    label: "Orders and returns",
    requires: "settings.read",
  },
  {
    href: routes.settingsPayments,
    label: "Payments",
    requires: "settings.read",
  },
];

/** The first section an admin may open, or `null` when there is none. */
export function firstSettingsSection(
  can: (permission: string) => boolean,
): Route | null {
  return (
    SETTINGS_SECTIONS.find((section) => can(section.requires))?.href ?? null
  );
}

/** What the API names as missing for invoices, in the admin's words. */
export const MISSING_LABEL: Record<CompanyMissingField, string> = {
  name: "the company name",
  addressLines: "the address",
  email: "the email address",
  "vatId or taxNumber": "a VAT id or a tax number",
};

export function missingForInvoicesText(missing: readonly string[]): string {
  const names = missing.map(
    (field) => MISSING_LABEL[field as CompanyMissingField] ?? field,
  );
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The frame of the shop settings: one header, the sections as tabs, and
 * the warning that stays until invoices can be issued. Each section is its
 * own page with its own form, because each `PUT` replaces one group. A tab
 * is shown with the permission of its section, and the frame opens for an
 * admin who may open at least one of them.
 */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const can = useCan();
  const settings = useSettings();
  const missing = settings.data?.company.missingForInvoices ?? [];
  const sections = SETTINGS_SECTIONS.filter((section) => can(section.requires));
  const current = SETTINGS_SECTIONS.find(
    (section) => section.href === pathname,
  );
  /** What the page of this address needs; the groups of `GET /settings` by default. */
  const needs: Permission = current?.requires ?? "settings.read";

  // Nothing of the settings is open to this role: say which permission is missing.
  if (sections.length === 0) {
    return (
      <RequirePermission permission="settings.read">{null}</RequirePermission>
    );
  }

  let body: ReactNode;
  if (!can(needs)) {
    // Another section is open to this role, this one is not.
    body = <RequirePermission permission={needs}>{null}</RequirePermission>;
  } else if (needs !== "settings.read") {
    // A section that does not live in `GET /settings` loads what it shows itself.
    body = children;
  } else if (settings.data) {
    body = (
      <>
        {missing.length > 0 ? (
          <Alert
            tone="warning"
            title="Invoices cannot be issued yet"
            actions={
              pathname === routes.settingsCompany ? null : (
                <Button asChild size="sm">
                  <Link href={routes.settingsCompany}>
                    Complete the company details
                  </Link>
                </Button>
              )
            }
          >
            The invoice is issued the moment an order is paid, so nothing can be
            sold until the company details are complete. Still missing:{" "}
            {missingForInvoicesText(missing)}.
          </Alert>
        ) : null}
        {children}
      </>
    );
  } else if (settings.isError) {
    const notice = describeError(settings.error);
    body = (
      <Alert
        tone="danger"
        title="The settings could not be loaded"
        actions={
          <Button onClick={() => void settings.refetch()}>Try again</Button>
        }
      >
        {notice.message}
        {notice.requestId ? (
          <span className="mt-1 block font-mono text-2xs break-all">
            {notice.technical} · Request {notice.requestId}
          </span>
        ) : null}
      </Alert>
    );
  } else {
    body = (
      <div className="flex max-w-3xl flex-col gap-4" aria-busy="true">
        <span className="sr-only" role="status">
          Loading the settings
        </span>
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Shop settings"
        description="The business rules of the shop. Each section is saved by itself and applies at once."
        className="pb-3"
      />
      <nav
        aria-label="Sections of the shop settings"
        className={cn(
          gutter,
          "no-scrollbar flex gap-5 overflow-x-auto border-b border-line",
        )}
      >
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            aria-current={pathname === section.href ? "page" : undefined}
            className={tabClass}
          >
            {section.label}
            {section.href === routes.settingsCompany && missing.length > 0 ? (
              <span className="flex items-center">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-attention-dot"
                />
                <span className="sr-only">(incomplete)</span>
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
      <div className={cn(gutter, "flex flex-col gap-6 pt-6 pb-12")}>{body}</div>
    </>
  );
}

/** The settings of the page. The frame has loaded them already. */
export function useCurrentSettings(): Settings | undefined {
  return useSettings().data;
}
