"use client";

import { useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { AdminName, DateTime, Money, Thumb } from "@/components/domain/values";
import { ScrollX } from "@/components/ui/scroll-x";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import type { OrderDetail, OrderItem, Totals } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatVatRate } from "@/lib/format/money";
import { translated } from "@/lib/format/names";
import { ORDER_STATUS, humanize } from "@/lib/status";
import { ORDER_CHANGEABLE_IN } from "@/lib/status/transitions";
import { OrderItemDialog } from "./order-dialogs";
import type { OrderActions } from "./queries";

function TotalsBlock({
  title,
  totals,
  quiet,
}: {
  title: string;
  totals: Totals;
  quiet?: boolean;
}) {
  return (
    <dl
      aria-label={title}
      className={cn("flex flex-col gap-1 text-sm", quiet && "text-ink-muted")}
    >
      <div className="flex justify-between gap-6">
        <dt>Goods</dt>
        <dd>
          <Money cents={totals.subtotal} />
        </dd>
      </div>
      <div className="flex justify-between gap-6">
        <dt>Delivery</dt>
        <dd>
          <Money cents={totals.deliveryFee} />
        </dd>
      </div>
      <div
        className={cn(
          "flex justify-between gap-6 border-t border-line pt-1.5 font-semibold",
          !quiet && "text-ink",
        )}
      >
        <dt>{title}</dt>
        <dd>
          <Money cents={totals.total} className={quiet ? "" : "text-base"} />
        </dd>
      </div>
      {totals.vat.map((entry) => (
        <div
          key={entry.vatRate}
          className="flex justify-between gap-6 text-13 text-ink-subtle"
        >
          <dt>Includes {formatVatRate(entry.vatRate)} VAT</dt>
          <dd>
            <Money cents={entry.vat} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What was ordered, what was delivered and what the customer pays. The
 * agreed bill never changes; the final bill follows the units that were
 * delivered and kept.
 */
export function OrderItemsCard({
  order,
  actions,
}: {
  order: OrderDetail;
  actions: OrderActions;
}) {
  const [correcting, setCorrecting] = useState<OrderItem | null>(null);
  const changeable = ORDER_CHANGEABLE_IN.includes(order.status);
  const differs = order.finalTotals.total !== order.totals.total;

  return (
    <Card>
      <CardHeader
        title="Items"
        description={
          changeable
            ? "If less arrived than was ordered, correct the delivered units: the customer pays only for what arrived."
            : `The items can no longer be corrected: the order is ${ORDER_STATUS[order.status].label.toLowerCase()}.`
        }
      />
      <ScrollX label={`Items of ${order.orderNumber}`}>
        <table className="w-full text-sm">
          <caption className="sr-only">Items of {order.orderNumber}</caption>
          <thead>
            <tr className="border-b border-line text-xs text-ink-muted">
              <th
                scope="col"
                className="px-4 py-2 text-left font-semibold sm:px-5"
              >
                Product
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Price
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Ordered
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Delivered
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Total
              </th>
              <th scope="col" className="px-4 py-2 sm:px-5">
                <span className="sr-only">Correct</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => {
              const changed =
                item.deliveredQuantity !== item.quantity ||
                item.returnedQuantity > 0;
              return (
                <tr
                  key={item.productId}
                  className="border-b border-line last:border-b-0"
                >
                  <th
                    scope="row"
                    className="px-4 py-2.5 text-left font-normal sm:px-5"
                  >
                    <span className="flex items-center gap-3">
                      <Thumb src={item.imageUrl} size={36} />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-ink">
                          {translated(item.name)}{" "}
                          <span className="text-ink-muted">
                            {item.packSize.label}
                          </span>
                        </span>
                        <span className="text-13 text-ink-subtle">
                          {item.sku}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
                    <Money cents={item.unitPrice} />
                    {item.regularUnitPrice !== item.unitPrice ? (
                      <span className="block text-13 text-ink-subtle line-through">
                        <Money cents={item.regularUnitPrice} />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">
                    <span className={cn(changed && "font-semibold text-gold")}>
                      {item.deliveredQuantity}
                    </span>
                    {item.returnedQuantity > 0 ? (
                      <span className="block text-13 text-ink-subtle">
                        {item.returnedQuantity} returned
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
                    <Money
                      cents={item.finalLineTotal}
                      className="font-medium"
                    />
                    {item.finalLineTotal !== item.lineTotal ? (
                      <span className="block text-13 text-ink-subtle line-through">
                        <Money cents={item.lineTotal} />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-5">
                    {changeable ? (
                      <ActionButton
                        permission="orders.manage"
                        size="sm"
                        variant="ghost"
                        aria-label={`Correct the delivered units of ${translated(item.name)} ${item.packSize.label}`}
                        onClick={() => setCorrecting(item)}
                      >
                        Correct
                      </ActionButton>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
      <CardBody className="flex flex-col gap-4 border-t border-line sm:flex-row sm:justify-end sm:gap-10">
        {differs ? (
          <div className="sm:w-64">
            <TotalsBlock
              title="Agreed at checkout"
              totals={order.totals}
              quiet
            />
          </div>
        ) : null}
        <div className="sm:w-64">
          <TotalsBlock
            title={differs ? "Final bill" : "Total"}
            totals={order.finalTotals}
          />
        </div>
      </CardBody>
      {order.adjustments.length > 0 ? (
        <CardBody className="border-t border-line">
          <h3 className="mb-2 text-xs font-semibold text-ink-muted">
            Corrections
          </h3>
          <ul className="flex flex-col gap-1.5 text-13 text-ink-muted">
            {order.adjustments.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <span className="font-medium text-ink">{entry.sku}</span>:{" "}
                {entry.from} to {entry.to} delivered,{" "}
                {humanize(entry.reason).toLowerCase()}
                {entry.note ? `, “${entry.note}”` : ""} ·{" "}
                <AdminName id={entry.adminId} />,{" "}
                <DateTime value={entry.at} short />
              </li>
            ))}
          </ul>
        </CardBody>
      ) : null}
      <OrderItemDialog
        order={order}
        item={correcting}
        actions={actions}
        onOpenChange={(open) => {
          if (!open) setCorrecting(null);
        }}
      />
    </Card>
  );
}
