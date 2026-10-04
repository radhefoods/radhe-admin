"use client";

import { ShoppingBag, X } from "lucide-react";
import { DataTable } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import { EmptyState } from "@/components/ui/surface";
import { useCargoChoices } from "@/features/cargos/queries";
import {
  DELIVERY_METHODS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { DELIVERY_METHOD_LABEL } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { ORDER_STATUS, PAYMENT_STATUS, statusOptions } from "@/lib/status";
import { OrderCard, orderColumns } from "./order-columns";
import { useOrders } from "./queries";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ORDER_NUMBER = /^(?:rf[\s-]?|#)?(\d{3,9})$/i;

/**
 * What the search field means for the API (documentation, 10): an order is
 * found by its exact number or by the customer's full email. There is no
 * search by name or by a part of either.
 */
export function readOrderSearch(text: string): {
  orderNumber?: string;
  email?: string;
  understood: boolean;
} {
  const value = text.trim();
  if (value === "") return { understood: true };
  const number = ORDER_NUMBER.exec(value);
  if (number) return { orderNumber: `RF-${number[1]}`, understood: true };
  if (EMAIL.test(value))
    return { email: value.toLowerCase(), understood: true };
  return { understood: false };
}

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
 * payment status, delivery method, and the search by number or email. The
 * filters live in the address, so a view can be bookmarked and linked to.
 */
export function OrdersList({
  fixed,
  hide = [],
  caption = "Orders, newest first",
}: OrdersListProps) {
  const can = useCan();
  const [state, setState, clear] = useUrlState({
    q: param.text(254),
    cargoId: param.id(),
    customerId: param.id(),
    status: param.oneOf(ORDER_STATUSES),
    paymentStatus: param.oneOf(PAYMENT_STATUSES),
    deliveryMethod: param.oneOf(DELIVERY_METHODS),
    // Links from other pages name the order directly.
    orderNumber: param.text(20),
  });
  const search = readOrderSearch(state.q || state.orderNumber);
  const query = {
    cargoId: state.cargoId,
    customerId: state.customerId,
    status: fixed?.status ?? state.status,
    paymentStatus: fixed?.paymentStatus ?? state.paymentStatus,
    deliveryMethod: state.deliveryMethod,
    orderNumber: search.orderNumber,
    email: search.email,
  };
  const orders = useOrders(query, search.understood);
  const cargos = useCargoChoices(can("cargos.read")).data;
  const rows = orders.data?.pages.flatMap((page) => page.items);
  const cargo = cargos?.items.find((entry) => entry.id === state.cargoId);
  const filtered = Boolean(
    state.q ||
    state.orderNumber ||
    state.cargoId ||
    state.customerId ||
    state.status ||
    state.paymentStatus ||
    state.deliveryMethod,
  );

  return (
    <div className="flex flex-col gap-3">
      <FilterBar active={filtered} onClear={clear}>
        <SearchField
          label="Find an order"
          placeholder="RF-1084 or the customer's email"
          value={state.q || state.orderNumber}
          onChange={(q) => setState({ q, orderNumber: "" })}
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
        {state.customerId ? (
          <Chip
            label="One customer"
            onRemove={() => setState({ customerId: undefined })}
          />
        ) : null}
      </FilterBar>

      {!search.understood ? (
        <div className="rounded-lg border border-line">
          <EmptyState
            icon={<ShoppingBag />}
            title="This is neither an order number nor an email"
          >
            The API finds an order by its exact number (RF-1084) or by the
            customer&apos;s full email address. It has no search by name.
          </EmptyState>
        </div>
      ) : (
        <DataTable
          caption={cargo ? `${caption}, cargo ${cargo.code}` : caption}
          columns={columns}
          data={rows}
          getRowId={(order) => order.id}
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
              {search.orderNumber
                ? `There is no order ${search.orderNumber}.`
                : search.email
                  ? `No customer with the email ${search.email} has ordered.`
                  : filtered
                    ? "Change the filters or clear them."
                    : "Orders appear here as soon as customers confirm a pre-order in an open cargo."}
            </EmptyState>
          }
          footer={
            <LoadMore
              shown={rows?.length ?? 0}
              noun="order"
              hasMore={orders.hasNextPage}
              loading={orders.isFetchingNextPage}
              onLoadMore={() => void orders.fetchNextPage()}
            />
          }
        />
      )}
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
