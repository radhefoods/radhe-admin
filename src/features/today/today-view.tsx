"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Money } from "@/components/domain/values";
import { useCargoOverview } from "@/components/shell/cargo-pill";
import { PageBody, PageHeader, SectionTitle } from "@/components/shell/page";
import { useAttention } from "@/components/shell/sidebar";
import { toneClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { CargoCard } from "@/features/cargos/cargo-card";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { queryKeys } from "@/lib/api/query-keys";
import type { Attention } from "@/lib/api/types";
import { useAdmin, useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { berlinParts, formatDeadline } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { personName, plural } from "@/lib/format/names";
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

/** The groups of the attention overview (16), each with where it is handled. */
function groupsOf(attention: Attention): Group[] {
  const overdueAmount = attention.payments.items.reduce(
    (sum, order) => sum + order.finalTotal,
    0,
  );
  return [
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
      key: "overdue",
      label: "Overdue payments",
      count: attention.payments.overdue,
      tone: "danger",
      href: withQuery(routes.orders, { paymentStatus: "overdue" }),
      detail:
        attention.payments.overdue > 0
          ? `${formatMoney(overdueAmount)} in the newest ${attention.payments.items.length}.`
          : "Every invoice is within its deadline.",
      rows: attention.payments.items.map((order) => ({
        key: order.id,
        href: routes.order(order.id),
        title: order.orderNumber,
        meta: `${personName(order.customer)} · ${order.cargo.code}`,
        trailing: <Money cents={order.finalTotal} />,
      })),
    },
    {
      key: "deliveries",
      label: "Failed deliveries",
      count: attention.deliveries.failed,
      tone: "danger",
      href: withQuery(routes.orders, { status: "delivery_failed" }),
      detail: "Dispatch again, or move the order to the next cargo.",
      rows: attention.deliveries.items.map((order) => ({
        key: order.id,
        href: routes.order(order.id),
        title: order.orderNumber,
        meta: `${personName(order.customer)} · ${order.postalCode} ${order.city}`,
        trailing: <span className="text-ink-muted">{order.cargo.code}</span>,
      })),
    },
    {
      key: "refunds",
      label:
        attention.refunds.failed > 0 ? "Refunds to look at" : "Refunds to send",
      count: attention.refunds.pending + attention.refunds.failed,
      tone: attention.refunds.failed > 0 ? "danger" : "attention",
      href: withQuery(routes.refunds, {
        status: attention.refunds.failed > 0 ? "failed" : "pending",
      }),
      detail: "Send the money, then mark the refund as complete.",
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
    <ul className="grid grid-cols-2 overflow-hidden rounded-lg border border-line sm:grid-cols-3 xl:grid-cols-5">
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
                "font-display text-4xl leading-none tabular",
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

/** Online payments that failed lately: the customer already has a new link. */
function FailedPayments({ attention }: { attention: Attention }) {
  const orders = attention.payments.failedRecently;
  if (orders.length === 0) return null;
  return (
    <Alert
      tone="time"
      title={`${plural(orders.length, "online payment")} failed in the last 7 days`}
    >
      Each customer already received a new payment link. Nothing to do unless it
      happens again:{" "}
      {orders.map((order, index) => (
        <span key={order.id}>
          {index > 0 ? ", " : ""}
          <Link href={routes.order(order.id)}>{order.orderNumber}</Link>
        </span>
      ))}
      .
    </Alert>
  );
}

/** Delivered cargos that still have money to collect. */
function Collecting() {
  const can = useCan();
  const { data } = useQuery({
    queryKey: queryKeys.cargos.list({ status: "delivered", limit: 2 }),
    queryFn: ({ signal }) =>
      api.cargos.list({ status: "delivered", limit: 2 }, signal),
    enabled: can("cargos.read") && can("payments.read"),
  });
  if (!data || data.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        description="The newest delivered cargos and what is still to collect."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={routes.payments}>All payments</Link>
          </Button>
        }
      >
        Collecting
      </SectionTitle>
      <div className="grid gap-4 xl:grid-cols-2">
        {data.items.map((cargo) => (
          <CargoCard key={cargo.id} cargo={cargo} />
        ))}
      </div>
    </section>
  );
}

function Cargos() {
  const overview = useCargoOverview();
  const can = useCan();
  if (overview.isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (overview.isError) {
    return (
      <Alert tone="danger" title="The cargos could not be loaded">
        {errorMessage(overview.error)}
      </Alert>
    );
  }
  const data = overview.data;
  if (!data) return null;
  const cargos = [data.current, ...data.inProgress, data.next].filter(
    (cargo) => cargo !== null,
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        description={
          data.current
            ? data.acceptingOrders
              ? `${data.current.code} takes orders until ${formatDeadline(data.current.orderCloseAt)}.`
              : `${data.current.code} is open, but its order window is over.`
            : "No cargo takes orders: customers cannot order right now."
        }
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={routes.cargos}>All cargos</Link>
          </Button>
        }
      >
        Cargos on their way
      </SectionTitle>
      {!data.current ? (
        <Alert
          tone="warning"
          title="Ordering is closed"
          actions={
            can("cargos.manage") ? (
              <Button asChild size="sm">
                <Link
                  href={
                    data.next ? routes.cargo(data.next.id) : routes.cargoNew
                  }
                >
                  {data.next ? `Open ${data.next.code}` : "Create a cargo"}
                </Link>
              </Button>
            ) : null
          }
        >
          {data.next
            ? `${data.next.code} is scheduled and opens by itself ${formatDeadline(data.next.orderOpenAt)}.`
            : "No cargo is scheduled either. Create the next cargo so that customers can order again."}
        </Alert>
      ) : null}
      {cargos.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {cargos.map((cargo) => (
            <CargoCard key={cargo.id} cargo={cargo} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** The start page: what needs a person now, and where the cargos stand. */
export function TodayView() {
  const admin = useAdmin();
  const can = useCan();
  const now = useNow();
  const attention = useAttention();
  const time = berlinParts(now);
  const groups = attention.data ? groupsOf(attention.data) : null;
  const waiting = groups?.reduce((sum, group) => sum + group.count, 0) ?? 0;
  const firstName = admin.name.split(" ")[0] ?? admin.name;
  const nothingToRead = !can("orders.read") && !can("cargos.read");

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
        {nothingToRead ? (
          <RequirePermission permission="orders.read">{null}</RequirePermission>
        ) : null}

        {can("orders.read") ? (
          <section className="flex flex-col gap-4">
            <h2 className="sr-only">Waiting for you</h2>
            {attention.isError ? (
              <Alert tone="danger" title="The overview could not be loaded">
                {errorMessage(attention.error)}
              </Alert>
            ) : groups && attention.data ? (
              <>
                <AttentionStrip groups={groups} />
                <FailedPayments attention={attention.data} />
                {waiting === 0 ? (
                  <EmptyState
                    icon={<CircleCheck />}
                    title="All clear"
                    className="rounded-lg border border-line py-10"
                  >
                    No return waits for a decision, no payment is overdue, no
                    delivery failed, no refund is open and every message went
                    out.
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
        ) : null}

        {can("cargos.read") ? <Cargos /> : null}
        <Collecting />
      </PageBody>
    </>
  );
}
