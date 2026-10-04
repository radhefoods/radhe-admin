"use client";

import { useId, useState, type ReactNode } from "react";
import { useCargoOverview } from "@/components/shell/cargo-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox } from "@/components/ui/controls";
import { Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import type {
  Cargo,
  CargoStatus,
  Id,
  OrderStatus,
  OrderSummary,
} from "@/lib/api/types";
import { formatDayRange, formatDeadline } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/names";
import { CARGO_STATUS } from "@/lib/status";
import { CARGO_PATH, cargoActionLabel } from "@/lib/status/transitions";
import { ExcludeOrders } from "./exclude-orders";
import {
  CAN_TAKE_ORDERS,
  useCargoChoices,
  useCargoOrders,
  useCargoTransition,
  useOrderSummary,
} from "./queries";

/** The orders that follow the cargo when it starts delivering or is delivered (9.1). */
const FOLLOWS: Partial<
  Record<CargoStatus, { from: OrderStatus[]; becomes: string }>
> = {
  delivering: { from: ["confirmed", "preparing"], becomes: "dispatched" },
  delivered: { from: ["dispatched"], becomes: "delivered" },
};

type Fact = { label: ReactNode; value: ReactNode; strong?: boolean };

/**
 * One confirmation for every change of a cargo's status. It restates what
 * will happen with the real numbers of the cargo, because closing a cargo,
 * dispatching its orders or cancelling it cannot be done quietly.
 */
export function CargoTransitionDialog({
  cargo,
  to,
  onOpenChange,
}: {
  cargo: Cargo;
  /** The status to change to; `null` closes the dialog. */
  to: CargoStatus | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = to !== null;
  const noteId = useId();
  const targetId = useId();
  const nextId = useId();
  const [note, setNote] = useState("");
  const [excluded, setExcluded] = useState<Set<Id>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [openNext, setOpenNext] = useState(false);

  const transition = useCargoTransition();
  const summary = useOrderSummary(open ? cargo.id : undefined).data;
  const overview = useCargoOverview().data;
  const follows = to ? FOLLOWS[to] : undefined;
  const cancelling = to === "cancelled";
  const liveOrders = summary?.orders ?? 0;

  const cargoOrders = useCargoOrders(cargo.id, open && Boolean(follows)).data;
  const choices = useCargoChoices(open && cancelling && liveOrders > 0).data;

  if (!to) return null;

  const affected: OrderSummary[] = follows
    ? (cargoOrders?.orders ?? []).filter((order) =>
        follows.from.includes(order.status),
      )
    : [];
  const included = affected.filter((order) => !excluded.has(order.id));

  const other =
    to === "taking_orders" &&
    overview?.current &&
    overview.current.id !== cargo.id
      ? overview.current
      : null;
  const next =
    to === "orders_closed" && cargo.status === "taking_orders"
      ? overview?.next
      : null;
  const back =
    CARGO_PATH.indexOf(to as (typeof CARGO_PATH)[number]) !== -1 &&
    CARGO_PATH.indexOf(to as (typeof CARGO_PATH)[number]) <
      CARGO_PATH.indexOf(cargo.status as (typeof CARGO_PATH)[number]) &&
    !(to === "taking_orders");

  const deliveryWindow = formatDayRange(
    cargo.delivery.start,
    cargo.delivery.end,
  );
  const numbers: Fact[] = summary
    ? [
        {
          label: "Orders",
          value:
            summary.cancelledOrders > 0
              ? `${summary.orders} (and ${summary.cancelledOrders} cancelled)`
              : summary.orders,
        },
        { label: "Customers", value: summary.customers },
        {
          label: "Booked value",
          value: formatMoney(summary.bookedValue),
          strong: true,
        },
      ]
    : [];

  let title: string;
  let description: ReactNode;
  let facts: Fact[] = [];
  let confirmLabel = cargoActionLabel(cargo.status, to);
  let warning: ReactNode = null;

  if (back) {
    title = `Take ${cargo.code} back to "${CARGO_STATUS[to].label.toLowerCase()}"?`;
    description =
      "A correction of a step taken by mistake. Only the status of the cargo changes; its orders keep theirs.";
  } else if (to === "scheduled") {
    title = `Schedule ${cargo.code}?`;
    description =
      "The cargo opens by itself at its opening time and closes at its deadline.";
    facts = [
      { label: "Opens", value: formatDeadline(cargo.orderOpenAt) },
      {
        label: "Deadline",
        value: (
          <span className="text-gold">
            {formatDeadline(cargo.orderCloseAt)}
          </span>
        ),
      },
      { label: "Products enabled", value: cargo.products.enabled },
    ];
  } else if (to === "taking_orders") {
    title = other
      ? `Close ${other.code} and open ${cargo.code}?`
      : cargo.status === "orders_closed"
        ? `Open ordering for ${cargo.code} again?`
        : `Open ordering for ${cargo.code}?`;
    description = other
      ? `Ordering moves to this cargo in one step. ${other.code} takes no more orders; every new order belongs to ${cargo.code}.`
      : "Customers can order from now on. Every new order belongs to this cargo.";
    facts = [
      ...(other ? [{ label: "Closes", value: other.code }] : []),
      {
        label: "Order deadline",
        value: (
          <span className="text-gold">
            {formatDeadline(cargo.orderCloseAt)}
          </span>
        ),
      },
      { label: "Delivery", value: deliveryWindow },
      { label: "Products enabled", value: cargo.products.enabled },
    ];
    confirmLabel = other
      ? `Close ${other.code}, open ${cargo.code}`
      : confirmLabel;
    if (cargo.products.enabled === 0) {
      warning = (
        <Alert tone="warning" title="No product is enabled in this cargo">
          Customers could order nothing. Enable products first (tab Products).
        </Alert>
      );
    }
  } else if (to === "orders_closed") {
    title = `Close ordering for ${cargo.code}?`;
    description =
      "Customers can no longer order in this cargo. The orders it has stay as they are.";
    facts = numbers;
  } else if (to === "in_transit") {
    title = `Mark ${cargo.code} as in transit?`;
    description = "The goods are on their way. Nothing changes for the orders.";
  } else if (to === "arrived") {
    title = `Mark ${cargo.code} as arrived?`;
    description = "The goods are here. Delivering to the customers comes next.";
  } else if (to === "delivering") {
    title = `Start delivering ${cargo.code}?`;
    description =
      "Orders that are confirmed or preparing become dispatched, and each of these customers is told that the order is on its way.";
    facts = [
      { label: "Orders to dispatch", value: included.length, strong: true },
      { label: "Customers notified", value: included.length },
      { label: "Delivery window", value: deliveryWindow },
    ];
    confirmLabel = `Dispatch ${plural(included.length, "order")}`;
  } else if (to === "delivered") {
    title = `Mark ${cargo.code} as delivered?`;
    description =
      "Dispatched orders become delivered, and each of these customers is told. Orders whose delivery failed stay as they are. Payment can be activated afterwards.";
    facts = [
      {
        label: "Orders to mark delivered",
        value: included.length,
        strong: true,
      },
      { label: "Customers notified", value: included.length },
    ];
    confirmLabel = `Mark ${plural(included.length, "order")} delivered`;
  } else {
    title = `Cancel ${cargo.code}?`;
    description =
      liveOrders > 0
        ? "The cargo is cancelled for good. Its orders are not cancelled: they move, with their items and bills, to the cargo you name, and each customer is told the new delivery days."
        : "The cargo is cancelled for good and cannot be opened again. It has no orders.";
    facts = liveOrders > 0 ? numbers : [];
    confirmLabel =
      liveOrders > 0
        ? `Cancel and move ${plural(liveOrders, "order")}`
        : "Cancel cargo";
  }

  const targets = (choices?.items ?? []).filter(
    (entry) => entry.id !== cargo.id && CAN_TAKE_ORDERS.includes(entry.status),
  );
  const needsTarget = cancelling && liveOrders > 0;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setNote("");
          setExcluded(new Set());
          setMoveTo("");
          setOpenNext(false);
        }
        onOpenChange(value);
      }}
      title={title}
      description={description}
      facts={facts}
      tone={cancelling ? "danger" : "primary"}
      requireText={cancelling ? cargo.code : undefined}
      canConfirm={!needsTarget || moveTo !== ""}
      confirmLabel={confirmLabel}
      cancelLabel={cancelling ? "Keep the cargo" : "Not now"}
      onConfirm={async () => {
        const result = await transition.mutateAsync({
          cargo,
          to,
          note: note.trim() || undefined,
          excludeOrderIds: follows ? [...excluded] : undefined,
          moveOrdersToCargoId: needsTarget ? moveTo : undefined,
          rollover: Boolean(other),
          openNextCargoId: openNext && next ? next.id : undefined,
        });
        const moved = result.ordersMoved ?? 0;
        notify.success(
          result.changed
            ? `${cargo.code} is now ${CARGO_STATUS[to].label.toLowerCase()}`
            : `${cargo.code} already was ${CARGO_STATUS[to].label.toLowerCase()}`,
          moved > 0 ? `${plural(moved, "order")} moved.` : undefined,
        );
      }}
    >
      {warning}

      {follows ? (
        <ExcludeOrders
          orders={affected}
          excluded={excluded}
          onChange={setExcluded}
          action={follows.becomes}
        />
      ) : null}

      {next ? (
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={nextId}
            checked={openNext}
            onCheckedChange={(checked) => setOpenNext(checked === true)}
            className="mt-0.5"
          />
          <label htmlFor={nextId} className="text-sm text-ink">
            Open {next.code} at once
            <span className="block text-13 text-ink-muted">
              Otherwise it opens by itself on {formatDeadline(next.orderOpenAt)}
              .
            </span>
          </label>
        </div>
      ) : null}

      {needsTarget ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={targetId} className="text-13 font-medium text-ink">
            Move the orders to
          </label>
          <Select
            id={targetId}
            value={moveTo}
            onChange={(event) => setMoveTo(event.target.value)}
          >
            <option value="">Choose a cargo</option>
            {targets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} · {entry.internalName} · delivery{" "}
                {formatDayRange(entry.delivery.start, entry.delivery.end)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-13 font-medium text-ink">
          Note for the history
          <span className="ml-1.5 font-normal text-ink-subtle">optional</span>
        </label>
        <Textarea
          id={noteId}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-0"
        />
      </div>
    </ConfirmDialog>
  );
}
