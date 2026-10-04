"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A filter that arrived through a link (the messages of one customer, of
 * one order, of one announcement): it cannot be chosen here, only seen and
 * removed. It looks like a set `FilterSelect`.
 */
export function FilterChip({
  label,
  value,
  onRemove,
}: {
  /** What is filtered: "Customer". */
  label: string;
  /** The record's name, or its id while the name is not known. */
  value: ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="flex h-8 max-w-full items-center rounded-md bg-accent-soft text-13 font-medium text-accent-text">
      <span className="flex min-w-0 items-center gap-1.5 pr-1.5 pl-2.5">
        <span className="shrink-0">{label}</span>
        <span className="truncate font-semibold">{value}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove the filter ${label}`}
        className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-planned-bg"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
