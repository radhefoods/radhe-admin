"use client";

import { useState } from "react";
import { AdminName, DateTime, Money } from "@/components/domain/values";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
} from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import type { PriceChange, ProductDetail } from "@/lib/api/types";
import { formatMoney, formatVatRate } from "@/lib/format/money";
import { usePriceHistory } from "./queries";
import { usePackSizeChoice } from "./stock-panel";

const SHOWN_AT_FIRST = 6;
/** The API returns the newest 200 changes (documentation, 8). */
const API_MAXIMUM = 200;

/**
 * What an entry changed, read from the entry before it. `oldestKnown`: the
 * list was cut off here, so what came before is not known.
 */
export function describePriceChange(
  entry: PriceChange,
  previous: PriceChange | undefined,
  oldestKnown = false,
): string {
  if (!previous) return oldestKnown ? "Price at that time" : "First price";
  const parts: string[] = [];
  if (entry.regularPrice !== previous.regularPrice) {
    parts.push(`Regular price was ${formatMoney(previous.regularPrice)}`);
  }
  if (entry.salePrice !== previous.salePrice) {
    if (previous.salePrice === null) parts.push("Sale started");
    else if (entry.salePrice === null) {
      parts.push(`Sale of ${formatMoney(previous.salePrice)} ended`);
    } else parts.push(`Sale price was ${formatMoney(previous.salePrice)}`);
  }
  if (entry.vatRate !== previous.vatRate) {
    parts.push(`VAT was ${formatVatRate(previous.vatRate)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Saved again";
}

/** The prices a pack size had, newest first, with who changed them. */
export function PriceHistoryPanel({
  product,
  paused = false,
}: {
  product: ProductDetail;
  /** The product is being deleted: its history is not asked for again. */
  paused?: boolean;
}) {
  const { variant, chooser } = usePackSizeChoice(product);
  const history = usePriceHistory(product.id, variant.id, !paused);
  const [all, setAll] = useState(false);
  const entries = history.data ?? [];
  const shown = all ? entries : entries.slice(0, SHOWN_AT_FIRST);

  return (
    <Card
      id="price-history"
      aria-label="Price history"
      className="scroll-mt-20"
    >
      <CardHeader
        title="Price history"
        description={
          product.variants.length > 1
            ? "Every change of the price of a pack size or of the VAT rate, newest first."
            : "Every change of the price or the VAT rate, newest first."
        }
      />
      <CardBody className="flex flex-col gap-3">
        {chooser}
        {history.isPending ? (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-label="Loading the price history"
          >
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : history.isError ? (
          <Alert
            tone="danger"
            title="The price history could not be loaded"
            actions={
              <Button size="sm" onClick={() => void history.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(history.error)}
          </Alert>
        ) : entries.length === 0 ? (
          <p className="text-13 text-ink-muted">
            No price change is recorded for this pack size yet. Each change of
            the price or the VAT rate adds an entry.
          </p>
        ) : (
          <>
            <ol className="flex flex-col divide-y divide-line">
              {shown.map((entry, index) => (
                <li
                  key={`${entry.changedAt}-${index}`}
                  className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm text-ink">
                      {describePriceChange(
                        entry,
                        entries[index + 1],
                        entries.length >= API_MAXIMUM,
                      )}
                    </span>
                    <span className="text-13 text-ink-subtle">
                      <DateTime value={entry.changedAt} /> ·{" "}
                      <AdminName id={entry.changedBy} />
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end leading-tight">
                    <Money
                      cents={entry.price}
                      className="text-sm font-semibold text-ink"
                    />
                    <span className="text-13 text-ink-subtle">
                      {entry.salePrice !== null ? (
                        <>
                          <span className="sr-only">Regular price </span>
                          <s>{formatMoney(entry.regularPrice)}</s> ·{" "}
                        </>
                      ) : null}
                      VAT {formatVatRate(entry.vatRate)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            {entries.length > SHOWN_AT_FIRST ? (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                aria-expanded={all}
                onClick={() => setAll((value) => !value)}
              >
                {all ? "Show fewer" : `Show all ${entries.length} entries`}
              </Button>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
