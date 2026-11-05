"use client";

import Link from "next/link";
import type { Column } from "@/components/data/data-table";
import { CustomerCell, customerOf } from "@/components/domain/customer";
import { DateTime } from "@/components/domain/values";
import type { RewardAccount } from "@/lib/api/types";
import { personName } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { coinsText } from "./rules";

const count = (value: number) => value.toLocaleString("en");

/** The columns of the account list (30): who has how many coins. */
export const accountColumns: Column<RewardAccount>[] = [
  {
    id: "customer",
    header: "Customer",
    cell: ({ row }) => (
      <CustomerCell
        customer={customerOf(row.original.customerId, row.original.customer)}
      />
    ),
    meta: { skeleton: "w-40", className: "max-w-64" },
  },
  {
    id: "available",
    header: "Available",
    cell: ({ row }) => (
      <span className="font-semibold text-ink tabular">
        {count(row.original.available)}
        {row.original.balance < 0 ? (
          <span
            className="ml-1 text-13 font-normal text-danger-fg"
            title="Coins were taken back after a credit; the balance is below zero and must be earned off."
          >
            ({count(row.original.balance)})
          </span>
        ) : null}
      </span>
    ),
    meta: { align: "right", skeleton: "w-12" },
  },
  {
    id: "reserved",
    header: "Reserved",
    cell: ({ row }) => (
      <span className={row.original.reserved === 0 ? "text-ink-subtle" : ""}>
        {count(row.original.reserved)}
      </span>
    ),
    meta: { align: "right", from: "md", skeleton: "w-12" },
  },
  {
    id: "earned",
    header: "Earned",
    cell: ({ row }) => count(row.original.earnedTotal),
    meta: { align: "right", from: "lg", skeleton: "w-12" },
  },
  {
    id: "redeemed",
    header: "Redeemed",
    cell: ({ row }) => count(row.original.redeemedTotal),
    meta: { align: "right", from: "lg", skeleton: "w-12" },
  },
  {
    id: "activity",
    header: "Last activity",
    cell: ({ row }) => <DateTime value={row.original.lastActivityAt} short />,
    meta: { from: "sm", skeleton: "w-24" },
  },
];

/** An account as a card, for phones. */
export function AccountCard({ account }: { account: RewardAccount }) {
  const customer = customerOf(account.customerId, account.customer);
  return (
    <Link
      href={routes.rewardAccount(account.customerId)}
      className="glass-card glass-lift flex flex-col gap-1.5 rounded-xl p-3.5 active:bg-sunken"
    >
      <span className="flex items-center gap-2.5">
        <span className="truncate text-sm font-semibold text-ink">
          {personName(customer)}
        </span>
        <span className="ml-auto font-semibold text-ink tabular">
          {coinsText(account.available)}
        </span>
      </span>
      <span className="text-13 text-ink-muted">
        {count(account.earnedTotal)} earned · {count(account.redeemedTotal)}{" "}
        redeemed
        {account.reserved > 0 ? ` · ${count(account.reserved)} reserved` : ""}
      </span>
      <span className="text-13 text-ink-subtle">
        Last activity <DateTime value={account.lastActivityAt} short />
      </span>
    </Link>
  );
}
