"use client";

import { useId, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import { CAN_TAKE_ORDERS, useCargoChoices } from "@/features/cargos/queries";
import {
  ADJUSTMENT_REASONS,
  ADMIN_CANCELLATION_REASONS,
  DELIVERY_METHODS,
  type AdjustmentReason,
  type AdminCancellationReason,
  type DeliveryMethod,
  type OrderDetail,
  type OrderItem,
  type SettableOrderStatus,
} from "@/lib/api/types";
import { formatDayRange } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import {
  DELIVERY_METHOD_LABEL,
  personName,
  translated,
} from "@/lib/format/names";
import { ORDER_STATUS, humanize } from "@/lib/status";
import { ORDER_PATH, orderActionLabel } from "@/lib/status/transitions";
import type { OrderActions } from "./queries";

const TRACKING = /^[A-Za-z0-9-]{4,60}$/;

function Labelled({
  label,
  optional,
  hint,
  error,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-13 font-medium text-ink">
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-ink-subtle">optional</span>
        ) : null}
      </label>
      {children(id)}
      {error ? (
        <p className="text-13 text-danger-fg">{error}</p>
      ) : hint ? (
        <p className="text-13 text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

function NoteField({
  value,
  onChange,
  label = "Note for the history",
  optional = true,
  maxLength = 500,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  optional?: boolean;
  maxLength?: number;
}) {
  return (
    <Labelled label={label} optional={optional}>
      {(id) => (
        <Textarea
          id={id}
          rows={2}
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-0"
        />
      )}
    </Labelled>
  );
}

/** The customer hears about these steps (documentation, 10: status). */
const TOLD: Partial<Record<SettableOrderStatus, string>> = {
  dispatched:
    "The customer is told by email that the order is on its way, and by WhatsApp when they asked for it.",
  delivered: "The customer is told by email that the order was delivered.",
  delivery_failed: "The customer is told by email that the delivery failed.",
};

/** One confirmation for every status an order can be given. */
export function OrderStatusDialog({
  order,
  to,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  to: SettableOrderStatus | null;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = useState("");
  const [tracking, setTracking] = useState<string | null>(null);
  if (!to) return null;

  const from = order.status;
  const back =
    ORDER_PATH.indexOf(to as (typeof ORDER_PATH)[number]) !== -1 &&
    ORDER_PATH.indexOf(from as (typeof ORDER_PATH)[number]) !== -1 &&
    ORDER_PATH.indexOf(to as (typeof ORDER_PATH)[number]) <
      ORDER_PATH.indexOf(from as (typeof ORDER_PATH)[number]);
  const carrier = order.delivery.method !== "radhe_delivery";
  const askTracking = to === "dispatched" && carrier;
  const trackingText = tracking ?? order.delivery.trackingNumber ?? "";
  const trackingValid =
    trackingText.trim() === "" || TRACKING.test(trackingText.trim());
  const label = ORDER_STATUS[to].label.toLowerCase();

  const title = back
    ? `Take ${order.orderNumber} back to "${label}"?`
    : to === "delivery_failed"
      ? `Did the delivery of ${order.orderNumber} fail?`
      : from === "delivery_failed" && to === "dispatched"
        ? `Dispatch ${order.orderNumber} again?`
        : `Mark ${order.orderNumber} as ${label}?`;
  const description = back
    ? "A correction of a step taken by mistake. The customer is not told."
    : (TOLD[to] ?? "The customer is not told about this step.");

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setNote("");
          setTracking(null);
        }
        onOpenChange(open);
      }}
      title={title}
      description={description}
      tone={to === "delivery_failed" ? "danger" : "primary"}
      facts={[
        { label: "Customer", value: personName(order.customer) },
        {
          label: "Goes to",
          value: `${order.deliveryAddress.postalCode} ${order.deliveryAddress.city}`,
        },
        {
          label: "Delivery",
          value: DELIVERY_METHOD_LABEL[order.delivery.method],
        },
        ...(to === "delivered"
          ? [
              {
                label: "To pay after activation",
                value: formatMoney(order.finalTotal),
                strong: true,
              },
            ]
          : []),
      ]}
      confirmLabel={orderActionLabel(from, to)}
      canConfirm={!askTracking || trackingValid}
      onConfirm={async () => {
        await actions.setStatus.mutateAsync({
          status: to,
          trackingNumber:
            askTracking && trackingText.trim()
              ? trackingText.trim()
              : undefined,
          note: note.trim() || undefined,
        });
        notify.success(`${order.orderNumber} is now ${label}`);
      }}
    >
      {askTracking ? (
        <Labelled
          label={`${DELIVERY_METHOD_LABEL[order.delivery.method]} tracking number`}
          optional
          hint="The customer gets a link to the carrier."
          error={trackingValid ? null : "4 to 60 letters, digits or hyphens."}
        >
          {(id) => (
            <Input
              id={id}
              value={trackingText}
              onChange={(event) => setTracking(event.target.value)}
              aria-invalid={trackingValid ? undefined : true}
              autoComplete="off"
              className="tabular"
            />
          )}
        </Labelled>
      ) : null}
      <NoteField
        value={note}
        onChange={setNote}
        label={
          to === "delivery_failed" ? "What happened" : "Note for the history"
        }
      />
    </ConfirmDialog>
  );
}

