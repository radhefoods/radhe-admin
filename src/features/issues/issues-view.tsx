"use client";

import { MessageSquareWarning } from "lucide-react";
import { DataTable } from "@/components/data/data-table";
import {
  FilterBar,
  FilterSelect,
  SearchField,
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
  ISSUE_STATUSES,
  type IssueSortField,
  type SortParam,
} from "@/lib/api/types";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { ISSUE_STATUS, statusOptions } from "@/lib/status";
import { IssueCard, issueColumns } from "./issue-columns";
import { useIssueCount, useIssues } from "./queries";

/** An order number, with or without its prefix, or a report number `RF-1084-P1`. */
const ORDER_NUMBER = /^(?:rf[\s-]?|#)?(\d{3,9})(?:-p\d+)?$/i;

/** The orders of the list the API offers (29). */
const SORTS: readonly SortOption<SortParam<IssueSortField>>[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "status:asc", label: "By status" },
];
const SORT_VALUES = SORTS.map((option) => option.value);

/** The status filter starts on what waits; "all" shows every report. */
const STATUS_CHOICES = [...ISSUE_STATUSES, "all"] as const;

export function IssuesView() {
  const [state, setState, clear] = useUrlState({
    status: param.oneOfOr(STATUS_CHOICES, "open"),
    q: param.text(20),
    orderNumber: param.text(20),
    customerId: param.id(),
    sort: param.oneOf(SORT_VALUES),
  });
  const text = state.q || state.orderNumber;
  const number = ORDER_NUMBER.exec(text.trim());
  const understood = text.trim() === "" || number !== null;
  const status = state.status === "all" ? undefined : state.status;
  const filters = {
    status,
    orderNumber: number ? `RF-${number[1]}` : undefined,
    customerId: state.customerId,
  };
  const issues = useIssues({ ...filters, sort: state.sort }, understood);
  const count = useIssueCount(filters, understood);
  const rows = issues.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(state.status !== "open" || text || state.customerId);
  const sortLabel =
    SORTS.find((option) => option.value === state.sort)?.label ??
    "newest first";

  return (
    <RequirePermission permission="orders.read">
      <PageHeader
        title="Problem reports"
        description="After a delivery, customers report what went wrong: the products and units concerned, the problems, a description, photos, and what they would like. Take a report on, then resolve it with a refund, a replacement or a note, or reject it. A refund corrects the order and goes through the refund queue, as a return does."
      />
      <PageBody className="gap-3">
        <FilterBar active={filtered || Boolean(state.sort)} onClear={clear}>
          <SearchField
            label="Reports of an order"
            placeholder="Order number, RF-1084"
            value={text}
            onChange={(q) => setState({ q, orderNumber: "" })}
          />
          <FilterSelect
            label="Status"
            value={state.status}
            options={[
              ...statusOptions(ISSUE_STATUS),
              { value: "all" as const, label: "All" },
            ]}
            onChange={(next) => setState({ status: next ?? "all" })}
          />
          <SortSelect
            value={state.sort}
            options={SORTS}
            onChange={(sort) => setState({ sort })}
          />
        </FilterBar>

        <DataTable
          caption={`Problem reports, ${sortLabel.toLowerCase()}`}
          columns={issueColumns}
          data={understood ? rows : []}
          getRowId={(issue) => issue.id}
          refreshing={issues.isPlaceholderData}
          error={issues.error}
          onRetry={() => void issues.refetch()}
          rowHref={(issue) => routes.issue(issue.id)}
          card={(issue) => <IssueCard issue={issue} />}
          empty={
            <EmptyState
              icon={<MessageSquareWarning />}
              title={
                !understood
                  ? "This is not an order number"
                  : status === "open" && !text && !state.customerId
                    ? "No report waits for you"
                    : filtered
                      ? "No report matches"
                      : "No report yet"
              }
              action={
                !understood ? null : filtered ? (
                  <Button onClick={clear}>Clear the filters</Button>
                ) : (
                  <Button onClick={() => setState({ status: "all" })}>
                    Show every report
                  </Button>
                )
              }
            >
              {!understood
                ? "Reports are found by the number of their order, like RF-1084."
                : status === "open" && !text && !state.customerId
                  ? "Every new report appears here until somebody takes it on."
                  : filtered
                    ? "Change the filters or clear them."
                    : "A customer can report a problem with a delivered order, within the window of the settings."}
            </EmptyState>
          }
          footer={
            <>
              {issues.isFetchNextPageError ? (
                <Alert
                  tone="danger"
                  title="More reports could not be loaded"
                  actions={
                    <Button onClick={() => void issues.fetchNextPage()}>
                      Try again
                    </Button>
                  }
                >
                  {errorMessage(issues.error)}
                </Alert>
              ) : null}
              <LoadMore
                shown={rows?.length ?? 0}
                total={count.data?.total}
                noun="report"
                hasMore={issues.hasNextPage}
                loading={issues.isFetchingNextPage}
                onLoadMore={() => void issues.fetchNextPage()}
              />
            </>
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
