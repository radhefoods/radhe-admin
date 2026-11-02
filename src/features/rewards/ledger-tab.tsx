"use client";

import { Coins } from "lucide-react";
import { DataTable } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
  SortSelect,
  type SortOption,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import { CustomerName } from "@/components/domain/customer";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/surface";
import { useRecordName } from "@/features/notifications/queries";
import { errorMessage } from "@/lib/api/error-text";
import {
  REWARD_TRANSACTION_TYPES,
  type RewardTransactionSortField,
  type SortParam,
} from "@/lib/api/types";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { useRewardTransactionCount, useRewardTransactions } from "./queries";
import { REWARD_TYPE_LABEL } from "./rules";
import { TransactionCard, transactionColumns } from "./transaction-columns";

/** An order number, with or without its prefix. */
const ORDER_NUMBER = /^(?:rf[\s-]?|#)?(\d{3,9})$/i;

/** The orders of the list the API offers (30). */
const SORTS: readonly SortOption<SortParam<RewardTransactionSortField>>[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "type:asc", label: "By type" },
];
const SORT_VALUES = SORTS.map((option) => option.value);
const TYPE_OPTIONS = REWARD_TRANSACTION_TYPES.map((type) => ({
  value: type,
  label: REWARD_TYPE_LABEL[type],
}));

const columns = transactionColumns();

/** The name of the customer a ledger is narrowed to. */
function CustomerChip({ customerId }: { customerId: string }) {
  const name = useRecordName("customer", customerId);
  return (
    <span className="text-13 text-ink-muted">
      Movements of{" "}
      <CustomerName
        customer={{ id: customerId, name: name ?? null, email: null }}
      />
    </span>
  );
}

/** The ledger (`GET /rewards/transactions`): every movement, with its filters. */
export function LedgerTab() {
  const [state, setState] = useUrlState({
    type: param.oneOf(REWARD_TRANSACTION_TYPES),
    customerId: param.id(),
    orderNumber: param.text(20),
    sort: param.oneOf(SORT_VALUES),
  });
  const text = state.orderNumber.trim();
  const number = ORDER_NUMBER.exec(text);
  const understood = text === "" || number !== null;
  const filters = {
    type: state.type,
    customerId: state.customerId,
    orderNumber: number ? `RF-${number[1]}` : undefined,
  };
  const rows$ = useRewardTransactions(
    { ...filters, sort: state.sort },
    understood,
  );
  const count = useRewardTransactionCount(filters, understood);
  const rows = rows$.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(state.type || state.customerId || text);
  const sortLabel =
    SORTS.find((option) => option.value === state.sort)?.label ??
    "newest first";
  const clear = () =>
    setState({
      type: undefined,
      customerId: undefined,
      orderNumber: "",
      sort: undefined,
    });

  return (
    <div className="flex flex-col gap-3">
      <FilterBar active={filtered || Boolean(state.sort)} onClear={clear}>
        <SearchField
          label="Movements of an order"
          placeholder="Order number, RF-1084"
          value={state.orderNumber}
          onChange={(orderNumber) => setState({ orderNumber })}
        />
        <FilterSelect
          label="Type"
          value={state.type}
          options={TYPE_OPTIONS}
          onChange={(type) => setState({ type })}
        />
        <SortSelect
          value={state.sort}
          options={SORTS}
          onChange={(sort) => setState({ sort })}
        />
        {state.customerId ? (
          <CustomerChip customerId={state.customerId} />
        ) : null}
      </FilterBar>
      <DataTable
        caption={`Coin ledger, ${sortLabel.toLowerCase()}`}
        columns={columns}
        data={understood ? rows : []}
        getRowId={(row) => row.id}
        refreshing={rows$.isPlaceholderData}
        error={rows$.error}
        onRetry={() => void rows$.refetch()}
        card={(row) => <TransactionCard row={row} />}
        empty={
          <EmptyState
            icon={<Coins />}
            title={
              !understood
                ? "This is not an order number"
                : filtered
                  ? "No movement matches"
                  : "No movement yet"
            }
            action={
              !understood ? null : filtered ? (
                <Button onClick={clear}>Clear the filters</Button>
              ) : null
            }
          >
            {!understood
              ? "Movements are found by the number of their order, like RF-1084."
              : filtered
                ? "Change the filters or clear them."
                : "Every coin that is earned, redeemed, given back, taken back, adjusted or expired is one row here."}
          </EmptyState>
        }
        footer={
          <>
            {rows$.isFetchNextPageError ? (
              <Alert
                tone="danger"
                title="More movements could not be loaded"
                actions={
                  <Button onClick={() => void rows$.fetchNextPage()}>
                    Try again
                  </Button>
                }
              >
                {errorMessage(rows$.error)}
              </Alert>
            ) : null}
            <LoadMore
              shown={rows?.length ?? 0}
              total={count.data?.total}
              noun="movement"
              hasMore={rows$.hasNextPage}
              loading={rows$.isFetchingNextPage}
              onLoadMore={() => void rows$.fetchNextPage()}
            />
          </>
        }
      />
    </div>
  );
}