/** Delivery method and tracking number of one order. */
export function OrderDeliveryDialog({
  order,
  open,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const [method, setMethod] = useState<DeliveryMethod | null>(null);
  const [tracking, setTracking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const currentMethod = method ?? order.delivery.method;
  const methodChanges = currentMethod !== order.delivery.method;
  // A tracking number belongs to its carrier: a new method starts without one.
  const trackingText =
    tracking ?? (methodChanges ? "" : (order.delivery.trackingNumber ?? ""));
  const trackingValid =
    trackingText.trim() === "" || TRACKING.test(trackingText.trim());
  const newTracking = trackingText.trim() || null;
  const trackingChanges = methodChanges
    ? newTracking !== null
    : newTracking !== order.delivery.trackingNumber;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setMethod(null);
          setTracking(null);
          setNote("");
        }
        onOpenChange(value);
      }}
      title={`Delivery of ${order.orderNumber}`}
      description="Radhe Foods chooses how an order is delivered; customers never do. Changing the method removes the tracking number."
      confirmLabel="Save delivery"
      canConfirm={trackingValid && (methodChanges || trackingChanges)}
      onConfirm={async () => {
        await actions.setDelivery.mutateAsync({
          ...(methodChanges ? { method: currentMethod } : {}),
          ...(trackingChanges ? { trackingNumber: newTracking } : {}),
          note: note.trim() || undefined,
        });
        notify.success("Delivery saved");
      }}
    >
      <Labelled label="Delivery method">
        {(id) => (
          <Select
            id={id}
            value={currentMethod}
            onChange={(event) => {
              setMethod(event.target.value as DeliveryMethod);
              setTracking(null);
            }}
          >
            {DELIVERY_METHODS.map((entry) => (
              <option key={entry} value={entry}>
                {DELIVERY_METHOD_LABEL[entry]}
              </option>
            ))}
          </Select>
        )}
      </Labelled>
      {currentMethod === "radhe_delivery" ? null : (
        <Labelled
          label="Tracking number"
          optional
          error={trackingValid ? null : "4 to 60 letters, digits or hyphens."}
        >
          {(id) => (
            <Input
              id={id}
              value={trackingText}
              onChange={(event) => setTracking(event.target.value)}
              aria-invalid={trackingValid ? undefined : true}
              autoComplete="off"
              className="tabular"
            />
          )}
        </Labelled>
      )}
      <NoteField value={note} onChange={setNote} />
    </ConfirmDialog>
  );
}

/** Gives the order to another cargo: number, items and bill stay. */
export function OrderMoveDialog({
  order,
  open,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const choices = useCargoChoices(open).data;
  const targets = (choices?.items ?? []).filter(
    (entry) =>
      entry.id !== order.cargo.id && CAN_TAKE_ORDERS.includes(entry.status),
  );
  const chosen = targets.find((entry) => entry.id === target);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setTarget("");
          setNote("");
        }
        onOpenChange(value);
      }}
      title={`Move ${order.orderNumber} to another cargo?`}
      description={
        order.status === "delivery_failed"
          ? "The order keeps its number, items and bill. In the new cargo it is confirmed again and delivered with that cargo. The customer is told the new delivery days."
          : "The order keeps its number, items and bill and gets the delivery days of the new cargo. The customer is told."
      }
      facts={[
        { label: "Now in", value: order.cargo.code },
        {
          label: "Promised",
          value: formatDayRange(
            order.delivery.promisedStart,
            order.delivery.promisedEnd,
          ),
        },
        ...(chosen
          ? [
              {
                label: `New delivery days (${chosen.code})`,
                value: formatDayRange(
                  chosen.delivery.start,
                  chosen.delivery.end,
                ),
                strong: true,
              },
            ]
          : []),
      ]}
      confirmLabel={chosen ? `Move to ${chosen.code}` : "Move the order"}
      canConfirm={target !== ""}
      onConfirm={async () => {
        await actions.move.mutateAsync({
          cargoId: target,
          note: note.trim() || undefined,
        });
        notify.success(
          `${order.orderNumber} moved to ${chosen?.code ?? "the cargo"}`,
        );
      }}
    >
      <Labelled label="Move to">
        {(id) => (
          <Select
            id={id}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">Choose a cargo</option>
            {targets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} · {entry.internalName} ·{" "}
                {humanize(entry.status).toLowerCase()}
              </option>
            ))}
          </Select>
        )}
      </Labelled>
      <NoteField value={note} onChange={setNote} />
    </ConfirmDialog>
  );
}

