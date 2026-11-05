"use client";

import Link from "next/link";
import type { Column } from "@/components/data/data-table";
import { CustomerName, customerOf } from "@/components/domain/customer";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, Money, TwoLine } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import type { Issue } from "@/lib/api/types";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { ISSUE_PROBLEM_LABEL, ISSUE_WISH_LABEL, reportedUnits } from "./rules";

/** The customer of a report with the id the report carries (0.9). */
export function issueCustomer(issue: Issue) {
  return customerOf(issue.customerId, issue.customer);
}

/** The problems of a report as chips. */
export function ProblemChips({ issue }: { issue: Issue }) {
  return (
    <span className="flex flex-wrap gap-1">
      {issue.problems.map((problem) => (
        <Badge key={problem} dot={false}>
          {ISSUE_PROBLEM_LABEL[problem]}
        </Badge>
      ))}
    </span>
  );
}

/** "3 units of 2 products", or what a report about the whole delivery says. */
export function itemsText(issue: Issue): string {
  if (issue.items.length === 0) return "The delivery as a whole";
  return `${plural(reportedUnits(issue), "unit")} of ${plural(issue.items.length, "product")}`;
}

export const issueColumns: Column<Issue>[] = [
  {
    id: "issue",
    header: "Report",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.issue(row.original.id)}
            className="font-semibold text-accent-text hover:underline"
          >
            {row.original.issueNumber}
          </Link>
        }
        secondary={<DateTime value={row.original.reportedAt} short />}
      />
    ),
    meta: { skeleton: "w-28" },
  },
  {
    id: "order",
    header: "Order",
    cell: ({ row }) => (
      <TwoLine
        primary={
          <Link
            href={routes.order(row.original.orderId)}
            className="hover:underline"
          >
            {row.original.orderNumber}
          </Link>
        }
        secondary={
          <CustomerName
            customer={issueCustomer(row.original)}
            className="hover:underline"
          />
        }
      />
    ),
    meta: { from: "sm", className: "max-w-48", skeleton: "w-24" },
  },
  {
    id: "problems",
    header: "Problems",
    cell: ({ row }) => <ProblemChips issue={row.original} />,
    meta: { from: "md", className: "whitespace-normal", skeleton: "w-32" },
  },
  {
    id: "items",
    header: "What",
    cell: ({ row }) => itemsText(row.original),
    meta: { from: "lg", skeleton: "w-28" },
  },
  {
    id: "amount",
    header: "Reported",
    cell: ({ row }) =>
      row.original.reportedAmount > 0 ? (
        <Money cents={row.original.reportedAmount} />
      ) : (
        <span className="text-ink-subtle">—</span>
      ),
    meta: { align: "right", skeleton: "w-14" },
  },
  {
    id: "wish",
    header: "Wish",
    cell: ({ row }) => ISSUE_WISH_LABEL[row.original.preferredResolution],
    meta: { from: "xl", skeleton: "w-20" },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge kind="issue" value={row.original.status} />,
  },
];

/** A report as a card, for phones. */
export function IssueCard({ issue }: { issue: Issue }) {
  return (
    <Link
      href={routes.issue(issue.id)}
      className="glass-card glass-lift flex flex-col gap-2 rounded-xl p-3.5 active:bg-sunken"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-base font-semibold text-ink">
          {issue.issueNumber}
        </span>
        <StatusBadge kind="issue" value={issue.status} />
      </span>
      <ProblemChips issue={issue} />
      <span className="text-13 text-ink-muted">
        {itemsText(issue)}
        {issue.reportedAmount > 0 ? (
          <>
            {" · "}
            <Money cents={issue.reportedAmount} />
          </>
        ) : null}
        {" · "}
        {ISSUE_WISH_LABEL[issue.preferredResolution].toLowerCase()}
      </span>
      <span className="text-13 text-ink-subtle">
        {issue.orderNumber} · <DateTime value={issue.reportedAt} short />
      </span>
    </Link>
  );
}
