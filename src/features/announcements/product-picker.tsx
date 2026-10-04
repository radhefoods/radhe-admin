"use client";

import { Command } from "cmdk";
import { ChevronsUpDown, Search, X } from "lucide-react";
import { useState } from "react";
import { useControlProps } from "@/components/form/form";
import { controlClass } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import type { Id } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { translated } from "@/lib/format/names";
import { useProductChoices } from "./queries";

export interface PickedProduct {
  id: Id;
  name: string;
  sku: string;
}

/**
 * Chooses one product by searching the catalogue (name, article number).
 * Sits inside a `Field`, which gives it its label.
 */
export function ProductPicker({
  value,
  onChange,
}: {
  value: PickedProduct | null;
  onChange: (product: PickedProduct | null) => void;
}) {
  const control = useControlProps();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const choices = useProductChoices(text, open);
  const items = choices.data?.items ?? [];

  return (
    <div className="flex items-center gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setText("");
        }}
      >
        <PopoverTrigger
          {...control}
          aria-haspopup="listbox"
          className={cn(
            controlClass,
            // A button counts as read-only for CSS: keep the field's own surface.
            "flex h-[34px] min-w-0 flex-1 items-center justify-between gap-2 px-3 text-left text-sm read-only:bg-surface",
          )}
        >
          {value ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{value.name}</span>
              <span className="shrink-0 text-13 text-ink-subtle tabular">
                {value.sku}
              </span>
            </span>
          ) : (
            <span className="text-ink-subtle">
              No product: search the catalogue
            </span>
          )}
          <ChevronsUpDown
            aria-hidden="true"
            className="size-4 shrink-0 text-ink-subtle"
          />
        </PopoverTrigger>
        <PopoverContent className="w-[min(26rem,calc(100vw-2rem))] p-0">
          <Command shouldFilter={false} label="Search products" loop>
            <div className="flex h-10 items-center gap-2 border-b border-line px-3">
              {choices.waiting ? (
                <Spinner className="size-4 text-ink-subtle" />
              ) : (
                <Search aria-hidden="true" className="size-4 text-ink-subtle" />
              )}
              <Command.Input
                value={text}
                onValueChange={setText}
                placeholder="Name or article number"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
              />
            </div>
            <Command.List className="max-h-72 overflow-y-auto p-1">
              {choices.isError ? (
                <p className="px-2.5 py-3 text-13 text-danger-fg">
                  The catalogue could not be searched.
                </p>
              ) : null}
              {!choices.waiting && !choices.isError && items.length === 0 ? (
                <p className="px-2.5 py-3 text-13 text-ink-muted">
                  {choices.searched
                    ? `No product matches "${choices.searched}".`
                    : "The catalogue has no product yet."}
                </p>
              ) : null}
              {items.map((product) => (
                <Command.Item
                  key={product.id}
                  value={product.id}
                  onSelect={() => {
                    onChange({
                      id: product.id,
                      name: translated(product.name),
                      sku: product.sku,
                    });
                    setOpen(false);
                    setText("");
                  }}
                  className="flex min-h-9 cursor-pointer items-center gap-3 rounded-sm px-2.5 py-1.5 text-sm data-[selected=true]:bg-sunken"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-ink">
                      {translated(product.name)}
                    </span>
                    <span className="truncate text-13 text-ink-muted tabular">
                      {product.sku} · {product.packSize.label}
                    </span>
                  </span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </PopoverContent>
      </Popover>
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Remove the product ${value.name}`}
          className="flex size-[34px] shrink-0 items-center justify-center rounded-md text-ink-subtle hover:bg-sunken hover:text-ink"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
