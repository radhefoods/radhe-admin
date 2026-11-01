"use client";

import Link from "next/link";
import type { Column } from "@/components/data/data-table";
import { CustomerCell, customerOf } from "@/components/domain/customer";
import { Stars } from "@/components/domain/stars";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Thumb, TwoLine } from "@/components/domain/values";
import type { Review } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { reviewProductName } from "./rules";

/** The customer of a review with the id the review carries (0.9). */
function reviewCustomer(review: Review) {
  return customerOf(review.customerId, review.customer);
}

function ReviewLink({ review }: { review: Review }) {
  return (
    <Link
      href={routes.review(review.id)}
      className="font-semibold text-accent-text hover:underline"
    >
      {review.title?.trim() || `${review.rating} of 5 stars`}
    </Link>
  );
}

/**
 * The columns of a review list (28). The customer page leaves the
 * customer out: it is the customer whose page it is.
 */
export function reviewColumns(leaveOut: string[] = []): Column<Review>[] {
  const columns: Column<Review>[] = [
    {
      id: "product",
      header: "Product",
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Thumb src={row.original.product.imageUrl} size={36} />
          <TwoLine
            primary={
              <Link
                href={routes.product(row.original.productId)}
                className="font-medium hover:underline"
              >
                {reviewProductName(row.original.product)}
              </Link>
            }
            secondary={<Stars value={row.original.rating} />}
          />
        </span>
      ),
      meta: { skeleton: "w-40", className: "max-w-60" },
    },
    {
      id: "review",
      header: "Review",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <ReviewLink review={row.original} />
          <span className="line-clamp-2 text-13 text-ink-muted">
            {row.original.text}
          </span>
        </span>
      ),
      meta: { className: "max-w-80 min-w-48 whitespace-normal" },
    },
    {
      id: "author",
      header: "Author",
      cell: ({ row }) => row.original.authorName,
      meta: { from: "xl", skeleton: "w-20" },
    },
    {
      id: "customer",
      header: "Customer",
      cell: ({ row }) => (
        <CustomerCell customer={reviewCustomer(row.original)} />
      ),
      meta: { from: "lg", skeleton: "w-32", className: "max-w-48" },
    },
    {
      id: "order",
      header: "Order",
      cell: ({ row }) =>
        row.original.orderId && row.original.orderNumber ? (
          <Link
            href={routes.order(row.original.orderId)}
            className="hover:underline"
          >
            {row.original.orderNumber}
          </Link>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
      meta: { from: "md", skeleton: "w-16" },
    },
    {
      id: "written",
      header: "Written",
      cell: ({ row }) => (
        <TwoLine
          primary={<DateTime value={row.original.writtenAt} short />}
          secondary={row.original.editedAt ? "Rewritten" : null}
        />
      ),
      meta: { from: "sm", skeleton: "w-24" },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge kind="review" value={row.original.status} />
      ),
    },
  ];
  return columns.filter((column) => !leaveOut.includes(column.id ?? ""));
}

/** A review as a card, for phones. */
export function ReviewCard({ review }: { review: Review }) {
  return (
    <Link
      href={routes.review(review.id)}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 active:bg-sunken"
    >
      <span className="flex items-center gap-2.5">
        <Thumb src={review.product.imageUrl} size={36} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-ink">
            {reviewProductName(review.product)}
          </span>
          <Stars value={review.rating} />
        </span>
        <StatusBadge kind="review" value={review.status} className="ml-auto" />
      </span>
      {review.title ? (
        <span className="text-sm font-medium text-ink">{review.title}</span>
      ) : null}
      <span className="line-clamp-3 text-13 text-ink-muted">{review.text}</span>
      <span className="text-13 text-ink-subtle">
        {review.authorName} · <DateTime value={review.writtenAt} short />
      </span>
    </Link>
  );
}
