"use client";

import { ShoppingBag, X } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
  SortSelect,
  type SortOption,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/surface";
import { useCargoChoices } from "@/features/cargos/queries";
import {
  DELIVERY_METHODS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type Id,
  type OrderQuery,
  type OrderSortField,
  type OrderStatus,
  type PaymentStatus,
  type SortParam,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { DELIVERY_METHOD_LABEL } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { ORDER_STATUS, PAYMENT_STATUS, statusOptions } from "@/lib/status";
import { OrderCard, orderColumns } from "./order-columns";
import { OrdersBulkBar } from "./orders-bulk";
import { useOrderCount, useOrders } from "./queries";

/** The orders of the list the API offers (10). */
export const ORDER_SORTS: readonly SortOption<SortParam<OrderSortField>>[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "total:desc", label: "Highest bill first" },
  { value: "total:asc", label: "Lowest bill first" },
  { value: "status:asc", label: "By status" },
  { value: "paymentStatus:asc", label: "By payment status" },
];
const SORT_VALUES = ORDER_SORTS.map((option) => option.value);

const columns = orderColumns();

export interface OrdersListProps {
  /** A filter the page fixes (the payments page fixes the payment status). */
  fixed?: { status?: OrderStatus; paymentStatus?: PaymentStatus };
  /** Hides the filters the page fixes. */
  hide?: ("status" | "paymentStatus")[];
  caption?: string;
}

/**
 * The list of orders with exactly the filters of the API: cargo, status,
 * payment status, delivery method, the search by words of the number, the
 * customer's name, email or phone (`q`), and the sort. The filters live in
 * the address, so a view can be bookmarked and linked to.
 */
export function OrdersList({
  fixed,
  hide = [],
  caption = "Orders",
}: OrdersListProps) {
  const can = useCan();
  const [state, setState, clear] = useUrlState({
    q: param.text(100),
    sort: param.oneOf(SORT_VALUES),
    cargoId: param.id(),
    customerId: param.id(),
    status: param.oneOf(ORDER_STATUSES),
    paymentStatus: param.oneOf(PAYMENT_STATUSES),
    deliveryMethod: param.oneOf(DELIVERY_METHODS),
    // Links from other pages name the order directly.
    orderNumber: param.text(20),
  });
  const q = state.q.trim() || undefined;
  const query: Omit<OrderQuery, "cursor" | "limit"> = {
    cargoId: state.cargoId,
    customerId: state.customerId,
    status: fixed?.status ?? state.status,
    paymentStatus: fixed?.paymentStatus ?? state.paymentStatus,
    deliveryMethod: state.deliveryMethod,
    orderNumber: q ? undefined : state.orderNumber.trim() || undefined,
    q,
    sort: state.sort,
  };
  const orders = useOrders(query);
  const count = useOrderCount(query);
  // The orders ticked for an action on all of them at once (10).
  const [selected, setSelected] = useState<Set<Id>>(new Set());
  const manage = can("orders.manage");
  const cargos = useCargoChoices(can("cargos.read")).data;
  const rows = orders.data?.pages.flatMap((page) => page.items);
  const cargo = cargos?.items.find((entry) => entry.id === state.cargoId);
  const filtered = Boolean(
    q ||
    state.orderNumber ||
    state.cargoId ||
    state.customerId ||
    state.status ||
    state.paymentStatus ||
    state.deliveryMethod,
  );
  const sortLabel =
    ORDER_SORTS.find((option) => option.value === state.sort)?.label ??
    "newest first";

  return (
    <div className="flex flex-col gap-3">
      <FilterBar active={filtered || Boolean(state.sort)} onClear={clear}>
        <SearchField
          label="Find orders"
          placeholder="Order number, customer name, email or phone"
          value={state.q || state.orderNumber}
          onChange={(value) => setState({ q: value, orderNumber: "" })}
        />
        {cargos ? (
          <FilterSelect
            label="Cargo"
            value={state.cargoId}
            options={cargos.items.map((entry) => ({
              value: entry.id,
              label: entry.code,
            }))}
            onChange={(cargoId) => setState({ cargoId })}
          />
        ) : state.cargoId ? (
          <Chip
            label="One cargo"
            onRemove={() => setState({ cargoId: undefined })}
          />
        ) : null}
        {hide.includes("status") ? null : (
          <FilterSelect
            label="Status"
            value={state.status}
            options={statusOptions(ORDER_STATUS)}
            onChange={(status) => setState({ status })}
          />
        )}
        {hide.includes("paymentStatus") ? null : (
          <FilterSelect
            label="Payment"
            value={state.paymentStatus}
            options={statusOptions(PAYMENT_STATUS)}
            onChange={(paymentStatus) => setState({ paymentStatus })}
          />
        )}
        <FilterSelect
          label="Delivery"
          value={state.deliveryMethod}
          options={DELIVERY_METHODS.map((method) => ({
            value: method,
            label: DELIVERY_METHOD_LABEL[method],
          }))}
          onChange={(deliveryMethod) => setState({ deliveryMethod })}
        />
        <SortSelect
          value={state.sort}
          options={ORDER_SORTS}
          onChange={(sort) => setState({ sort })}
        />
        {state.customerId ? (
          <Chip
            label="One customer"
            onRemove={() => setState({ customerId: undefined })}
          />
        ) : null}
      </FilterBar>

      {manage ? (
        <OrdersBulkBar
          orders={rows ?? []}
          selected={selected}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      <DataTable
        caption={`${caption}, ${sortLabel.toLowerCase()}${cargo ? `, cargo ${cargo.code}` : ""}`}
        columns={columns}
        data={rows}
        getRowId={(order) => order.id}
        selection={
          manage
            ? {
                selected,
                onChange: setSelected,
                label: (order) => `Choose ${order.orderNumber}`,
              }
            : undefined
        }
        refreshing={
          orders.isFetching && !orders.isFetchingNextPage && Boolean(rows)
        }
        error={orders.error}
        onRetry={() => void orders.refetch()}
        rowHref={(order) => routes.order(order.id)}
        card={(order) => <OrderCard order={order} />}
        empty={
          <EmptyState
            icon={<ShoppingBag />}
            title={filtered ? "No order matches" : "No orders yet"}
          >
            {query.orderNumber
              ? `There is no order ${query.orderNumber}.`
              : q
                ? `Nothing matches "${q}". The search looks at the order number and at the customer's name, email and phone; every word must begin one of them.`
                : filtered
                  ? "Change the filters or clear them."
                  : "Orders appear here as soon as customers confirm a pre-order in an open cargo."}
          </EmptyState>
        }
        footer={
          <LoadMore
            shown={rows?.length ?? 0}
            total={count.data?.total}
            noun="order"
            hasMore={orders.hasNextPage}
            loading={orders.isFetchingNextPage}
            onLoadMore={() => void orders.fetchNextPage()}
          />
        }
      />
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex h-8 items-center gap-1 rounded-md bg-accent-soft pr-1 pl-2.5 text-13 font-semibold text-accent-text">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove the filter: ${label}`}
        className="flex size-5 items-center justify-center rounded-sm hover:bg-planned-bg"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}