/** Cancels the order: the units go back to the cargo, the customer is told. */
export function OrderCancelDialog({
  order,
  open,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<AdminCancellationReason | "">("");
  const [text, setText] = useState("");

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setReason("");
          setText("");
        }
        onOpenChange(value);
      }}
      title={`Cancel ${order.orderNumber}?`}
      description="The order is cancelled for good. Its units go back to the cargo and the customer is told by email. The order and its history are kept."
      tone="danger"
      facts={[
        { label: "Customer", value: personName(order.customer) },
        { label: "Status", value: ORDER_STATUS[order.status].label },
        { label: "Order value", value: formatMoney(order.total), strong: true },
      ]}
      confirmLabel="Cancel the order"
      cancelLabel="Keep the order"
      canConfirm={reason !== ""}
      onConfirm={async () => {
        if (reason === "") return;
        await actions.cancel.mutateAsync({
          reason,
          text: text.trim() || undefined,
        });
        notify.success(`${order.orderNumber} cancelled`);
      }}
    >
      <Labelled label="Reason">
        {(id) => (
          <Select
            id={id}
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as AdminCancellationReason | "")
            }
          >
            <option value="">Choose a reason</option>
            {ADMIN_CANCELLATION_REASONS.map((entry) => (
              <option key={entry} value={entry}>
                {humanize(entry)}
              </option>
            ))}
          </Select>
        )}
      </Labelled>
      <NoteField
        value={text}
        onChange={setText}
        label="Details"
        maxLength={1000}
      />
    </ConfirmDialog>
  );
}

/** What the final bill would be when `delivered` units of an item were delivered. */
export function billAfterCorrection(
  order: Pick<OrderDetail, "items" | "finalTotals" | "totals">,
  item: OrderItem,
  delivered: number,
): { lineTotal: number; total: number; difference: number } {
  const lineTotal =
    Math.max(0, delivered - item.returnedQuantity) * item.unitPrice;
  const goods = order.items.reduce(
    (sum, entry) =>
      sum +
      (entry.productId === item.productId ? lineTotal : entry.finalLineTotal),
    0,
  );
  // The agreed delivery fee stays, and is 0 only when nothing was kept.
  const total = goods > 0 ? goods + order.totals.deliveryFee : 0;
  return { lineTotal, total, difference: total - order.finalTotals.total };
}

/** Corrects how many units of a product were really delivered. */
export function OrderItemDialog({
  order,
  item,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  item: OrderItem | null;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const [quantity, setQuantity] = useState<string | null>(null);
  const [reason, setReason] = useState<AdjustmentReason | "">("");
  const [note, setNote] = useState("");
  if (!item) return null;

  const text = quantity ?? String(item.deliveredQuantity);
  const delivered = /^\d{1,5}$/.test(text.trim()) ? Number(text) : Number.NaN;
  const inRange =
    delivered >= item.returnedQuantity && delivered <= item.quantity;
  const changes = inRange && delivered !== item.deliveredQuantity;
  const after = inRange ? billAfterCorrection(order, item, delivered) : null;
  const invoiced = order.payment.status !== "not_enabled";
  const name = `${translated(item.name)} ${item.packSize.label}`;

  return (
    <ConfirmDialog
      open
      onOpenChange={(value) => {
        if (!value) {
          setQuantity(null);
          setReason("");
          setNote("");
        }
        onOpenChange(value);
      }}
      title="Correct what was delivered"
      description={
        invoiced
          ? `${name}: the customer pays only for what arrived. An invoice exists already, so the difference becomes a credit note automatically.`
          : `${name}: the customer pays only for what arrived. The agreed bill stays as a record; the final bill follows the delivered units.`
      }
      facts={[
        { label: "Ordered", value: item.quantity },
        ...(item.returnedQuantity > 0
          ? [{ label: "Returned already", value: item.returnedQuantity }]
          : []),
        ...(after
          ? [
              {
                label: "Final bill",
                value:
                  after.difference === 0
                    ? formatMoney(after.total)
                    : `${formatMoney(order.finalTotals.total)} → ${formatMoney(after.total)}`,
                strong: true,
              },
            ]
          : []),
      ]}
      confirmLabel={
        after && after.difference < 0
          ? `Correct and lower the bill by ${formatMoney(-after.difference)}`
          : "Save the correction"
      }
      canConfirm={changes && reason !== ""}
      onConfirm={async () => {
        if (reason === "") return;
        await actions.adjustItem.mutateAsync({
          productId: item.productId,
          deliveredQuantity: delivered,
          reason,
          note: note.trim() || undefined,
        });
        notify.success("Delivered quantity corrected");
      }}
    >
      <Labelled
        label="Units delivered"
        error={
          inRange
            ? null
            : `Between ${item.returnedQuantity} and ${item.quantity}.`
        }
      >
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            value={text}
            onChange={(event) => setQuantity(event.target.value)}
            aria-invalid={inRange ? undefined : true}
            className="w-28 tabular"
          />
        )}
      </Labelled>
      <Labelled label="Reason">
        {(id) => (
          <Select
            id={id}
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as AdjustmentReason | "")
            }
          >
            <option value="">Choose a reason</option>
            {ADJUSTMENT_REASONS.map((entry) => (
              <option key={entry} value={entry}>
                {humanize(entry)}
              </option>
            ))}
          </Select>
        )}
      </Labelled>
      <NoteField
        value={note}
        onChange={setNote}
        label="Internal note"
        maxLength={1000}
      />
    </ConfirmDialog>
  );
}

export { Labelled, NoteField };
