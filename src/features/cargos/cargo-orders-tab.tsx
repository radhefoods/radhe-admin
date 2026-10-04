"use client";

import { useMutation } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { DataTable } from "@/components/data/data-table";
import { FilterBar, FilterSelect } from "@/components/data/filter-bar";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, Textarea } from "@/components/ui/input";
import { Alert, EmptyState } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { OrderCard, orderColumns } from "@/features/orders/order-columns";
import { api } from "@/lib/api/client";
import { invalidation } from "@/lib/api/query-keys";
import {
  DELIVERY_METHODS,
  ORDER_STATUSES,
  type BulkOrderStatus,
  type DeliveryMethod,
  type Id,
  type OrderStatus,
  type OrderSummary,
} from "@/lib/api/types";
import { formatDayRange } from "@/lib/format/dates";
import { DELIVERY_METHOD_LABEL, plural } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { ORDER_STATUS, statusOptions } from "@/lib/status";
import { ORDER_MOVABLE_IN } from "@/lib/status/transitions";
import { useCurrentCargo } from "./cargo-frame";
import { CAN_TAKE_ORDERS, useCargoChoices, useCargoOrders } from "./queries";

/** From which statuses a bulk status change takes orders (documentation, 9.4). */
const BULK_FROM: Record<BulkOrderStatus, OrderStatus[]> = {
  preparing: ["confirmed"],
  dispatched: ["confirmed", "preparing"],
  delivered: ["dispatched"],
};
const BULK_LABEL: Record<BulkOrderStatus, string> = {
  preparing: "Mark preparing",
  dispatched: "Mark dispatched",
  delivered: "Mark delivered",
};
/** The method can change until an order is delivered, cancelled or returned. */
const METHOD_LOCKED: OrderStatus[] = ["delivered", "cancelled", "returned"];

type Action =
  | { kind: "status"; status: BulkOrderStatus }
  | { kind: "method" }
  | { kind: "move" };

const columns = orderColumns({ cargo: false });

