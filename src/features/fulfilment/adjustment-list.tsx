"use client";

import { Undo2 } from "lucide-react";
import { DateTime } from "@/components/domain/values";
import { Button } from "@/components/ui/button";
import type { FulfilmentAdjustment } from "@/lib/api/types";
import { formatDay } from "@/lib/format/dates";
import { FIGURE_LABEL, changeText, count } from "./fulfilment";

/** "Dispatched 20 → 22 · Returned 2 → 3 · Net sold 18 → 19", from what the API kept. */
function beforeAfter(adjustment: FulfilmentAdjustment): string {
  return (["dispatched", "returned", "net"] as const)
    .map(
      (key) =>
        `${FIGURE_LABEL[key]} ${count(adjustment.before[key])} → ${count(adjustment.after[key])}`,
    )
    .join(" · ");
}

/**
 * Adjustments made by hand, as the API lists them: the day each counts
 * for, the change, the figures over all dates before and after, the
 * reason, who and when. Nothing here is edited or deleted: an entry is
 * taken back by a second one with the opposite numbers.
 */
export function AdjustmentList({
  items,
  label,
  showProduct = false,
  onTakeBack,
}: {
  items: FulfilmentAdjustment[];
  /** What the list is, for a screen reader. */
  label: string;
  /** Name the pack size of each entry (the history of all of them). */
  showProduct?: boolean;
  /** Offers "Take back" on each entry. */
  onTakeBack?: (adjustment: FulfilmentAdjustment) => void;
}) {
  return (
    <ul
      aria-label={label}
      className="glass-inset divide-y divide-line overflow-hidden rounded-lg"
    >
      {items.map((adjustment) => (
        <li
          key={adjustment.id}
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3.5 py-3"
        >
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5 text-13">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold text-ink tabular">
                {changeText(adjustment)}
              </span>
              <span className="text-ink-muted">
                counts for {formatDay(adjustment.date)}
              </span>
            </p>
            {showProduct ? (
              <p className="text-ink">
                {adjustment.name.en}, {adjustment.packSize.label}
                <span className="text-ink-subtle"> · {adjustment.sku}</span>
              </p>
            ) : null}
            <p className="text-ink-muted tabular">{beforeAfter(adjustment)}</p>
            <p className="break-words text-ink">{adjustment.reason}</p>
            <p className="text-ink-subtle">
              {adjustment.admin?.name ?? "An admin"} ·{" "}
              <DateTime value={adjustment.createdAt} />
            </p>
          </div>
          {onTakeBack ? (
            <Button
              size="sm"
              icon={<Undo2 />}
              onClick={() => onTakeBack(adjustment)}
              aria-label={`Take back the adjustment of ${formatDay(adjustment.date)}, ${changeText(adjustment)}`}
            >
              Take back
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
