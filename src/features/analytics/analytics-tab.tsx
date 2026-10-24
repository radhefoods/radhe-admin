"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/surface";
import { describeError } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type { AnalyticsQuery, AnalyticsSummary } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { CustomersSection } from "./customers-section";
import { InventorySection } from "./inventory-section";
import { formatCount, KpiTile } from "./kpi";
import { PaymentsSection } from "./payments-section";
import { ProductsSection } from "./products-section";
import { SalesSection } from "./sales-section";

function Tiles({
  summary,
  refreshing,
}: {
  summary: AnalyticsSummary;
  refreshing: boolean;
}) {
  const { revenue, orders, customers } = summary;
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        refreshing && "opacity-60 transition-opacity",
      )}
      aria-busy={refreshing}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiTile
          label="Gross revenue"
          kpi={revenue.gross}
          format={formatMoney}
        />
        <KpiTile
          label="Net revenue"
          kpi={revenue.net}
          format={formatMoney}
          detail="Gross minus the refunds paid out"
        />
        <KpiTile label="Paid orders" kpi={orders.paid} />
        <KpiTile
          label="Average order value"
          kpi={orders.averageOrderValue}
          format={formatMoney}
        />
        <KpiTile
          label="Buyers"
          kpi={customers.buyers}
          detail={`${formatCount(customers.firstTime.value)} first-time, ${formatCount(customers.returning.value)} returning`}
        />
        <KpiTile label="New customers" kpi={customers.new} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Units sold" kpi={orders.units} compact />
        <KpiTile
          label="Cancelled after payment"
          kpi={orders.cancelled}
          compact
          invert
        />
        <KpiTile
          label="Abandoned checkouts"
          kpi={orders.abandoned}
          compact
          invert
        />
        <KpiTile
          label="Refunded"
          kpi={revenue.refunded}
          format={formatMoney}
          compact
          invert
        />
        <KpiTile
          label="Credit notes"
          kpi={revenue.credits}
          format={formatMoney}
          compact
          invert
        />
        <KpiTile label="Delivered" kpi={orders.delivered} compact />
      </div>
    </div>
  );
}

/**
 * The Analytics tab of the start page (21): the KPI tiles, the sales chart,
 * the best sellers, the customers, the payments and the stock, each section
 * loading on its own. The period comes from the page header.
 */
export function AnalyticsTab({
  query,
  problem,
  summary,
}: {
  query: AnalyticsQuery;
  /** Why the period cannot be asked for yet (a custom range still being typed). */
  problem: string | null;
  summary: UseQueryResult<AnalyticsSummary>;
}) {
  const enabled = problem === null;

  if (problem) {
    return (
      <Alert tone="info" title="Choose the period">
        {problem}
      </Alert>
    );
  }
  if (summary.error && hasErrorCode(summary.error, "ANALYTICS_RANGE_INVALID")) {
    return (
      <Alert tone="danger" title="The API refused this period">
        {describeError(summary.error).message}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {summary.data ? (
        <Tiles summary={summary.data} refreshing={summary.isPlaceholderData} />
      ) : summary.error ? (
        <Alert
          tone="danger"
          title="The figures could not be loaded"
          actions={
            <Button onClick={() => void summary.refetch()}>Try again</Button>
          }
        >
          {describeError(summary.error).message}
        </Alert>
      ) : (
        <div
          role="status"
          aria-label="Loading the figures"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-lg" />
          ))}
        </div>
      )}
      <SalesSection query={query} enabled={enabled} />
      <ProductsSection query={query} enabled={enabled} />
      <CustomersSection query={query} enabled={enabled} />
      <PaymentsSection query={query} enabled={enabled} />
      <InventorySection query={query} enabled={enabled} />
    </div>
  );
}
