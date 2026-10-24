"use client";

import Link from "next/link";
import { Thumb } from "@/components/domain/values";
import { Skeleton } from "@/components/ui/surface";
import type { AnalyticsQuery, StockLine } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { FigureTile, formatCount, KpiTile, Section } from "./kpi";
import { useAnalyticsInventory } from "./queries";

const packLabel = (pack: { value: number; unit: string }) =>
  `${pack.value.toLocaleString("en")} ${pack.unit}`;

function StockList({
  title,
  lines,
  empty,
  soldOut = false,
}: {
  title: string;
  lines: StockLine[];
  empty: string;
  soldOut?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-13 font-semibold text-ink">{title}</h3>
      <ul
        aria-label={title}
        className="divide-y divide-line rounded-lg border border-line text-13"
      >
        {lines.map((line) => (
          <li
            key={line.variantId}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <Link
                href={routes.product(line.productId)}
                className="truncate font-semibold text-accent-text hover:underline"
              >
                {translated(line.name)} {packLabel(line.packSize)}
              </Link>
              <span className="text-ink-subtle">
                <span className="font-mono text-xs">{line.sku}</span>
                {line.threshold !== null
                  ? ` · threshold ${line.threshold}`
                  : ""}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 font-semibold tabular",
                soldOut || line.quantity === 0 ? "text-danger-fg" : "text-gold",
              )}
            >
              {line.quantity === 0 ? "Sold out" : `${line.quantity} left`}
            </span>
          </li>
        ))}
        {lines.length === 0 ? (
          <li className="px-3 py-3 text-ink-subtle">{empty}</li>
        ) : null}
      </ul>
    </div>
  );
}

/** The stock now, the units moved in the period, and what does not sell. */
export function InventorySection({
  query,
  enabled,
}: {
  query: AnalyticsQuery;
  enabled: boolean;
}) {
  const inventory = useAnalyticsInventory(query, enabled);
  const data = inventory.data;

  return (
    <Section
      title="Inventory"
      description="The stock is counted now, over the enabled pack sizes of active products, at selling prices. The movements are the units of the stock ledger in the period."
      loading={!data}
      refreshing={inventory.isPlaceholderData}
      error={inventory.error}
      onRetry={() => void inventory.refetch()}
      skeleton={
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 rounded-lg" />
          ))}
        </div>
      }
    >
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <FigureTile
              label="Pack sizes on sale"
              value={formatCount(data.stock.variants)}
            />
            <FigureTile
              label="Units on hand"
              value={formatCount(data.stock.unitsOnHand)}
            />
            <FigureTile
              label="Stock value"
              value={formatMoney(data.stock.stockValue)}
              detail="At selling prices"
            />
            <FigureTile
              label="Running low"
              value={formatCount(data.stock.variantsLow)}
              detail="pack sizes at or below their threshold"
              tone={data.stock.variantsLow > 0 ? "attention" : undefined}
            />
            <FigureTile
              label="Sold out"
              value={formatCount(data.stock.variantsOutOfStock)}
              detail="pack sizes without units"
              tone={data.stock.variantsOutOfStock > 0 ? "danger" : undefined}
            />
            <FigureTile
              label="Products sold out"
              value={formatCount(data.stock.productsOutOfStock)}
              detail="no size has units"
              tone={data.stock.productsOutOfStock > 0 ? "danger" : undefined}
            />
          </div>
          <div>
            <h3 className="mb-2 text-13 font-semibold text-ink">
              Units moved in the period
            </h3>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <KpiTile label="Sold" kpi={data.movements.sold} compact />
              <KpiTile
                label="Restocked"
                kpi={data.movements.restocked}
                compact
              />
              <KpiTile label="Returned" kpi={data.movements.returned} compact />
              <KpiTile
                label="Released"
                kpi={data.movements.released}
                compact
                detail="By cancellations and checkouts that did not complete"
              />
              <KpiTile
                label="Adjusted"
                kpi={data.movements.adjusted}
                compact
                detail="Corrections and imports, net"
              />
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <StockList
              title="Running low"
              lines={data.lowStock}
              empty="Every pack size with a threshold is above it."
            />
            <StockList
              title="Sold out"
              lines={data.outOfStock}
              empty="No pack size is sold out."
              soldOut
            />
            <div className="flex flex-col gap-2">
              <h3 className="text-13 font-semibold text-ink">
                Slow movers: {plural(data.slowMovers.count, "active product")}{" "}
                sold nothing
              </h3>
              <ul
                aria-label="Slow movers"
                className="divide-y divide-line rounded-lg border border-line text-13"
              >
                {data.slowMovers.items.map((entry) => (
                  <li
                    key={entry.product.id}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <Thumb
                      src={entry.product.image?.sizes.small.url}
                      size={32}
                    />
                    <Link
                      href={routes.product(entry.product.id)}
                      className="min-w-0 flex-1 truncate font-semibold text-accent-text hover:underline"
                    >
                      {translated(entry.product.name)}
                    </Link>
                    <span className="shrink-0 text-right text-ink-muted tabular">
                      {formatCount(entry.unitsOnHand)} units
                      <span className="block text-xs text-ink-subtle">
                        {formatMoney(entry.stockValue)}
                      </span>
                    </span>
                  </li>
                ))}
                {data.slowMovers.items.length === 0 ? (
                  <li className="px-3 py-3 text-ink-subtle">
                    Every active product sold something.
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </>
      ) : null}
    </Section>
  );
}
