"use client";

import { useMutation } from "@tanstack/react-query";
import { Play } from "lucide-react";
import Link from "next/link";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { useAttention } from "@/components/shell/sidebar";
import { CountBadge } from "@/components/ui/badge";
import { tabClass } from "@/components/ui/controls";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import {
  OrdersList,
  type OrdersListProps,
} from "@/features/orders/orders-list";
import { api } from "@/lib/api/client";
import { invalidation } from "@/lib/api/query-keys";
import { useCan } from "@/lib/auth/auth-provider";
import { plural } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";

const VIEWS = [
  "overdue",
  "due",
  "to_activate",
  "paid",
  "waived",
  "refunded",
] as const;
type View = (typeof VIEWS)[number];

const VIEW: Record<
  View,
  { label: string; about: string; fixed: OrdersListProps["fixed"] }
> = {
  overdue: {
    label: "Overdue",
    about:
      "Past their deadline. The customer cannot confirm a new order until the payment arrives, unless you allow it on the customer's page.",
    fixed: { paymentStatus: "overdue" },
  },
  due: {
    label: "Due",
    about: "Invoiced and within the deadline. A reminder goes out every day.",
    fixed: { paymentStatus: "due" },
  },
  to_activate: {
    label: "Not invoiced",
    about:
      "Delivered, but payment is not activated yet. Activate a whole cargo on its Payments tab, or a single order on its page.",
    fixed: { status: "delivered", paymentStatus: "not_enabled" },
  },
  paid: {
    label: "Paid",
    about: "Paid online or in cash, or settled by credit notes.",
    fixed: { paymentStatus: "paid" },
  },
  waived: {
    label: "Waived",
    about: "The customer was let off what was owed.",
    fixed: { paymentStatus: "waived" },
  },
  refunded: {
    label: "Refunded",
    about: "Everything that was paid went back.",
    fixed: { paymentStatus: "refunded" },
  },
};

/**
 * The payments of all orders by where they stand. The work itself
 * (activate, record cash, waive, remind, refund) happens on the order.
 */
export function PaymentsView() {
  const can = useCan();
  const [state, setState] = useUrlState({
    view: param.oneOfOr(VIEWS, "overdue"),
  });
  const attention = useAttention().data;
  const jobs = useMutation({
    mutationFn: () => api.payments.runJobs(),
    meta: { invalidates: invalidation.payment },
  });
  const view = VIEW[state.view];

  return (
    <RequirePermission permission="payments.read">
      <PageHeader
        title="Payments"
        description="Customers pay after delivery: online with the link in the invoice email, or in cash to the driver. Reminders go out every day until an order is paid."
        actions={
          <ActionButton
            permission="payments.manage"
            variant="ghost"
            icon={<Play />}
            loading={jobs.isPending}
            onClick={() =>
              jobs.mutate(undefined, {
                onSuccess: (result) =>
                  notify.success(
                    "The payment jobs ran",
                    `${plural(result.overdue, "payment")} became overdue, ${plural(result.reminders, "reminder")} sent.`,
                  ),
              })
            }
          >
            Run the payment jobs
          </ActionButton>
        }
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
            {key === "overdue" && attention ? (
              <CountBadge count={attention.payments.overdue} tone="danger" />
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
