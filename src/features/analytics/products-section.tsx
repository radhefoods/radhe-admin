"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ShareBars } from "@/components/data/charts";
import { Thumb } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/surface";
import type {
  AnalyticsProductSort,
  AnalyticsQuery,
  BestSeller,
} from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { Segmented } from "@/features/legal/segmented";
import { Change, formatCount, Section } from "./kpi";
import { useAnalyticsProducts } from "./queries";

const packLabel = (pack: { value: number; unit: string }) =>
  `${pack.value.toLocaleString("en")} ${pack.unit}`;

function BestSellerRow({ entry, place }: { entry: BestSeller; place: number }) {
  const name = translated(entry.product.name);
  const gone = entry.product.status === null;
  return (
    <li>
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[1.5rem_2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 hover:bg-sunken/70 sm:grid-cols-[1.5rem_2.25rem_minmax(0,1fr)_6rem_7rem_4rem_1.5rem] [&::-webkit-details-marker]:hidden">
          <span className="text-13 text-ink-subtle tabular">{place}</span>
          <Thumb src={entry.product.image?.sizes.small.url} size={36} />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              {gone ? (
                <span className="truncate text-sm font-semibold text-ink-muted">
                  {name}
                </span>
              ) : (
                <Link
                  href={routes.product(entry.product.id)}
                  className="truncate text-sm font-semibold text-accent-text hover:underline"
                >
                  {name}
                </Link>
              )}
              {gone ? <Badge>No longer in the catalogue</Badge> : null}
            </span>
            <span className="text-13 text-ink-subtle sm:hidden">
              {formatCount(entry.units.value)} units ·{" "}
              {formatMoney(entry.revenue.value)}
            </span>
          </span>
          <span className="hidden flex-col items-end sm:flex">
            <span className="text-sm font-medium text-ink tabular">
              {formatCount(entry.units.value)}
            </span>
            <Change kpi={entry.units} className="text-xs" />
          </span>
          <span className="hidden flex-col items-end sm:flex">
            <span className="text-sm font-medium text-ink tabular">
              {formatMoney(entry.revenue.value)}
            </span>
            <Change kpi={entry.revenue} className="text-xs" />
          </span>
          <span className="hidden text-right text-13 text-ink-muted tabular sm:block">
            {formatCount(entry.orders)}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 justify-self-end text-ink-subtle transition-transform group-open:rotate-180"
          />
        </summary>
        <ul className="flex flex-col gap-1 bg-sunken/50 px-3 py-2 pl-[5.25rem] text-13">
          {entry.variants.map((variant) => (
            <li
              key={variant.variantId}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-ink">
                {packLabel(variant.packSize)}{" "}
                <span className="font-mono text-xs text-ink-subtle">
                  {variant.sku}
                </span>
              </span>
              <span className="text-ink-muted tabular">
                {formatCount(variant.units)} units ·{" "}
                {formatMoney(variant.revenue)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** The best sellers of the period, and the sales by category. */
export function ProductsSection({
  query,
  enabled,
}: {
  query: AnalyticsQuery;
  enabled: boolean;
}) {
  const [sortBy, setSortBy] = useState<AnalyticsProductSort>("units");
  const products = useAnalyticsProducts(query, sortBy, enabled);
  const data = products.data;

  return (
    <Section
      title="Best sellers and categories"
      description={
        data
          ? `${plural(data.totals.products, "product")} sold, ${formatCount(data.totals.units)} units, ${formatMoney(data.totals.revenue)} of goods.`
          : "What sold most, and in which categories."
      }
      actions={
        <Segmented<AnalyticsProductSort>
          label="Best sellers by"
          value={sortBy}
          options={[
            { value: "units", label: "By units" },
            { value: "revenue", label: "By revenue" },
          ]}
          onChange={setSortBy}
        />
      }
      loading={!data}
      refreshing={products.isPlaceholderData}
      error={products.error}
      onRetry={() => void products.refetch()}
      skeleton={
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-lg border border-line">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[1.5rem_2.25rem_minmax(0,1fr)_6rem_7rem_4rem_1.5rem] gap-x-3 rounded-t-lg border-b border-line bg-sunken px-3 py-2 text-xs font-semibold text-ink-muted sm:grid"
          >
            <span>#</span>
            <span />
            <span>Product</span>
            <span className="text-right">Units</span>
            <span className="text-right">Revenue</span>
            <span className="text-right">Orders</span>
            <span />
          </div>
          {data && data.bestSellers.length > 0 ? (
            <ul
              aria-label="Best sellers"
              className="divide-y divide-line [&>li:last-child_details:not([open])_summary]:rounded-b-lg"
            >
              {data.bestSellers.map((entry, index) => (
                <BestSellerRow
                  key={entry.product.id}
                  entry={entry}
                  place={index + 1}
                />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-8 text-center text-13 text-ink-muted">
              Nothing was sold in this period.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-13 font-semibold text-ink">
            Categories by share of the goods revenue
          </h3>
          <ShareBars
            caption="Sales by category"
            rows={
              data?.categories.map((entry) => ({
                key: entry.category?.id ?? "none",
                label: (
                  <>
                    {entry.category ? (
                      translated(entry.category.name)
                    ) : (
                      <span className="text-ink-muted">
                        No longer in the catalogue
                      </span>
                    )}
                    <span className="text-ink-subtle">
                      {" "}
                      · {plural(entry.products, "product")}
                    </span>
                  </>
                ),
                share: entry.share,
                value: formatMoney(entry.revenue.value),
              })) ?? []
            }
          />
        </div>
      </div>
    </Section>
  );
}
