"use client";

import { Star } from "lucide-react";
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
  REVIEW_RATINGS,
  REVIEW_STATUSES,
  type ReviewSortField,
  type SortParam,
} from "@/lib/api/types";
import { param, useUrlState } from "@/lib/hooks/use-url-state";
import { routes } from "@/lib/routes";
import { REVIEW_STATUS, statusOptions } from "@/lib/status";
import { useReviewCount, useReviews } from "./queries";
import { ReviewCard, reviewColumns } from "./review-columns";

/** The orders of the list the API offers (28). */
const SORTS: readonly SortOption<SortParam<ReviewSortField>>[] = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "rating:asc", label: "Lowest rating first" },
  { value: "rating:desc", label: "Highest rating first" },
  { value: "status:asc", label: "By status" },
];
const SORT_VALUES = SORTS.map((option) => option.value);

/** The status filter starts on what waits; "all" shows every review. */
const STATUS_CHOICES = [...REVIEW_STATUSES, "all"] as const;
const RATINGS = REVIEW_RATINGS.map(String);
const RATING_OPTIONS = REVIEW_RATINGS.map((rating) => ({
  value: String(rating),
  label: `${rating} star${rating === 1 ? "" : "s"}`,
}));

const columns = reviewColumns();

export function ReviewsView() {
  const [state, setState, clear] = useUrlState({
    status: param.oneOfOr(STATUS_CHOICES, "pending"),
    rating: param.oneOf(RATINGS),
    productId: param.id(),
    customerId: param.id(),
    sort: param.oneOf(SORT_VALUES),
  });
  const status = state.status === "all" ? undefined : state.status;
  const filters = {
    status,
    rating: state.rating ? Number(state.rating) : undefined,
    productId: state.productId,
    customerId: state.customerId,
  };
  const reviews = useReviews({ ...filters, sort: state.sort });
  const count = useReviewCount(filters);
  const rows = reviews.data?.pages.flatMap((page) => page.items);
  const filtered = Boolean(
    state.status !== "pending" ||
    state.rating ||
    state.productId ||
    state.customerId,
  );
  const sortLabel =
    SORTS.find((option) => option.value === state.sort)?.label ??
    "newest first";

  return (
    <RequirePermission permission="reviews.read">
      <PageHeader
        title="Reviews"
        description="What customers wrote about products they received. Every review waits here until you publish it or reject it with a note to the customer; a published review that is rewritten waits again. You can answer in public."
      />
      <PageBody className="gap-3">
        <FilterBar active={filtered || Boolean(state.sort)} onClear={clear}>
          <FilterSelect
            label="Status"
            value={state.status}
            options={[
              ...statusOptions(REVIEW_STATUS),
              { value: "all" as const, label: "All" },
            ]}
            onChange={(next) => setState({ status: next ?? "all" })}
          />
          <FilterSelect
            label="Rating"
            value={state.rating}
            options={RATING_OPTIONS}
            onChange={(rating) => setState({ rating })}
          />
          <SortSelect
            value={state.sort}
            options={SORTS}
            onChange={(sort) => setState({ sort })}
          />
        </FilterBar>

        <DataTable
          caption={`Reviews, ${sortLabel.toLowerCase()}`}
          columns={columns}
          data={rows}
          getRowId={(review) => review.id}
          refreshing={reviews.isPlaceholderData}
          error={reviews.error}
          onRetry={() => void reviews.refetch()}
          rowHref={(review) => routes.review(review.id)}
          card={(review) => <ReviewCard review={review} />}
          empty={
            <EmptyState
              icon={<Star />}
              title={
                status === "pending" && !state.rating
                  ? "No review waits to be read"
                  : status
                    ? `No review is ${REVIEW_STATUS[status].label.toLowerCase()}`
                    : filtered
                      ? "No review matches"
                      : "No review yet"
              }
              action={
                filtered ? (
                  <Button onClick={clear}>Clear the filters</Button>
                ) : (
                  <Button onClick={() => setState({ status: "all" })}>
                    Show every review
                  </Button>
                )
              }
            >
              {status === "pending" && !state.rating
                ? "Every review customers write appears here first, until you publish or reject it."
                : filtered
                  ? "Change the filters or clear them."
                  : "Customers write a review for a product of a delivered order, in the shop."}
            </EmptyState>
          }
          footer={
            <>
              {reviews.isFetchNextPageError ? (
                <Alert
                  tone="danger"
                  title="More reviews could not be loaded"
                  actions={
                    <Button onClick={() => void reviews.fetchNextPage()}>
                      Try again
                    </Button>
                  }
                >
                  {errorMessage(reviews.error)}
                </Alert>
              ) : null}
              <LoadMore
                shown={rows?.length ?? 0}
                total={count.data?.total}
                noun="review"
                hasMore={reviews.hasNextPage}
                loading={reviews.isFetchingNextPage}
                onLoadMore={() => void reviews.fetchNextPage()}
              />
            </>
          }
        />
      </PageBody>
    </RequirePermission>
  );
}