export function CargoOrdersTab() {
  const cargo = useCurrentCargo();
  const cargoId = cargo?.id ?? "";
  const noteId = useId();
  const pickId = useId();
  const [state, setState, clear] = useUrlState({
    status: param.oneOf(ORDER_STATUSES),
  });
  const orders = useCargoOrders(cargoId, Boolean(cargo));
  // The API's bulk actions take every order of the cargo except the ones
  // named: the rows are all ticked, and unticking leaves an order out.
  const [excluded, setExcluded] = useState<Set<Id>>(new Set());
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<DeliveryMethod>("radhe_delivery");
  const [target, setTarget] = useState("");
  const choices = useCargoChoices(action?.kind === "move").data;

  const all = useMemo(() => orders.data?.orders ?? [], [orders.data]);
  const shown = state.status
    ? all.filter((order) => order.status === state.status)
    : all;
  const included = (order: OrderSummary) => !excluded.has(order.id);
  const affected = (from: OrderStatus[]) =>
    all.filter((order) => from.includes(order.status) && included(order));
  const methodOrders = all.filter(
    (order) =>
      !METHOD_LOCKED.includes(order.status) &&
      included(order) &&
      order.delivery.method !== method,
  );
  const movable = all.filter((order) =>
    ORDER_MOVABLE_IN.includes(order.status),
  );
  const excludeOrderIds = [...excluded].filter((id) =>
    all.some((order) => order.id === id),
  );

  const run = useMutation({
    meta: { invalidates: invalidation.order, silent: true },
    mutationFn: async (current: Action) => {
      const shared = { excludeOrderIds, note: note.trim() || undefined };
      if (current.kind === "status") {
        const result = await api.cargos.setOrdersStatus(cargoId, {
          status: current.status,
          ...shared,
        });
        return `${plural(result.changed, "order")} now ${ORDER_STATUS[result.status].label.toLowerCase()}`;
      }
      if (current.kind === "method") {
        const result = await api.cargos.setOrdersDeliveryMethod(cargoId, {
          method,
          ...shared,
        });
        return `${plural(result.changed, "order")} now with ${DELIVERY_METHOD_LABEL[result.method]}`;
      }
      const result = await api.cargos.moveOrders(cargoId, {
        toCargoId: target,
        note: shared.note,
      });
      return `${plural(result.moved, "order")} moved to ${result.to}`;
    },
  });

  if (!cargo) return null;

  const counts = new Map<OrderStatus, number>();
  for (const order of all)
    counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
  const targets = (choices?.items ?? []).filter(
    (entry) => entry.id !== cargo.id && CAN_TAKE_ORDERS.includes(entry.status),
  );
  const chosenTarget = targets.find((entry) => entry.id === target);
  const leftOut = excludeOrderIds.length;

  let dialog: {
    title: string;
    description: string;
    facts: { label: string; value: string | number; strong?: boolean }[];
    confirmLabel: string;
    canConfirm: boolean;
  } | null = null;
  if (action?.kind === "status") {
    const rows = affected(BULK_FROM[action.status]);
    const label = ORDER_STATUS[action.status].label.toLowerCase();
    dialog = {
      title: `${BULK_LABEL[action.status]}: ${plural(rows.length, "order")}?`,
      description:
        action.status === "preparing"
          ? "Confirmed orders become preparing. Customers are not told about this step."
          : `Each of these customers is told that the order is ${label === "dispatched" ? "on its way" : "delivered"}.`,
      facts: [
        {
          label: `Orders that become ${label}`,
          value: rows.length,
          strong: true,
        },
        {
          label: "Taken from",
          value: BULK_FROM[action.status]
            .map((status) => ORDER_STATUS[status].label.toLowerCase())
            .join(", "),
        },
        ...(leftOut > 0
          ? [{ label: "Left out by you", value: plural(leftOut, "order") }]
          : []),
      ],
      confirmLabel: `${BULK_LABEL[action.status]} (${rows.length})`,
      canConfirm: rows.length > 0,
    };
  } else if (action?.kind === "method") {
    dialog = {
      title: "Set the delivery method",
      description:
        "Applies to every order that is not delivered, cancelled or returned. An order whose method changes loses its tracking number.",
      facts: [
        {
          label: "Orders that change",
          value: methodOrders.length,
          strong: true,
        },
        ...(leftOut > 0
          ? [{ label: "Left out by you", value: plural(leftOut, "order") }]
          : []),
      ],
      confirmLabel: `Set ${DELIVERY_METHOD_LABEL[method]} for ${plural(methodOrders.length, "order")}`,
      canConfirm: methodOrders.length > 0,
    };
  } else if (action?.kind === "move") {
    dialog = {
      title: `Move the orders of ${cargo.code}?`,
      description:
        "Every order that is not on its way yet moves to the cargo you choose, with its number, items and bill. Each customer is told the new delivery days. This action takes all movable orders; move a single order on its own page.",
      facts: [
        { label: "Orders that move", value: movable.length, strong: true },
        ...(chosenTarget
          ? [
              {
                label: "New delivery days",
                value: formatDayRange(
                  chosenTarget.delivery.start,
                  chosenTarget.delivery.end,
                ),
              },
            ]
          : []),
      ],
      confirmLabel: chosenTarget
        ? `Move ${plural(movable.length, "order")} to ${chosenTarget.code}`
        : "Move the orders",
      canConfirm: movable.length > 0 && target !== "",
    };
  }

  return (
    <RequirePermission permission="orders.read">
      {orders.data && !orders.data.complete ? (
        <Alert tone="warning" title="This cargo has more than 2,000 orders">
          The list shows the newest 2,000. A bulk action still applies to all of
          them; the others cannot be left out here.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar active={Boolean(state.status)} onClear={clear}>
          <FilterSelect
            label="Status"
            value={state.status}
            options={statusOptions(ORDER_STATUS)
              .filter((option) => counts.has(option.value))
              .map((option) => ({
                ...option,
                label: `${option.label} (${counts.get(option.value)})`,
              }))}
            onChange={(status) => setState({ status })}
          />
          {leftOut > 0 ? (
            <button
              type="button"
              onClick={() => setExcluded(new Set())}
              className="h-8 rounded-md bg-attention-bg px-2.5 text-13 font-medium text-attention-fg"
            >
              {plural(leftOut, "order")} left out of bulk actions · include all
            </button>
          ) : null}
        </FilterBar>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            permission="orders.manage"
            blocked={
              movable.length === 0
                ? "No order of this cargo can be moved."
                : null
            }
            onClick={() => setAction({ kind: "move" })}
          >
            Move to another cargo
          </ActionButton>
          <ActionButton
            permission="orders.manage"
            onClick={() => setAction({ kind: "method" })}
          >
            Delivery method
          </ActionButton>
          {(["preparing", "dispatched", "delivered"] as const).map((status) => {
            const count = affected(BULK_FROM[status]).length;
            return (
              <ActionButton
                key={status}
                permission="orders.manage"
                variant={
                  status === "delivered" && count > 0 ? "primary" : "secondary"
                }
                blocked={
                  count === 0
                    ? `No ticked order is ${BULK_FROM[status].map((from) => ORDER_STATUS[from].label.toLowerCase()).join(" or ")}.`
                    : null
                }
                onClick={() => setAction({ kind: "status", status })}
              >
                {BULK_LABEL[status]}
                {count > 0 ? (
                  <span className="font-normal tabular">{count}</span>
                ) : null}
              </ActionButton>
            );
          })}
        </div>
      </div>

      <DataTable
        caption={`Orders of ${cargo.code}`}
        columns={columns}
        data={orders.data ? shown : undefined}
        getRowId={(order) => order.id}
        error={orders.error}
        onRetry={() => void orders.refetch()}
        rowHref={(order) => routes.order(order.id)}
        card={(order) => <OrderCard order={order} />}
        selection={{
          selected: new Set(shown.filter(included).map((order) => order.id)),
          onChange: (selected) => {
            const next = new Set(excluded);
            for (const order of shown) {
              if (selected.has(order.id)) next.delete(order.id);
              else next.add(order.id);
            }
            setExcluded(next);
          },
          label: (order) => `Include ${order.orderNumber} in bulk actions`,
          inverse: true,
        }}
        empty={
          <EmptyState
            icon={<ShoppingBag />}
            title={
              state.status
                ? "No order has this status"
                : "This cargo has no orders"
            }
          >
            {state.status
              ? "Choose another status or clear the filter."
              : cargo.status === "taking_orders"
                ? "Orders arrive here as customers confirm them."
                : "Orders can only be placed while a cargo takes orders."}
          </EmptyState>
        }
        footer={
          orders.data && all.length > 0 ? (
            <p className="text-13 text-ink-muted tabular" aria-live="polite">
              {state.status ? `${shown.length} of ` : ""}
              {plural(all.length, "order")} in {cargo.code}
            </p>
          ) : null
        }
      />

      {dialog && action ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setAction(null);
              setNote("");
              setTarget("");
            }
          }}
          title={dialog.title}
          description={dialog.description}
          facts={dialog.facts}
          confirmLabel={dialog.confirmLabel}
          canConfirm={dialog.canConfirm}
          onConfirm={async () => {
            notify.success(await run.mutateAsync(action));
          }}
        >
          {action.kind === "method" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={pickId} className="text-13 font-medium text-ink">
                Delivery method
              </label>
              <Select
                id={pickId}
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as DeliveryMethod)
                }
              >
                {DELIVERY_METHODS.map((entry) => (
                  <option key={entry} value={entry}>
                    {DELIVERY_METHOD_LABEL[entry]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {action.kind === "move" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={pickId} className="text-13 font-medium text-ink">
                Move to
              </label>
              <Select
                id={pickId}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Choose a cargo</option>
                {targets.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code} · {entry.internalName}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={noteId} className="text-13 font-medium text-ink">
              Note for the history
              <span className="ml-1.5 font-normal text-ink-subtle">
                optional
              </span>
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
      ) : null}
    </RequirePermission>
  );
}
