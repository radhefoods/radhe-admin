"use client";

import type { ReactNode } from "react";
import { Donut, Funnel } from "@/components/data/charts";
import { Skeleton } from "@/components/ui/surface";
import type { AnalyticsPaymentType, AnalyticsQuery } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/names";
import { humanize } from "@/lib/status";
import { formatCount, formatPercent, Section } from "./kpi";
import { useAnalyticsPayments } from "./queries";

const TYPE_LABEL: Record<AnalyticsPaymentType, string> = {
  card: "Card",
  paypal: "PayPal",
  unknown: "Not recorded",
};

/** A small table of counts by key: refunds by reason, returns by status. */
function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; value: ReactNode }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-ink-muted">{title}</h4>
      <ul className="divide-y divide-line rounded-lg border border-line text-13">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-3 px-2.5 py-1.5"
          >
            <span className="text-ink">{row.label}</span>
            <span className="text-ink-muted tabular">{row.value}</span>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-2.5 py-1.5 text-ink-subtle">None</li>
        ) : null}
      </ul>
    </div>
  );
}

/** How customers paid, what became of the checkouts, refunds and returns. */
export function PaymentsSection({
  query,
  enabled,
}: {
  query: AnalyticsQuery;
  enabled: boolean;
}) {
  const payments = useAnalyticsPayments(query, enabled);
  const data = payments.data;

  return (
    <Section
      title="Payments, refunds and returns"
      description="The checkouts are the orders started in the period and what became of them by now. Refunds count on the day they were paid out; returns on the day they were requested."
      loading={!data}
      refreshing={payments.isPlaceholderData}
      error={payments.error}
      onRetry={() => void payments.refetch()}
      skeleton={
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      }
    >
      {data ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-3">
            <h3 className="text-13 font-semibold text-ink">
              Card versus PayPal
            </h3>
            <Donut
              caption="Paid orders by payment type"
              slices={data.byType.map((entry) => ({
                key: entry.type,
                label: `${TYPE_LABEL[entry.type]} · ${plural(entry.orders, "order")}`,
                value: entry.amount,
                detail: `${formatMoney(entry.amount)} · ${entry.share.toLocaleString("en")} %`,
              }))}
              format={formatMoney}
              centre={{
                value: formatCount(
                  data.byType.reduce((sum, entry) => sum + entry.orders, 0),
                ),
                label: "paid orders",
              }}
            />
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-13 font-semibold text-ink">
              Checkouts started: {formatCount(data.checkouts.started)},
              conversion {formatPercent(data.checkouts.conversion)}
            </h3>
            <Funnel
              caption="What became of the checkouts"
              steps={[
                {
                  key: "started",
                  label: "Started",
                  value: data.checkouts.started,
                },
                {
                  key: "paid",
                  label: "Paid",
                  value: data.checkouts.paid,
                  tone: "secondary",
                },
                {
                  key: "pending",
                  label: "Still open",
                  value: data.checkouts.pending,
                  tone: "previous",
                },
                {
                  key: "failed",
                  label: "Failed",
                  value: data.checkouts.failed,
                  tone: "danger",
                },
                {
                  key: "abandoned",
                  label: "Abandoned",
                  value: data.checkouts.abandoned,
                  tone: "previous",
                },
              ]}
            />
            <p className="text-13 text-ink-subtle">
              Paid also counts orders paid after the period. Abandoned:
              cancelled without a payment, by the customer or when the payment
              page expired.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h3 className="text-13 font-semibold text-ink">
                Refunds: {plural(data.refunds.created.count, "refund")} created
                ({formatMoney(data.refunds.created.amount)}),{" "}
                {data.refunds.completed.count} paid out (
                {formatMoney(data.refunds.completed.amount)})
              </h3>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <Breakdown
                  title="Created, by status now"
                  rows={data.refunds.byStatus.map((entry) => ({
                    key: entry.key,
                    label: humanize(entry.key),
                    value: `${entry.count} · ${formatMoney(entry.amount)}`,
                  }))}
                />
                <Breakdown
                  title="By reason"
                  rows={data.refunds.byReason.map((entry) => ({
                    key: entry.key,
                    label: humanize(entry.key),
                    value: `${entry.count} · ${formatMoney(entry.amount)}`,
                  }))}
                />
                <Breakdown
                  title="By method"
                  rows={data.refunds.byMethod.map((entry) => ({
                    key: entry.key,
                    label: entry.key === "stripe" ? "Stripe" : "By hand",
                    value: `${entry.count} · ${formatMoney(entry.amount)}`,
                  }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-13 font-semibold text-ink">
                Returns: {plural(data.returns.requested, "request")},{" "}
                {data.returns.completed.count} completed (
                {formatMoney(data.returns.completed.credited)} credited)
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Breakdown
                  title="Requested, by status now"
                  rows={data.returns.byStatus.map((entry) => ({
                    key: entry.status,
                    label: humanize(entry.status),
                    value: formatCount(entry.count),
                  }))}
                />
                <Breakdown
                  title="Items by reason"
                  rows={data.returns.byReason.map((entry) => ({
                    key: entry.reason,
                    label: humanize(entry.reason),
                    value: `${plural(entry.items, "line")} · ${plural(entry.units, "unit")}`,
                  }))}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
