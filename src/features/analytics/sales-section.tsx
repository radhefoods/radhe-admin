"use client";

import { useState } from "react";
import { LineChart, type Series } from "@/components/data/charts";
import { Skeleton } from "@/components/ui/surface";
import type { AnalyticsQuery, SalesPoint } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { Segmented } from "@/features/legal/segmented";
import { compactMoney, formatCount, Section } from "./kpi";
import { useAnalyticsSales } from "./queries";
import { periodLabel } from "./range";

type Metric = "revenue" | "orders" | "units";

const METRIC_LABEL: Record<Metric, string> = {
  revenue: "Revenue",
  orders: "Orders",
  units: "Units",
};

/** The main chart: the period against the one before, by index (day 1 against day 1). */
export function SalesSection({
  query,
  enabled,
}: {
  query: AnalyticsQuery;
  enabled: boolean;
}) {
  const sales = useAnalyticsSales(query, enabled);
  const [metric, setMetric] = useState<Metric>("revenue");
  const data = sales.data;
  const money = metric === "revenue";

  const labels =
    data?.current.map((point) =>
      periodLabel(point.period, data.range.granularity),
    ) ?? [];
  const of = (points: SalesPoint[]) => points.map((point) => point[metric]);
  const series: Series[] = data
    ? [
        {
          key: "current",
          label: METRIC_LABEL[metric],
          values: of(data.current),
          variant: "primary",
        },
        {
          key: "previous",
          label: "Previous period",
          values: of(data.previous),
          variant: "previous",
          pointLabels: data.previous.map((point) =>
            periodLabel(point.period, data.range.granularity),
          ),
        },
        ...(money
          ? [
              {
                key: "refunded",
                label: "Refunded",
                values: data.current.map((point) => point.refunded),
                variant: "danger" as const,
              },
            ]
          : []),
      ]
    : [];
  const total = data
    ? of(data.current).reduce((sum, value) => sum + value, 0)
    : 0;

  return (
    <Section
      title="Sales"
      description={
        data
          ? `${METRIC_LABEL[metric]} per ${data.range.granularity}, the previous period dashed${money ? ", refunds in red" : ""}.`
          : "Revenue, orders or units per day, week or month."
      }
      actions={
        <Segmented<Metric>
          label="Figure of the chart"
          value={metric}
          options={(Object.keys(METRIC_LABEL) as Metric[]).map((key) => ({
            value: key,
            label: METRIC_LABEL[key],
          }))}
          onChange={setMetric}
        />
      }
      loading={!data}
      refreshing={sales.isPlaceholderData}
      error={sales.error}
      onRetry={() => void sales.refetch()}
      skeleton={<Skeleton className="h-60 rounded-lg" />}
    >
      <p className="text-13 text-ink-muted">
        <span className="font-semibold text-ink tabular">
          {money ? formatMoney(total) : formatCount(total)}
        </span>{" "}
        {METRIC_LABEL[metric].toLowerCase()} in the period.
      </p>
      <LineChart
        caption={`${METRIC_LABEL[metric]} per ${data?.range.granularity ?? "day"}`}
        labels={labels}
        series={series}
        format={money ? formatMoney : formatCount}
        formatTick={money ? compactMoney : formatCount}
      />
    </Section>
  );
}
