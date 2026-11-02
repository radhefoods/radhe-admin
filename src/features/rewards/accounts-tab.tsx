"use client";

import { Coins } from "lucide-react";
import { DataTable } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SortSelect,
  type SortOption,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import type { RewardAccountSortField, SortParam } from "@/lib/api/types";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { AccountCard, accountColumns } from "./account-columns";
import { useRewardAccounts } from "./queries";

/** The orders of the list the API offers (30). */
const SORTS: readonly SortOption<SortParam<RewardAccountSortField>>[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "available:desc", label: "Most coins first" },
  { value: "available:asc", label: "Fewest coins first" },
  { value: "lastActivityAt:desc", label: "Latest activity first" },
  { value: "lastActivityAt:asc", label: "Longest idle first" },
];
const SORT_VALUES = SORTS.map((option) => option.value);

const BALANCE_OPTIONS = [
  { value: "true", label: "With coins" },
  { value: "false", label: "Without coins" },
] as const;

/** The accounts (`GET /rewards/accounts`): who has how many coins. */
export function AccountsTab() {
  const [state, setState] = useUrlState({
    withBalance: param.flag(),
    sort: param.oneOf(SORT_VALUES),
  });
  const accounts = useRewardAccounts({
    withBalance: state.withBalance,
    sort: state.sort,
  });
  const rows = accounts.data?.pages.flatMap((page) => page.items);
  const filtered = state.withBalance !== undefined;
  const sortLabel =
    SORTS.find((option) => option.value === state.sort)?.label ??
    "newest first";

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        active={filtered || Boolean(state.sort)}
        onClear={() => setState({ withBalance: undefined, sort: undefined })}
      >
        <FilterSelect
          label="Balance"
          value={
            state.withBalance === undefined
              ? undefined
              : String(state.withBalance)
          }
          options={BALANCE_OPTIONS}
          onChange={(value) =>
            setState({
              withBalance: value === undefined ? undefined : value === "true",
            })
          }
        />
        <SortSelect
          value={state.sort}
          options={SORTS}
          onChange={(sort) => setState({ sort })}
        />
      </FilterBar>
      <DataTable
        caption={`Coin accounts, ${sortLabel.toLowerCase()}`}
        columns={accountColumns}
        data={rows}
        getRowId={(account) => account.id}
        refreshing={accounts.isPlaceholderData}
        error={accounts.error}
        onRetry={() => void accounts.refetch()}
        rowHref={(account) => routes.rewardAccount(account.customerId)}
        card={(account) => <AccountCard account={account} />}
        empty={
          <EmptyState
            icon={<Coins />}
            title={filtered ? "No account matches" : "No account yet"}
            action={
              filtered ? (
                <Button onClick={() => setState({ withBalance: undefined })}>
                  Show every account
                </Button>
              ) : null
            }
          >
            {filtered
              ? "Change the filter or clear it."
              : "An account is made the first time a customer earns or redeems coins."}
          </EmptyState>
        }
        footer={
          <>
            {accounts.isFetchNextPageError ? (
              <Alert
                tone="danger"
                title="More accounts could not be loaded"
                actions={
                  <Button onClick={() => void accounts.fetchNextPage()}>
                    Try again
                  </Button>
                }
              >
                {errorMessage(accounts.error)}
              </Alert>
            ) : null}
            <LoadMore
              shown={rows?.length ?? 0}
              noun="account"
              hasMore={accounts.hasNextPage}
              loading={accounts.isFetchingNextPage}
              onLoadMore={() => void accounts.fetchNextPage()}
            />
          </>
        }
      />
    </div>
  );
}
