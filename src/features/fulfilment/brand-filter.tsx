"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/controls";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import type { FulfilmentBrand } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";

const same = (a: string, b: string) =>
  a.localeCompare(b, "en", { sensitivity: "base" }) === 0;

/**
 * The brands of the report as a chip with a list to tick, and a search
 * inside it. The list comes from `GET …/brands` under the same dates and
 * search, so every option says how many pack sizes it has. Pack sizes
 * without a brand cannot be chosen: they appear when no brand is.
 */
export function BrandFilter({
  brands,
  selected,
  onChange,
  loading = false,
  className,
}: {
  /** `undefined` while the list loads. */
  brands: FulfilmentBrand[] | undefined;
  selected: readonly string[];
  onChange: (brands: string[]) => void;
  loading?: boolean;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const named = (brands ?? []).filter(
    (entry): entry is FulfilmentBrand & { brand: string } =>
      entry.brand !== null,
  );
  // A chosen brand that has nothing under the filters any more stays in the
  // list, so it can be unticked.
  const options = [
    ...named,
    ...selected
      .filter((brand) => !named.some((entry) => same(entry.brand, brand)))
      .map((brand) => ({ brand, packSizes: 0 })),
  ];
  const wanted = text.trim().toLowerCase();
  const shown = wanted
    ? options.filter((entry) => entry.brand.toLowerCase().includes(wanted))
    : options;
  const isChosen = (brand: string) =>
    selected.some((entry) => same(entry, brand));
  const toggle = (brand: string, on: boolean) =>
    onChange(
      on
        ? [...selected.filter((entry) => !same(entry, brand)), brand]
        : selected.filter((entry) => !same(entry, brand)),
    );
  const active = selected.length > 0;

  return (
    <div
      className={cn(
        "flex h-8 items-center rounded-md border text-13 font-medium transition-[border-color,background-color,box-shadow,color] duration-150",
        active
          ? "border-accent/25 bg-accent-soft text-accent-text shadow-glow-sm"
          : "border-line-strong bg-surface/70 text-ink-muted shadow-card hover:border-ink-subtle hover:bg-surface hover:text-ink",
        className,
      )}
    >
      <Popover onOpenChange={(open) => (open ? undefined : setText(""))}>
        <PopoverTrigger
          className={cn(
            "flex h-full items-center gap-1.5 rounded-md pl-2.5",
            active ? "pr-1.5" : "pr-2",
          )}
        >
          <span>Brand</span>
          {active ? (
            <span className="max-w-40 truncate font-semibold">
              {selected.length === 1
                ? selected[0]
                : `${selected.length} chosen`}
            </span>
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          )}
        </PopoverTrigger>
        <PopoverContent className="flex w-72 flex-col gap-2 p-2.5">
          <div className="relative">
            <label htmlFor={`${id}-search`} className="sr-only">
              Search the brands
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-2 left-2.5 size-4 text-ink-subtle"
            />
            <input
              id={`${id}-search`}
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Search the brands"
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full rounded-md border border-line-strong bg-surface/70 pr-2 pl-8 text-13 text-ink placeholder:text-ink-subtle focus-visible:border-accent focus-visible:shadow-focus focus-visible:outline-2 focus-visible:outline-offset-0 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          {brands === undefined || (loading && options.length === 0) ? (
            <p className="px-1 py-2 text-13 text-ink-subtle">Loading…</p>
          ) : options.length === 0 ? (
            <p className="px-1 py-2 text-13 text-ink-subtle">
              No pack size of this period has a brand.
            </p>
          ) : shown.length === 0 ? (
            <p className="px-1 py-2 text-13 text-ink-subtle">
              No brand matches “{text.trim()}”.
            </p>
          ) : (
            <ul
              aria-label="Brands"
              className="flex max-h-64 flex-col overflow-y-auto"
            >
              {shown.map((entry) => {
                const optionId = `${id}-${entry.brand}`;
                return (
                  <li
                    key={entry.brand}
                    className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-ink/6"
                  >
                    <Checkbox
                      id={optionId}
                      checked={isChosen(entry.brand)}
                      onCheckedChange={(checked) =>
                        toggle(entry.brand, checked === true)
                      }
                    />
                    <label
                      htmlFor={optionId}
                      className="flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-3 text-13 text-ink"
                    >
                      <span className="truncate">{entry.brand}</span>
                      <span className="shrink-0 text-xs text-ink-subtle tabular">
                        {plural(entry.packSizes, "pack size")}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {active ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="self-start rounded-md px-1.5 py-1 text-13 font-medium text-ink-muted hover:bg-ink/6 hover:text-ink"
            >
              Show every brand
            </button>
          ) : null}
        </PopoverContent>
      </Popover>
      {active ? (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label="Remove the filter Brand"
          className="mr-1 flex size-5 items-center justify-center rounded-sm hover:bg-planned-bg"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
