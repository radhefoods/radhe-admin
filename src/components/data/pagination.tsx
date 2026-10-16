"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";

/**
 * Pages of a list the API counts (products):
 * "25 to 48 of 57", previous, next.
 */
export function Pagination({
  page,
  limit,
  total,
  totalPages,
  onPage,
  noun,
  className,
}: {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  /** What is counted: "product". */
  noun: string;
  className?: string;
}) {
  if (total === 0) return null;
  const first = (page - 1) * limit + 1;
  const last = Math.min(total, page * limit);
  return (
    <nav
      aria-label="Pages"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 text-13 text-ink-muted",
        className,
      )}
    >
      <p className="tabular" aria-live="polite">
        {total <= limit
          ? plural(total, noun)
          : `${first.toLocaleString("en")} to ${last.toLocaleString("en")} of ${plural(total, noun)}`}
      </p>
      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            icon={<ChevronLeft />}
          >
            Previous
          </Button>
          <span className="px-1 tabular">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * The end of a list the API pages by cursor (0.8): the page carries no
 * total, so the panel says how many rows it shows, how many there are
 * (`GET …/count`, when known) and offers the next page.
 */
export function LoadMore({
  shown,
  total,
  noun,
  hasMore,
  loading,
  onLoadMore,
  className,
}: {
  shown: number;
  /** How many rows match the filters in all; unknown while it loads. */
  total?: number;
  noun: string;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  className?: string;
}) {
  if (shown === 0) return null;
  const counted = typeof total === "number" && total >= shown;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 text-13 text-ink-muted",
        className,
      )}
    >
      <p className="tabular" aria-live="polite">
        {hasMore
          ? counted
            ? `Showing ${shown.toLocaleString("en")} of ${plural(total, noun)}`
            : `Showing ${plural(shown, noun)}`
          : `${plural(shown, noun)}, that is all`}
      </p>
      {hasMore ? (
        <Button size="sm" loading={loading} onClick={onLoadMore}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
