"use client";

import Link from "next/link";
import type { Column } from "@/components/data/data-table";
import { CustomerCell, customerOf } from "@/components/domain/customer";
import { StatusBadge } from "@/components/domain/status-badge";
import { AdminName, DateTime, TwoLine } from "@/components/domain/values";
import type { RewardTransaction } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { REWARD_REASON_LABEL, REWARD_TYPE_LABEL, signedCoins } from "./rules";

/** A movement with its sign, green when coins arrive and red when they leave. */
export function Coins({
  coins,
  className,
}: {
  coins: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-medium whitespace-nowrap tabular",
        coins > 0 ? "text-success-fg" : coins < 0 ? "text-danger-fg" : "",
        className,
      )}
    >
      {signedCoins(coins)}
    </span>
  );
}

/** What the row goes back to: the order, a return or report number, a reason. */
function Reference({ row }: { row: RewardTransaction }) {
  if (row.type === "adjustment") {
    return (
      <TwoLine
        primary={row.reason ? REWARD_REASON_LABEL[row.reason] : "—"}
        secondary={row.note}
      />
    );
  }
  if (row.reference && row.reference !== row.orderNumber) {
    return <span className="text-13 text-ink-muted">{row.reference}</span>;
  }
  if (row.type === "order" && row.rate !== null) {
    return (
      <span className="text-13 text-ink-muted">
        {row.rate.toLocaleString("en")} per €
      </span>
    );
  }
  return <span className="text-ink-subtle">—</span>;
}

/**
 * The columns of the ledger (30). The account page leaves the customer
 * out: every row there is theirs.
 */
export function transactionColumns(
  leaveOut: string[] = [],
): Column<RewardTransaction>[] {
  const columns: Column<RewardTransaction>[] = [
    {
      id: "at",
      header: "Date",
      cell: ({ row }) => <DateTime value={row.original.at} short />,
      meta: { skeleton: "w-24" },
    },
    {
      id: "customer",
      header: "Customer",
      cell: ({ row }) => (
        <CustomerCell
          customer={customerOf(row.original.customerId, row.original.customer)}
        />
      ),
      meta: { from: "md", skeleton: "w-32", className: "max-w-48" },
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => REWARD_TYPE_LABEL[row.original.type],
      meta: { skeleton: "w-24" },
    },
    {
      id: "coins",
      header: "Coins",
      cell: ({ row }) => <Coins coins={row.original.coins} />,
      meta: { align: "right", skeleton: "w-12" },
    },
    {
      id: "state",
      header: "State",
      cell: ({ row }) => (
        <StatusBadge kind="rewardTransaction" value={row.original.state} />
      ),
      meta: { from: "sm" },
    },
    {
      id: "order",
      header: "Order",
      cell: ({ row }) =>
        row.original.orderId && row.original.orderNumber ? (
          <Link
            href={routes.order(row.original.orderId)}
            className="font-medium text-accent-text hover:underline"
          >
            {row.original.orderNumber}
          </Link>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
      meta: { from: "sm", skeleton: "w-16" },
    },
    {
      id: "reference",
      header: "Reference",
      cell: ({ row }) => <Reference row={row.original} />,
      meta: { from: "lg", skeleton: "w-28", className: "max-w-64" },
    },
    {
      id: "admin",
      header: "Admin",
      cell: ({ row }) =>
        row.original.adminId ? (
          <AdminName id={row.original.adminId} admin={row.original.admin} />
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
      meta: { from: "xl", skeleton: "w-20" },
    },
  ];
  return columns.filter((column) => !leaveOut.includes(column.id ?? ""));
}

/** A row of the ledger as a card, for phones. */
export function TransactionCard({ row }: { row: RewardTransaction }) {
  return (
    <div className="glass-card flex flex-col gap-1.5 rounded-xl p-3.5">
      <span className="flex items-center gap-2.5">
        <span className="text-sm font-semibold text-ink">
          {REWARD_TYPE_LABEL[row.type]}
        </span>
        <Coins coins={row.coins} className="ml-auto" />
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-ink-muted">
        <DateTime value={row.at} short />
        {row.orderId && row.orderNumber ? (
          <Link
            href={routes.order(row.orderId)}
            className="font-medium text-accent-text hover:underline"
          >
            {row.orderNumber}
          </Link>
        ) : null}
        <StatusBadge kind="rewardTransaction" value={row.state} />
      </span>
      {row.type === "adjustment" && row.note ? (
        <span className="text-13 text-ink-muted">“{row.note}”</span>
      ) : null}
    </div>
  );
}
