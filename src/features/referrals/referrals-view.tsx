"use client";

import { UserPlus } from "lucide-react";
import { DataTable } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SortSelect,
  type SortOption,
} from "@/components/data/filter-bar";
import { LoadMore } from "@/components/data/pagination";
import { RequirePermission } from "@/components/domain/permission";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import {
  REFERRAL_STATUSES,
  type ReferralSortField,
  type SortParam,
} from "@/lib/api/types";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { REFERRAL_STATUS, statusOptions } from "@/lib/status";
import { useReferralCount, useReferrals } from "./queries";
import { ReferralCard, referralColumns } from "./referral-columns";

/** The orders of the list the API offers (27). */
const SORTS: readonly SortOption<SortParam<ReferralSortField>>[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "status:asc", label: "By status" },
];
const SORT_VALUES = SORTS.map((option) => option.value);

const columns = referralColumns();

export function ReferralsView() {
  const [state, setState, clear] = useUrlState({
    status: param.oneOf(REFERRAL_STATUSES),
    referrerId: param.id(),
    referredId: param.id(),
    sort: param.oneOf(SORT_VALUES),
  });
  const filters = {
    status: state.status,
    referrerId: state.referrerId,
    referredId: state.referredId,
  };
  const referrals = useReferrals({ ...filters, sort: state.sort });
  const count = useReferralCount(filters);
  const rows = referrals.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(
    state.status || state.referrerId || state.referredId,
  );
  const sortLabel =
    SORTS.find((option) => option.value === state.sort)?.label ??
    "newest first";

  return (
    <RequirePermission permission="customers.read">
      <PageHeader
        title="Referrals"
        description="Customers invite others with their code and link. A referral is registered at the sign-up, qualifies with the invited person's first delivered order, and is void when all the goods of that order were credited later. What a referral earns in coins is set under Points & Rewards."
      />
      <PageBody className="gap-3">
        <FilterBar active={filtered || Boolean(state.sort)} onClear={clear}>
          <FilterSelect
            label="Status"
            value={state.status}
            options={statusOptions(REFERRAL_STATUS)}
            onChange={(status) => setState({ status })}
          />
          <SortSelect
            value={state.sort}
            options={SORTS}
            onChange={(sort) => setState({ sort })}
          />
        </FilterBar>

        <DataTable
          caption={`Referrals, ${sortLabel.toLowerCase()}`}
          columns={columns}
          data={rows}
          getRowId={(referral) => referral.id}
          refreshing={referrals.isPlaceholderData}
          error={referrals.error}
          onRetry={() => void referrals.refetch()}
          card={(referral) => <ReferralCard referral={referral} />}
          empty={
            <EmptyState
              icon={<UserPlus />}
              title={
                state.status
                  ? `No referral is ${REFERRAL_STATUS[state.status].label.toLowerCase()}`
                  : filtered
                    ? "No referral matches"
                    : "No referral yet"
              }
              action={
                filtered ? (
                  <Button onClick={clear}>Clear the filters</Button>
                ) : null
              }
            >
              {filtered
                ? "Change the filters or clear them."
                : "A referral appears here when somebody signs up with a customer's link."}
            </EmptyState>
          }
          footer={
            <>
              {referrals.isFetchNextPageError ? (
                <Alert
                  tone="danger"
                  title="More referrals could not be loaded"
                  actions={
                    <Button onClick={() => void referrals.fetchNextPage()}>
                      Try again
                    </Button>
                  }
                >
                  {errorMessage(referrals.error)}
                </Alert>
              ) : null}
              <LoadMore
                shown={rows?.length ?? 0}
                total={count.data?.total}
                noun="referral"
                hasMore={referrals.hasNextPage}
                loading={referrals.isFetchingNextPage}
                onLoadMore={() => void referrals.fetchNextPage()}
              />
            </>
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
