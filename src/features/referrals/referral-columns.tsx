"use client";

import Link from "next/link";
import type { Column } from "@/components/data/data-table";
import {
  CustomerCell,
  CustomerName,
  customerOf,
} from "@/components/domain/customer";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime, TwoLine } from "@/components/domain/values";
import type { Referral } from "@/lib/api/types";
import { humanize } from "@/lib/status";
import { routes } from "@/lib/routes";

/** The inviter and the invited person of a referral, as the API names them (0.9). */
function party(referral: Referral, side: "referrer" | "referred") {
  return customerOf(
    side === "referrer" ? referral.referrerId : referral.referredId,
    referral[side],
  );
}

/**
 * The columns of a referral list (27). The customer page leaves the
 * inviter out: it is the customer whose page it is.
 */
export function referralColumns(leaveOut: string[] = []): Column<Referral>[] {
  const columns: Column<Referral>[] = [
    {
      id: "referrer",
      header: "Inviter",
      cell: ({ row }) => (
        <CustomerCell customer={party(row.original, "referrer")} />
      ),
      meta: { skeleton: "w-36", className: "max-w-56" },
    },
    {
      id: "referred",
      header: "Invited",
      cell: ({ row }) => (
        <CustomerCell customer={party(row.original, "referred")} />
      ),
      meta: { skeleton: "w-36", className: "max-w-56" },
    },
    {
      id: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-mono text-13">{row.original.code}</span>
      ),
      meta: { from: "lg", skeleton: "w-20" },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <TwoLine
          primary={<StatusBadge kind="referral" value={row.original.status} />}
          secondary={
            row.original.status === "void" && row.original.voidReason
              ? humanize(row.original.voidReason)
              : null
          }
        />
      ),
    },
    {
      id: "registered",
      header: "Signed up",
      cell: ({ row }) => <DateTime value={row.original.registeredAt} short />,
      meta: { from: "sm", skeleton: "w-24" },
    },
    {
      id: "order",
      header: "Qualifying order",
      cell: ({ row }) =>
        row.original.orderId && row.original.orderNumber ? (
          <TwoLine
            primary={
              <Link
                href={routes.order(row.original.orderId)}
                className="font-semibold text-accent-text hover:underline"
              >
                {row.original.orderNumber}
              </Link>
            }
            secondary={
              row.original.qualifiedAt ? (
                <DateTime value={row.original.qualifiedAt} short />
              ) : null
            }
          />
        ) : (
          <span className="text-ink-subtle">
            {row.original.status === "registered" ? "Not yet" : "—"}
          </span>
        ),
      meta: { from: "md", skeleton: "w-20" },
    },
  ];
  return columns.filter((column) => !leaveOut.includes(column.id ?? ""));
}

/** A referral as a card, for phones. */
export function ReferralCard({ referral }: { referral: Referral }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5">
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink">
          <CustomerName customer={party(referral, "referrer")} /> invited{" "}
          <CustomerName customer={party(referral, "referred")} />
        </span>
        <StatusBadge kind="referral" value={referral.status} />
      </span>
      <span className="flex flex-wrap items-center gap-x-3 text-13 text-ink-muted">
        <span className="font-mono">{referral.code}</span>
        <DateTime value={referral.registeredAt} short />
        {referral.orderId && referral.orderNumber ? (
          <Link
            href={routes.order(referral.orderId)}
            className="font-medium text-accent-text hover:underline"
          >
            {referral.orderNumber}
          </Link>
        ) : null}
      </span>
    </div>
  );
}
