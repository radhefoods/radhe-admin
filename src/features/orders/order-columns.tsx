import Link from "next/link";
import type { Column } from "@/components/data/data-table";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Money, TwoLine } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import type { OrderSummary } from "@/lib/api/types";
import { DELIVERY_METHOD_LABEL, personName } from "@/lib/format/names";
import { routes } from "@/lib/routes";

function OrderNumber({ order }: { order: OrderSummary }) {
  return (
    <Link
      href={routes.order(order.id)}
      className="font-semibold text-accent-text hover:underline"
    >
      {order.orderNumber}
    </Link>
  );
}

/** The discount code an order was made with (26), next to its number. */
export function DiscountBadge({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <Badge
      dot={false}
      className="font-mono"
      title={`Made with the discount code ${code}`}
    >
      {code}
    </Badge>
  );
}

/** The columns of every list of orders. */
export function orderColumns(): Column<OrderSummary>[] {
  return [
    {
      id: "order",
      header: "Order",
      cell: ({ row }) => (
        <TwoLine
          primary={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <OrderNumber order={row.original} />
              <DiscountBadge code={row.original.discountCode} />
            </span>
          }
          secondary={<DateTime value={row.original.placedAt} short />}
        />
      ),
      meta: { skeleton: "w-20" },
    },
    {
      id: "customer",
      header: "Customer",
      cell: ({ row }) => (
        <TwoLine
          primary={personName(row.original.customer)}
          secondary={`${row.original.postalCode} ${row.original.city}`}
        />
      ),
      meta: { skeleton: "w-36", className: "max-w-56" },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge kind="order" value={row.original.status} />
      ),
    },
    {
      id: "payment",
      header: "Payment",
      cell: ({ row }) => (
        <StatusBadge kind="payment" value={row.original.paymentStatus} />
      ),
      meta: { from: "md" },
    },
    {
      id: "delivery",
      header: "Delivery",
      cell: ({ row }) => (
        <TwoLine
          primary={DELIVERY_METHOD_LABEL[row.original.delivery.method]}
          secondary={
            row.original.delivery.trackingNumber ? (
              <span className="tabular">
                {row.original.delivery.trackingNumber}
              </span>
            ) : null
          }
        />
      ),
      meta: { from: "xl", skeleton: "w-28" },
    },
    {
      id: "items",
      header: "Units",
      cell: ({ row }) => row.original.itemCount,
      meta: { align: "right", from: "lg", skeleton: "w-6" },
    },
    {
      id: "total",
      header: "Total",
      cell: ({ row }) => {
        const { total, finalTotal } = row.original;
        return (
          <span className="flex flex-col items-end">
            <Money cents={finalTotal} className="font-medium" />
            {finalTotal !== total ? (
              <span className="text-13 text-ink-subtle line-through">
                <Money cents={total} />
              </span>
            ) : null}
          </span>
        );
      },
      meta: { align: "right", skeleton: "w-14" },
    },
  ];
}

/** An order as a card, for phones. */
export function OrderCard({ order }: { order: OrderSummary }) {
  return (
    <Link
      href={routes.order(order.id)}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 active:bg-sunken"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="text-base font-semibold text-ink">
            {order.orderNumber}
          </span>
          <DiscountBadge code={order.discountCode} />
        </span>
        <Money cents={order.finalTotal} className="font-semibold" />
      </span>
      <span className="text-sm text-ink-muted">
        {personName(order.customer)} · {order.postalCode} {order.city}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="order" value={order.status} />
        <StatusBadge kind="payment" value={order.paymentStatus} />
        <span className="ml-auto text-13 text-ink-subtle">
          {DELIVERY_METHOD_LABEL[order.delivery.method]}
        </span>
      </span>
    </Link>
  );
}
