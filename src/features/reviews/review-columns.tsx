"use client";

import Link from "next/link";
import type { Column } from "@/components/data/data-table";
import { CustomerCell, customerOf } from "@/components/domain/customer";
import { Stars } from "@/components/domain/stars";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime } from "@/components/domain/values";
import type { Review } from "@/lib/api/types";
import { routes } from "@/lib/routes";

/** The customer of a review with the id the review carries (0.9). */
function reviewCustomer(review: Review) {
  return customerOf(review.customerId, review.customer);
}

/**
 * The columns of a review list (28): the order, who wrote it, the stars,
 * the words. The customer page leaves the customer out: it is the customer
 * whose page it is. The order page has no list; it shows the one review.
 */
export function reviewColumns(leaveOut: string[] = []): Column<Review>[] {
  const columns: Column<Review>[] = [
    {
      id: "order",
      header: "Order",
      cell: ({ row }) => (
        <Link
          href={routes.order(row.original.orderId)}
          className="font-semibold text-accent-text hover:underline"
        >
          {row.original.orderNumber}
        </Link>
      ),
      meta: { skeleton: "w-20" },
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
      id: "rating",
      header: "Stars",
      cell: ({ row }) => <Stars value={row.original.rating} />,
      meta: { skeleton: "w-20" },
    },
    {
      id: "review",
      header: "Review",
      cell: ({ row }) => (
        <Link
          href={routes.review(row.original.id)}
          className="line-clamp-2 text-13 text-ink hover:underline"
        >
          {row.original.text}
        </Link>
      ),
      meta: { className: "max-w-96 min-w-48 whitespace-normal" },
    },
    {
      id: "author",
      header: "Author",
      cell: ({ row }) => row.original.authorName,
      meta: { from: "xl", skeleton: "w-20" },
    },
    {
      id: "written",
      header: "Written",
      cell: ({ row }) => <DateTime value={row.original.writtenAt} short />,
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
      className="glass-card glass-lift flex flex-col gap-2 rounded-xl p-3.5 active:bg-sunken"
    >
      <span className="flex items-center gap-2.5">
        <span className="text-sm font-semibold text-ink">
          {review.orderNumber}
        </span>
        <Stars value={review.rating} />
        <StatusBadge kind="review" value={review.status} className="ml-auto" />
      </span>
      <span className="line-clamp-3 text-13 text-ink-muted">{review.text}</span>
      <span className="text-13 text-ink-subtle">
        {review.authorName} · <DateTime value={review.writtenAt} short />
      </span>
    </Link>
  );
}
