"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { ScrollX } from "@/components/ui/scroll-x";
import { Alert, EmptyState, Skeleton } from "@/components/ui/surface";
import { FigureTile } from "@/features/analytics/kpi";
import { describeError } from "@/lib/api/error-text";
import { hasErrorCode, isSessionError } from "@/lib/api/errors";
import type {
  FulfilmentOrder,
  FulfilmentOrderReturn,
  FulfilmentVariantDetail,
} from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format/dates";
import { routes } from "@/lib/routes";
import { humanize } from "@/lib/status";
import { AdjustmentList } from "./adjustment-list";
import {
  FIGURE_LABEL,
  NEGATIVE_NET_HINT,
  PAGE_SIZE,
  changeText,
  count,
  packTitle,
  periodText,
  unitsText,
  type PackSizeRef,
  type PeriodDays,
} from "./fulfilment";
import { useFulfilmentVariant } from "./queries";

const cell = "border-b border-line px-3 py-2.5 align-top";
const head =
  "border-b border-line bg-sunken px-3 py-2 text-xs font-semibold whitespace-nowrap text-ink-muted";

/** What a return of the order adds to the returned figure, in words. */
function countsText(entry: FulfilmentOrderReturn): string {
  if (entry.countedQuantity > 0)
    return `counts: ${count(entry.countedQuantity)}`;
  if (entry.status === "rejected" || entry.status === "cancelled") {
    return "does not count";
  }
  // Completed, and yet nothing counted: nothing was accepted, or the goods
  // came back on a day outside the period.
  if (entry.status === "completed") {
    return entry.acceptedQuantity === 0
      ? "does not count"
      : "counted outside this period";
  }
  return "does not count yet";
}

function ReturnLine({ entry }: { entry: FulfilmentOrderReturn }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <Link
        href={routes.return(entry.id)}
        className="font-medium text-accent-text hover:underline"
      >
        {entry.returnNumber}
      </Link>
      <StatusBadge kind="return" value={entry.status} />
      <span className="tabular">
        {count(entry.requestedQuantity)} requested,{" "}
        {entry.acceptedQuantity === null
          ? "not decided yet"
          : `${count(entry.acceptedQuantity)} accepted`}
      </span>
      {entry.completedAt ? (
        <span>completed {formatDate(entry.completedAt)}</span>
      ) : null}
      {entry.restocked ? <span>restocked</span> : null}
      <span
        className={cn(
          "font-medium tabular",
          entry.countedQuantity > 0 ? "text-ink" : "text-ink-subtle",
        )}
      >
        {countsText(entry)}
      </span>
    </li>
  );
}

