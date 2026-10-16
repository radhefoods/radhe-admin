"use client";

import { CircleCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Money } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { useAttention } from "@/components/shell/sidebar";
import { toneClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { useSettings } from "@/features/settings/queries";
import { missingForInvoicesText } from "@/features/settings/settings-frame";
import { errorMessage } from "@/lib/api/error-text";
import type { Attention } from "@/lib/api/types";
import { useAdmin, useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { berlinParts } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { personName, plural, translated } from "@/lib/format/names";
import { useNow } from "@/lib/hooks/use-now";
import { routes, withQuery } from "@/lib/routes";
import { humanize, type Tone } from "@/lib/status";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface Group {
  key: string;
  label: string;
  count: number;
  tone: Tone;
  href: Route;
  /** One line about what waits: the amount, the oldest, the place. */
  detail: string;
  rows: {
    key: string;
    href: Route;
    title: ReactNode;
    meta: ReactNode;
    trailing?: ReactNode;
  }[];
}

/** The groups of the attention overview (15), each with where it is handled. */
function groupsOf(attention: Attention): Group[] {
  const waitingAmount = attention.refunds.orders.reduce(
    (sum, order) => sum + order.paidAmount,
    0,
  );
  return [
    {
      key: "orders",
      label: "Orders to process",
      count: attention.orders.toProcess,
      tone: "attention",
      href: withQuery(routes.orders, { status: "confirmed" }),
      detail:
        attention.orders.toProcess > 0
          ? "Paid and waiting to be prepared. Mark them processing, then dispatch them."
          : "Every paid order is in processing or on its way.",
      rows: attention.orders.items.map((order) => ({
        key: order.id,
        href: routes.order(order.id),
        title: order.orderNumber,
        meta: (
          <>
            {personName(order.customer)} · {order.postalCode} {order.city} ·{" "}
            <DateTime value={order.placedAt} short />
          </>
        ),
        trailing: <Money cents={order.paidAmount} />,
      })),
    },
    {
      key: "refunds",
      label: "Refunds to decide",
      count: attention.refunds.needed,
      tone: "attention",
      href: withQuery(routes.orders, { needsRefund: true }),
      detail:
        attention.refunds.needed > 0
          ? `${formatMoney(waitingAmount)} paid on the newest ${attention.refunds.orders.length}. Decide each refund on the order.`
          : "No paid order waits for a refund.",
      rows: attention.refunds.orders.map((order) => ({
        key: order.id,
        href: `${routes.order(order.id)}#payment` as Route,
        title: order.orderNumber,
        meta: (
          <>
            {personName(order.customer)} ·{" "}
            <StatusBadge kind="order" value={order.status} />
          </>
        ),
        trailing: <Money cents={order.paidAmount} />,
      })),
    },
    {
      key: "refunds-open",
      label:
        attention.refunds.failed > 0 ? "Refunds to look at" : "Refunds to send",
      count: attention.refunds.pending + attention.refunds.failed,
      tone: attention.refunds.failed > 0 ? "danger" : "attention",
      href: withQuery(routes.refunds, {
        status: attention.refunds.failed > 0 ? "failed" : "pending",
      }),
      detail:
        attention.refunds.failed > 0
          ? `${plural(attention.refunds.failed, "refund")} failed at Stripe: withdraw it and refund by hand.`
          : "Send the money, then mark the refund as complete.",
      rows: attention.refunds.items.map((refund) => ({
        key: refund.id,
        href: routes.refund(refund.id),
        title: refund.refundNumber,
        meta: (
          <>
            {humanize(refund.manual?.way ?? refund.method)} ·{" "}
            <DateTime value={refund.createdAt} short />
          </>
        ),
        trailing: (
          <>
            {refund.status === "failed" ? (
              <StatusBadge kind="refund" value={refund.status} />
            ) : null}
            <Money cents={refund.amount} />
          </>
        ),
      })),
    },
    {
      key: "returns",
      label: "Returns to decide",
      count: attention.returns.requested,
      tone: "attention",
      href: withQuery(routes.returns, { status: "requested" }),
      detail: "Approve or decline what customers ask to send back.",
      rows: attention.returns.items.map((entry) => ({
        key: entry.id,
        href: routes.return(entry.id),
        title: entry.returnNumber,
        meta: (
          <>
            {plural(
              entry.items.reduce((sum, item) => sum + item.quantity, 0),
              "unit",
            )}
            , {humanize(entry.items[0]?.reason ?? "other").toLowerCase()} ·{" "}
            <DateTime value={entry.requestedAt} short />
          </>
        ),
        trailing: <Money cents={entry.requestedAmount} />,
      })),
    },
    {
      key: "stock",
      label: "Stock running low",
      count: attention.stock.low,
      tone: "attention",
      href: withQuery(routes.products, { lowStock: true }),
      detail:
        attention.stock.low > 0
          ? "At or below their threshold. A product at 0 is sold out in the shop."
          : "Every product with a threshold is above it.",
      rows: attention.stock.items.map((product) => ({
        key: product.id,
        href: routes.product(product.id),
        title: `${translated(product.name)} ${product.packSize.label}`,
        meta: (
          <>
            <span className="tabular">{product.sku}</span> · threshold{" "}
            {product.stock.lowStockThreshold ?? "—"}
          </>
        ),
        trailing: (
          <span
            className={cn(
              "font-semibold tabular",
              product.stock.quantity === 0 ? "text-danger-fg" : "text-gold",
            )}
          >
            {product.stock.quantity === 0
              ? "Sold out"
              : `${product.stock.quantity} left`}
          </span>
        ),
      })),
    },
    {
      key: "messages",
      label: "Failed messages",
      count: attention.notifications.failed,
      tone: "danger",
      href: withQuery(routes.notifications, { status: "failed" }),
      detail:
        attention.notifications.queued > 0
          ? `${plural(attention.notifications.queued, "message")} still waiting to go out.`
          : "Messages that the provider refused. Retry them.",
      rows: attention.notifications.items.map((message) => ({
        key: message.id,
        href: routes.notification(message.id),
        title: humanize(message.type),
        meta: `${message.to}${message.orderNumber ? ` · ${message.orderNumber}` : ""}`,
        trailing: (
          <DateTime
            value={message.updatedAt}
            short
            className="text-ink-muted"
          />
        ),
      })),
    },
  ];
}

function AttentionStrip({ groups }: { groups: Group[] }) {
  return (
    <ul className="grid grid-cols-2 overflow-hidden rounded-lg border border-line sm:grid-cols-3 xl:grid-cols-6">
      {groups.map((group) => (
        <li
          key={group.key}
          className="-mb-px -ml-px border-b border-l border-line"
        >
          <Link
            href={group.href}
            className="group flex h-full flex-col gap-0.5 px-4 py-3.5 transition-colors hover:bg-sunken/70"
          >
            <span className="flex items-center gap-1.5 text-13 font-medium text-ink-muted">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  toneClass[group.count > 0 ? group.tone : "neutral"].dot,
                )}
              />
              {group.label}
            </span>
            <span
              className={cn(
                "font-display text-3xl leading-none tabular",
                group.count > 0 ? "text-ink" : "text-ink-subtle",
              )}
            >
              {group.count}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AttentionPanel({ group }: { group: Group }) {
  return (
    <section className="flex flex-col rounded-lg border border-line">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", toneClass[group.tone].dot)}
          />
          {group.label}
        </h3>
        <Link
          href={group.href}
          className="text-13 font-medium text-accent-text hover:underline"
        >
          {group.count > group.rows.length
            ? `All ${group.count}`
            : "Open the list"}
        </Link>
      </header>
      <ul className="divide-y divide-line">
        {group.rows.map((row) => (
          <li key={row.key}>
            <Link
              href={row.href}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sunken/70"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-ink">
                  {row.title}
                </span>
                <span className="truncate text-13 text-ink-muted">
                  {row.meta}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-13">
                {row.trailing}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-auto border-t border-line px-4 py-2 text-13 text-ink-subtle">
        {group.detail}
      </p>
    </section>
  );
}

/**
 * What stops the shop from selling (5, 18): Stripe not connected, or the
 * company details incomplete. Said on the start page, before anyone
 * wonders why no order arrives.
 */
function ShopBlocked() {
  const can = useCan();
  const settings = useSettings().data;
  if (!can("settings.read") || !settings) return null;
  const stripeOff = settings.integrations?.stripeConnected === false;
  const missing = settings.company.missingForInvoices;
  if (!stripeOff && missing.length === 0) return null;
  return (
    <Alert
      tone="warning"
      title="The shop cannot sell yet"
      actions={
        <Button asChild size="sm">
          <Link
            href={
              missing.length > 0
                ? routes.settingsCompany
                : routes.settingsPayments
            }
          >
            {missing.length > 0
              ? "Complete the company details"
              : "See the connected services"}
          </Link>
        </Button>
      }
    >
      {stripeOff
        ? "Online payment is not set up (Stripe is not connected), and every order is paid at checkout. "
        : ""}
      {missing.length > 0
        ? `The invoice is issued the moment an order is paid, and the company details are incomplete: ${missingForInvoicesText(missing)}.`
        : ""}
    </Alert>
  );
}

/** The start page: what needs a person now. */
export function TodayView() {
  const admin = useAdmin();
  const can = useCan();
  const now = useNow();
  const attention = useAttention();
  const time = berlinParts(now);
  const groups = attention.data ? groupsOf(attention.data) : null;
  const waiting = groups?.reduce((sum, group) => sum + group.count, 0) ?? 0;
  const firstName = admin.name.split(" ")[0] ?? admin.name;

  return (
    <>
      <PageHeader
        title={`${greeting(time.hour)}, ${firstName}`}
        description={
          <>
            {WEEKDAYS[time.weekday]}, {time.day} {MONTHS[time.month - 1]}.{" "}
            {groups
              ? waiting > 0
                ? `${plural(waiting, "thing")} wait${waiting === 1 ? "s" : ""} for a decision.`
                : "Nothing waits for a decision."
              : null}
          </>
        }
      />
      <PageBody className="gap-8">
        <ShopBlocked />
        {!can("orders.read") ? (
          <RequirePermission permission="orders.read">{null}</RequirePermission>
        ) : (
          <section className="flex flex-col gap-4">
            <h2 className="sr-only">Waiting for you</h2>
            {attention.isError ? (
              <Alert tone="danger" title="The overview could not be loaded">
                {errorMessage(attention.error)}
              </Alert>
            ) : groups && attention.data ? (
              <>
                <AttentionStrip groups={groups} />
                {waiting === 0 ? (
                  <EmptyState
                    icon={<CircleCheck />}
                    title="All clear"
                    className="rounded-lg border border-line py-10"
                  >
                    No paid order waits to be prepared, no refund or return
                    waits for a decision, no product runs low and every message
                    went out.
                  </EmptyState>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {groups
                      .filter((group) => group.rows.length > 0)
                      .map((group) => (
                        <AttentionPanel key={group.key} group={group} />
                      ))}
                  </div>
                )}
              </>
            ) : (
              <Skeleton className="h-24 rounded-lg" />
            )}
          </section>
        )}
      </PageBody>
    </>
  );
}
