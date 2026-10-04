"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import { RequirePermission } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Money, TwoLine } from "@/components/domain/values";
import { PageBody, PageHeader } from "@/components/shell/page";
import { EmptyState } from "@/components/ui/surface";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { RETURN_STATUSES, type Id, type OrderReturn } from "@/lib/api/types";
import { plural } from "@/lib/format/names";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { RETURN_STATUS, humanize, statusOptions } from "@/lib/status";

const ORDER_NUMBER = /^(?:rf[\s-]?|#)?(\d{3,9})(?:-r\d+)?$/i;

const columns: Column<OrderReturn>[] = [
  {
    id: "return",
    header: "Return",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.return(row.original.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            {row.original.returnNumber}
          </Link>
        }
        secondary={<DateTime value={row.original.requestedAt} short />}
      />
    ),
    meta: { skeleton: "w-28" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge kind="return" value={row.original.status} />
    ),
  },
  {
    id: "items",
    header: "What",
    cell: ({ row }) => {
      const [first, ...rest] = row.original.items;
      const units = row.original.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      return (
        <TwoLine
          primary={
            first
              ? `${first.name.en} ${first.packSize.label}${rest.length > 0 ? ` and ${rest.length} more` : ""}`
              : "—"
          }
          secondary={`${plural(units, "unit")}, ${humanize(first?.reason ?? "other").toLowerCase()}`}
        />
      );
    },
    meta: { from: "md", className: "max-w-72", skeleton: "w-44" },
  },
  {
    id: "order",
    header: "Order",
    cell: ({ row }) => (
      <Link
        href={routes.order(row.original.orderId)}
        className="hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
    meta: { from: "sm", skeleton: "w-16" },
  },
  {
    id: "amount",
    header: "Value",
    cell: ({ row }) => (
      <Money
        cents={row.original.creditAmount ?? row.original.requestedAmount}
      />
    ),
    meta: { align: "right", skeleton: "w-14" },
  },
];

export function ReturnsView() {
  const [state, setState, clear] = useUrlState({
    status: param.oneOf(RETURN_STATUSES),
    q: param.text(20),
    orderNumber: param.text(20),
    customerId: param.id(),
  });
  const text = state.q || state.orderNumber;
  const number = ORDER_NUMBER.exec(text.trim());
  const understood = text.trim() === "" || number !== null;
  const query = {
    status: state.status,
    orderNumber: number ? `RF-${number[1]}` : undefined,
    customerId: state.customerId,
  };
  const returns = useInfiniteQuery({
    queryKey: queryKeys.returns.list(query),
    queryFn: ({ pageParam, signal }) =>
      api.returns.list({ ...query, limit: 25, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: understood,
  });
  const rows = returns.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(state.status || text || state.customerId);

  return (
    <RequirePermission permission="orders.read">
      <PageHeader
        title="Returns"
        description="Customers ask to send single products back after delivery. You approve (also fewer units) or decline, and complete the return once the goods are back: that lowers the bill."
      />
      <PageBody>
        <div className="flex flex-col gap-3">
          <FilterBar active={filtered} onClear={clear}>
            <SearchField
              label="Returns of an order"
              placeholder="Order number, RF-1084"
              value={text}
              onChange={(q) => setState({ q, orderNumber: "" })}
            />
            <FilterSelect
              label="Status"
              value={state.status}
              options={statusOptions(RETURN_STATUS)}
              onChange={(status) => setState({ status })}
            />
          </FilterBar>
          <DataTable
            caption="Returns, newest first"
            columns={columns}
            data={understood ? rows : []}
            getRowId={(entry) => entry.id}
            refreshing={
              returns.isFetching && !returns.isFetchingNextPage && Boolean(rows)
            }
            error={returns.error}
            onRetry={() => void returns.refetch()}
            rowHref={(entry) => routes.return(entry.id)}
            empty={
              <EmptyState
                icon={<Undo2 />}
                title={
                  !understood
                    ? "This is not an order number"
                    : filtered
                      ? "No return matches"
                      : "No returns yet"
                }
              >
                {!understood
                  ? "Returns are found by the number of their order, like RF-1084."
                  : state.status === "requested"
                    ? "No return waits for a decision."
                    : filtered
                      ? "Change the filters or clear them."
                      : "A customer can ask for a return on a delivered order, within the return window of the settings."}
              </EmptyState>
            }
            footer={
              <LoadMore
                shown={rows?.length ?? 0}
                noun="return"
                hasMore={returns.hasNextPage}
                loading={returns.isFetchingNextPage}
                onLoadMore={() => void returns.fetchNextPage()}
              />
            }
          />
        </div>
      </PageBody>
    </RequirePermission>
  );
}