function OrderRows({ order }: { order: FulfilmentOrder }) {
  const corrected = order.orderedQuantity !== order.deliveredQuantity;
  const before = order.dispatched === 0 && order.returned > 0;
  const details =
    corrected || order.corrections.length > 0 || order.returns.length > 0;
  return (
    <Fragment>
      <tr>
        <td className={cn(cell, details && "border-b-0")}>
          <div className="flex flex-col items-start gap-1">
            <Link
              href={routes.order(order.orderId)}
              className="font-semibold text-accent-text hover:underline"
            >
              {order.orderNumber}
            </Link>
            <span className="flex flex-wrap gap-1">
              {order.dispatched > 0 ? (
                <Badge tone="moving">dispatched</Badge>
              ) : null}
              {order.returned > 0 ? (
                <Badge tone="attention">returned</Badge>
              ) : null}
              {before ? (
                <Badge tone="neutral" dot={false}>
                  dispatched before this period
                </Badge>
              ) : null}
            </span>
          </div>
        </td>
        <td className={cn(cell, details && "border-b-0", "max-w-44")}>
          <span className="block truncate">{order.customerName ?? "—"}</span>
        </td>
        <td className={cn(cell, details && "border-b-0")}>
          <DateTime value={order.placedAt} short />
        </td>
        <td className={cn(cell, details && "border-b-0")}>
          <DateTime value={order.delivery.dispatchedAt} short />
        </td>
        <td className={cn(cell, details && "border-b-0")}>
          <StatusBadge kind="order" value={order.orderStatus} />
        </td>
        <td className={cn(cell, details && "border-b-0", "text-right tabular")}>
          {count(order.orderedQuantity)}
        </td>
        <td className={cn(cell, details && "border-b-0", "text-right tabular")}>
          {count(order.dispatched)}
        </td>
        <td className={cn(cell, details && "border-b-0", "text-right tabular")}>
          {count(order.returned)}
        </td>
      </tr>
      {details ? (
        <tr>
          <td colSpan={8} className={cn(cell, "pt-0 text-13 text-ink-muted")}>
            <div className="flex flex-col gap-1.5">
              {corrected || order.corrections.length > 0 ? (
                <p>
                  <span className="font-medium text-ink tabular">
                    {count(order.orderedQuantity)} ordered,{" "}
                    {count(order.deliveredQuantity)} delivered
                  </span>
                  {order.corrections.map((correction, index) => (
                    <span key={index}>
                      {" "}
                      · corrected from {count(correction.from)} to{" "}
                      {count(correction.to)}:{" "}
                      {humanize(correction.reason).toLowerCase()},{" "}
                      {formatDate(correction.at)}
                    </span>
                  ))}
                </p>
              ) : null}
              {order.returns.length > 0 ? (
                <ul
                  aria-label={`Returns of ${order.orderNumber}`}
                  className="flex flex-col gap-1.5"
                >
                  {order.returns.map((entry) => (
                    <ReturnLine key={entry.id} entry={entry} />
                  ))}
                </ul>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function Loaded({
  detail,
  refreshing,
  onPage,
}: {
  detail: FulfilmentVariantDetail;
  refreshing: boolean;
  onPage: (page: number) => void;
}) {
  const { row, fromOrders, orders, adjustments } = detail;
  const byHand = {
    dispatched: row.dispatched - fromOrders.dispatched,
    returned: row.returned - fromOrders.returned,
  };
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        refreshing && "opacity-60 transition-opacity",
      )}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <FigureTile
          label={FIGURE_LABEL.dispatched}
          value={count(row.dispatched)}
        />
        <FigureTile label={FIGURE_LABEL.returned} value={count(row.returned)} />
        <FigureTile
          label={FIGURE_LABEL.net}
          value={count(row.net)}
          detail={row.net < 0 ? NEGATIVE_NET_HINT : undefined}
          tone={row.net < 0 ? "attention" : undefined}
        />
      </div>

      {orders.total === 0 ? (
        <div className="glass-inset rounded-lg">
          <EmptyState title="No orders in this period." className="py-8" />
        </div>
      ) : (
        <ScrollX
          label={`Orders of ${packTitle(row)}`}
          className="glass-inset rounded-lg"
        >
          <table className="w-full border-separate border-spacing-0 text-sm">
            <caption className="sr-only">
              The orders behind the figures of {packTitle(row)}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={cn(head, "text-left")}>
                  Order
                </th>
                <th scope="col" className={cn(head, "text-left")}>
                  Customer
                </th>
                <th scope="col" className={cn(head, "text-left")}>
                  Placed
                </th>
                <th scope="col" className={cn(head, "text-left")}>
                  Dispatched on
                </th>
                <th scope="col" className={cn(head, "text-left")}>
                  Status
                </th>
                <th scope="col" className={cn(head, "text-right")}>
                  Ordered
                </th>
                <th scope="col" className={cn(head, "text-right")}>
                  {FIGURE_LABEL.dispatched}
                </th>
                <th scope="col" className={cn(head, "text-right")}>
                  {FIGURE_LABEL.returned}
                </th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">
              {orders.items.map((order) => (
                <OrderRows key={order.orderId} order={order} />
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
      <Pagination {...orders} noun="order" onPage={onPage} />

      {adjustments.length > 0 ? (
        <section
          aria-label="Adjustments by hand"
          className="flex flex-col gap-2"
        >
          <p className="text-sm text-ink">
            Orders: {unitsText(fromOrders)}. Adjustments: {changeText(byHand)}.
          </p>
          <AdjustmentList
            items={adjustments}
            label={`Adjustments of ${packTitle(row)} in this period`}
          />
        </section>
      ) : null}
    </div>
  );
}

function Content({ pack, days }: { pack: PackSizeRef; days: PeriodDays }) {
  const [page, setPage] = useState(1);
  const detail = useFulfilmentVariant(pack.variantId, {
    ...days,
    page,
    limit: PAGE_SIZE,
  });
  const gone = hasErrorCode(detail.error, "PRODUCT_VARIANT_NOT_FOUND");
  return (
    <>
      <DialogHeader
        title={`Orders of ${packTitle(pack)}`}
        description={
          <>
            SKU {pack.sku}
            {pack.brand ? ` · ${pack.brand}` : ""} · {periodText(days)}
          </>
        }
      />
      <DialogBody>
        {detail.data ? (
          <Loaded
            detail={detail.data}
            refreshing={detail.isPlaceholderData}
            onPage={setPage}
          />
        ) : detail.error && !isSessionError(detail.error) ? (
          gone ? (
            <Alert tone="danger" title="This pack size no longer exists." />
          ) : (
            <Alert
              tone="danger"
              title="The orders could not be loaded"
              actions={
                <Button onClick={() => void detail.refetch()}>Try again</Button>
              }
            >
              {describeError(detail.error).message}
            </Alert>
          )
        ) : (
          <div
            aria-busy="true"
            aria-label="Loading the orders"
            className="flex flex-col gap-3"
          >
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost" size="lg">
            Close
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

/**
 * "View orders": the orders and returns behind the figures of one row,
 * for the period of the page (`GET …/variants/{variantId}`), and what was
 * adjusted by hand.
 */
export function OrdersDialog({
  pack,
  days,
  onClose,
}: {
  /** The row that is looked at; `null` closes the dialog. */
  pack: PackSizeRef | null;
  days: PeriodDays;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={pack !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent size="xl">
        {pack ? <Content key={pack.variantId} pack={pack} days={days} /> : null}
      </DialogContent>
    </Dialog>
  );
}
