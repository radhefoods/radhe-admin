"use client";

import { Ban, Check, Clock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { ActionButton } from "@/components/domain/permission";
import { Timeline } from "@/components/domain/timeline";
import { DateTime, Money, useAdminNames } from "@/components/domain/values";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
} from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import type { Customer, OrderingAction, OverduePayment } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import {
  formatDateTime,
  formatDeadline,
  formatRelative,
} from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/names";
import { useNow } from "@/lib/hooks/use-now";
import { routes, withQuery } from "@/lib/routes";
import { OrderingDecisionDialog } from "./ordering-decision-dialog";
import { useCustomerOrdering } from "./queries";
import { DECISION_TONE, cannotOrderText, decisionTitle } from "./schemas";

const overdueColumns: Column<OverduePayment>[] = [
  {
    id: "order",
    header: "Order",
    cell: ({ row }) => (
      <Link
        href={withQuery(routes.orders, {
          orderNumber: row.original.orderNumber,
        })}
        className="font-semibold whitespace-nowrap text-accent-text hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
  },
  {
    id: "invoice",
    header: "Invoice",
    cell: ({ row }) => (
      <span className="tabular">{row.original.invoiceNumber}</span>
    ),
    meta: { from: "sm" },
  },
  {
    id: "deadline",
    header: "Was due",
    cell: ({ row }) => <DateTime value={row.original.deadlineAt} />,
  },
  {
    id: "amount",
    header: "Amount due",
    cell: ({ row }) => (
      <Money cents={row.original.amountDue} className="font-medium" />
    ),
    meta: { align: "right" },
  },
];

/**
 * The ordering decision of a customer (4): whether a new order is possible
 * now, what stands in the way, the payments that are overdue, and the three
 * decisions the team can take, each kept in the history.
 */
export function CustomerOrdering({ customer }: { customer: Customer }) {
  const query = useCustomerOrdering(customer.id);
  const adminName = useAdminNames();
  const now = useNow();
  const [action, setAction] = useState<OrderingAction | null>(null);
  const data = query.data;

  return (
    <Card>
      <CardHeader
        title="Ordering"
        description="Whether the customer may place a new order. A decision here leaves the account usable: browsing, the cart and paying still work."
      />
      {data ? (
        <>
          <CardBody className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-4.5",
                  data.ordering.canOrder
                    ? "bg-success-bg text-success-fg"
                    : "bg-danger-bg text-danger-fg",
                )}
              >
                {data.ordering.canOrder ? <Check /> : <Ban />}
              </span>
              <div className="flex min-w-0 flex-col">
                <p className="text-base font-semibold text-ink">
                  {data.ordering.canOrder
                    ? "May place a new order"
                    : "Cannot place a new order"}
                </p>
                <p className="text-13 text-ink-muted">
                  {data.ordering.reason
                    ? cannotOrderText(
                        data.ordering.reason,
                        data.ordering.overdue.length,
                      )
                    : data.ordering.override?.mode === "allowed" &&
                        data.ordering.overdue.length > 0
                      ? "A payment is overdue, but the team allowed ordering for a while."
                      : "Nothing stands in the way."}
                </p>
              </div>
            </div>

            {data.ordering.override ? (
              <div
                className={cn(
                  "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-13",
                  data.ordering.override.mode === "allowed"
                    ? "border-gold-line bg-gold-soft"
                    : "border-danger-dot/30 bg-danger-bg/60",
                )}
              >
                {data.ordering.override.mode === "allowed" ? (
                  <Clock
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-gold"
                  />
                ) : (
                  <Ban
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-danger-fg"
                  />
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p
                    className={cn(
                      "font-semibold",
                      data.ordering.override.mode === "allowed"
                        ? "text-gold"
                        : "text-ink",
                    )}
                  >
                    {data.ordering.override.mode === "allowed"
                      ? data.ordering.override.until
                        ? `Decision in force: may order until ${formatDeadline(data.ordering.override.until)}, ${formatRelative(data.ordering.override.until, now)}`
                        : "Decision in force: may order although a payment is overdue"
                      : "Decision in force: ordering is blocked until the decision is cleared"}
                  </p>
                  {customer.orderingOverride &&
                  customer.orderingOverride.mode ===
                    data.ordering.override.mode ? (
                    <p className="text-ink-muted">
                      “{customer.orderingOverride.reason}” ·{" "}
                      {adminName(customer.orderingOverride.adminId)},{" "}
                      {formatDateTime(customer.orderingOverride.at)}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {data.ordering.overdue.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-13 font-semibold text-ink">
                  Overdue payments
                  <span className="ml-2 font-normal text-ink-muted">
                    {plural(data.ordering.overdue.length, "payment")},{" "}
                    {formatMoney(
                      data.ordering.overdue.reduce(
                        (sum, entry) => sum + entry.amountDue,
                        0,
                      ),
                    )}
                  </span>
                </h3>
                <DataTable
                  caption="Overdue payments of this customer"
                  columns={overdueColumns}
                  data={data.ordering.overdue}
                  getRowId={(entry) => entry.invoiceNumber}
                  empty={null}
                />
              </section>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <ActionButton
                permission="customers.manage"
                variant={
                  data.ordering.reason === "payment_overdue"
                    ? "primary"
                    : "secondary"
                }
                onClick={() => setAction("allow")}
              >
                Allow for a while
              </ActionButton>
              <ActionButton
                permission="customers.manage"
                variant="danger-outline"
                blocked={
                  data.ordering.override?.mode === "blocked"
                    ? "Ordering is blocked already."
                    : null
                }
                onClick={() => setAction("block")}
              >
                Block ordering
              </ActionButton>
              <ActionButton
                permission="customers.manage"
                blocked={
                  data.ordering.override ? null : "No decision is in force."
                }
                onClick={() => setAction("clear")}
              >
                Clear the decision
              </ActionButton>
            </div>
          </CardBody>

          <div className="border-t border-line px-4 py-4 sm:px-5">
            <h3 className="mb-3 text-13 font-semibold text-ink">
              History of decisions
            </h3>
            {data.history.length > 0 ? (
              <Timeline
                entries={[...data.history]
                  .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
                  .map((entry, index) => ({
                    key: `${entry.at}-${index}`,
                    at: entry.at,
                    title: (
                      <>
                        {decisionTitle(entry)}
                        {entry.action === "allow" && entry.until ? (
                          <span className="font-normal text-ink-muted">
                            {" "}
                            until {formatDateTime(entry.until)}
                          </span>
                        ) : null}
                      </>
                    ),
                    by: adminName(entry.adminId),
                    note: entry.reason,
                    tone: DECISION_TONE[entry.action],
                  }))}
              />
            ) : (
              <p className="text-13 text-ink-muted">
                No decision was ever taken for this customer.
              </p>
            )}
          </div>

          <OrderingDecisionDialog
            customer={customer}
            ordering={data.ordering}
            action={action}
            onOpenChange={(open) => {
              if (!open) setAction(null);
            }}
          />
        </>
      ) : query.isError ? (
        <CardBody>
          <Alert
            tone="danger"
            title="The ordering decision could not be loaded"
            actions={
              <Button onClick={() => void query.refetch()}>Try again</Button>
            }
          >
            {errorMessage(query.error)}
          </Alert>
        </CardBody>
      ) : (
        <CardBody className="flex flex-col gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-16" />
          <Skeleton className="h-8 w-80" />
        </CardBody>
      )}
    </Card>
  );
}
