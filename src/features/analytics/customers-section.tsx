"use client";

import Link from "next/link";
import { BarChart } from "@/components/data/charts";
import { DateTime } from "@/components/domain/values";
import { Skeleton } from "@/components/ui/surface";
import type { AnalyticsQuery } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { LOCALE_LABEL, plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { formatCount, formatPercent, KpiTile, Section } from "./kpi";
import { useAnalyticsCustomers } from "./queries";
import { periodLabel } from "./range";

/** Who bought: new accounts, first-time and returning buyers, the top customers. */
export function CustomersSection({
  query,
  enabled,
}: {
  query: AnalyticsQuery;
  enabled: boolean;
}) {
  const customers = useAnalyticsCustomers(query, enabled);
  const data = customers.data;

  return (
    <Section
      title="Customers"
      description="Buyers paid at least one order in the period; first-time buyers placed their first paid order ever in it. New customers are accounts created in the period."
      loading={!data}
      refreshing={customers.isPlaceholderData}
      error={customers.error}
      onRetry={() => void customers.refetch()}
      skeleton={
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-lg" />
          ))}
        </div>
      }
    >
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiTile label="Buyers" kpi={data.buyers} compact />
            <KpiTile label="First-time buyers" kpi={data.firstTime} compact />
            <KpiTile label="Returning buyers" kpi={data.returning} compact />
            <KpiTile
              label="Repeat rate"
              kpi={data.repeatRate}
              format={formatPercent}
              compact
            />
            <KpiTile label="New customers" kpi={data.new} compact />
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex flex-col gap-3">
              <h3 className="text-13 font-semibold text-ink">
                New customers per {data.range.granularity}
              </h3>
              <BarChart
                caption={`New customers per ${data.range.granularity}`}
                labels={data.newCustomers.map((point) =>
                  periodLabel(point.period, data.range.granularity),
                )}
                series={[
                  {
                    key: "new",
                    label: "New customers",
                    values: data.newCustomers.map((point) => point.count),
                    variant: "primary",
                  },
                ]}
                format={formatCount}
              />
              <h3 className="text-13 font-semibold text-ink">
                By language of the order
              </h3>
              <ul className="flex flex-col gap-1 text-13">
                {data.byLanguage.map((entry) => (
                  <li
                    key={entry.language}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-ink">
                      {LOCALE_LABEL[entry.language]}
                    </span>
                    <span className="text-ink-muted tabular">
                      {plural(entry.orders, "order")} ·{" "}
                      {formatMoney(entry.revenue)}
                    </span>
                  </li>
                ))}
                {data.byLanguage.length === 0 ? (
                  <li className="text-ink-subtle">
                    No paid order in this period.
                  </li>
                ) : null}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-13 font-semibold text-ink">
                Top customers by revenue
              </h3>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Top customers of the period
                  </caption>
                  <thead>
                    <tr className="bg-sunken text-xs font-semibold text-ink-muted">
                      <th scope="col" className="px-3 py-2 text-left">
                        Customer
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Orders
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Revenue
                      </th>
                      <th
                        scope="col"
                        className="hidden px-3 py-2 text-right md:table-cell"
                      >
                        Average
                      </th>
                      <th
                        scope="col"
                        className="hidden px-3 py-2 text-left md:table-cell"
                      >
                        Last order
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.topCustomers.map((entry) => (
                      <tr key={entry.customer.id}>
                        <td className="px-3 py-2">
                          <span className="flex min-w-0 flex-col">
                            <Link
                              href={routes.customer(entry.customer.id)}
                              className="truncate font-semibold text-accent-text hover:underline"
                            >
                              {entry.customer.name ?? entry.customer.email}
                            </Link>
                            {entry.customer.name ? (
                              <span className="truncate text-13 text-ink-subtle">
                                {entry.customer.email}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular">
                          {formatCount(entry.orders)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular">
                          {formatMoney(entry.revenue)}
                        </td>
                        <td className="hidden px-3 py-2 text-right text-ink-muted tabular md:table-cell">
                          {formatMoney(entry.averageOrderValue)}
                        </td>
                        <td className="hidden px-3 py-2 text-13 text-ink-muted md:table-cell">
                          <DateTime value={entry.lastOrderAt} short />
                        </td>
                      </tr>
                    ))}
                    {data.topCustomers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-6 text-center text-13 text-ink-muted"
                        >
                          No paid order in this period.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </Section>
  );
}
