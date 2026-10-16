"use client";

import Link from "next/link";
import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { useAttention } from "@/components/shell/sidebar";
import { CountBadge } from "@/components/ui/badge";
import { tabClass } from "@/components/ui/controls";
import { Alert } from "@/components/ui/surface";
import {
  OrdersList,
  type OrdersListProps,
} from "@/features/orders/orders-list";
import { useCan } from "@/lib/auth/auth-provider";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";

const VIEWS = [
  "needs_refund",
  "pending",
  "authorized",
  "paid",
  "failed",
  "refunded",
] as const;
type View = (typeof VIEWS)[number];

const VIEW: Record<
  View,
  { label: string; about: string; fixed: OrdersListProps["fixed"] }
> = {
  needs_refund: {
    label: "Waiting for a refund",
    about:
      "Paid orders whose money waits for your decision: cancelled after the payment, or lowered by a credit note after a correction or a return. Decide the refund on the order, through Stripe or by hand.",
    fixed: { needsRefund: true },
  },
  pending: {
    label: "Pending",
    about:
      "The customer started to pay but has not finished. Nothing is reserved; the shop gives the order up when the page expires without a payment.",
    fixed: { paymentStatus: "pending" },
  },
  authorized: {
    label: "Authorized",
    about:
      "The bank approved the amount; the shop is taking the stock and capturing the money. This takes seconds.",
    fixed: { paymentStatus: "authorized" },
  },
  paid: {
    label: "Paid",
    about:
      "Captured through Stripe, by card or PayPal. The invoice was issued the moment the money arrived.",
    fixed: { paymentStatus: "paid" },
  },
  failed: {
    label: "Failed",
    about:
      "The last attempt did not go through, or the page expired. The customer can pay again from the order page in the shop.",
    fixed: { paymentStatus: "failed" },
  },
  refunded: {
    label: "Refunded",
    about: "Everything that was paid went back.",
    fixed: { paymentStatus: "refunded" },
  },
};

/**
 * The payments of all orders by where they stand. Customers pay at
 * checkout; the work left to the admin is the refund, decided on the order.
 */
export function PaymentsView() {
  const can = useCan();
  const [state, setState] = useUrlState({
    view: param.oneOfOr(VIEWS, "needs_refund"),
  });
  const attention = useAttention().data;
  const view = VIEW[state.view];

  return (
    <RequirePermission permission="payments.read">
      <PageHeader
        title="Payments"
        description="Customers pay at checkout on a Stripe page, by card or PayPal; the payment confirms the order and issues the invoice. Nothing is recorded by hand. What you decide are refunds."
        className="pb-3"
      />
      <nav
        aria-label="Payments by status"
        className="relative no-scrollbar flex gap-5 overflow-x-auto border-b border-line px-4 sm:px-6 lg:px-8"
      >
        {VIEWS.map((key) => (
          <button
            key={key}
            type="button"
            aria-current={state.view === key ? "page" : undefined}
            onClick={() => setState({ view: key })}
            className={tabClass}
          >
            {VIEW[key].label}
            {key === "needs_refund" && attention ? (
              <CountBadge count={attention.refunds.needed} tone="attention" />
            ) : null}
          </button>
        ))}
      </nav>
      <PageBody className="pt-5">
        <p className="max-w-3xl text-13 text-ink-muted">{view.about}</p>
        {can("orders.read") ? (
          <OrdersList
            key={state.view}
            fixed={view.fixed}
            hide={["status", "paymentStatus"]}
            caption={`Orders, ${view.label.toLowerCase()}`}
          />
        ) : (
          <Alert tone="info" title="Your role does not include the orders">
            The payments are listed by order, which needs “Orders: read”.{" "}
            <Link href={routes.refunds}>Refunds</Link> and{" "}
            <Link href={routes.invoices}>invoices</Link> are open to you.
          </Alert>
        )}
      </PageBody>
    </RequirePermission>
  );
}
