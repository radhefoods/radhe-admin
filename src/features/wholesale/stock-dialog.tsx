"use client";

import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import { formatDelta } from "@/features/catalogue/stock";
import { Labelled, NoteField } from "@/features/orders/order-dialogs";
import { WHOLESALE_RULES } from "@/lib/api/types";
import type { WholesaleProductDetail, WholesaleSku } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { translated } from "@/lib/format/names";
import { useSetWholesaleStock } from "./queries";
import {
  STOCK_MODE_LABEL,
  cartonsOf,
  readStockChange,
  type StockMode,
} from "./rules";

/**
 * "Set stock" (25, section 8): the exact count of a SKU after counting the
 * warehouse, or cartons that came in or went out, with a note. The count
 * before and after is restated before anything is sent; below zero is
 * allowed and shown in red.
 */
export function StockDialog({
  product,
  sku,
  open,
  onOpenChange,
}: {
  product: WholesaleProductDetail;
  sku: WholesaleSku;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<StockMode>("set");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const change = useSetWholesaleStock(product.id, sku.id);
  const groupId = useId();
  const reading = readStockChange({ mode, value, note }, sku.stock);
  const name = `${translated(product.name)}, ${sku.carton.label}`;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setMode("set");
          setValue("");
          setNote("");
        }
        onOpenChange(next);
      }}
      title={`Set the stock of ${name}`}
      description="Cartons on hand, apart from the retail stock. Every change is kept in the stock history with your name. A count below zero is a shortage: a quotation was accepted for more than there was."
      facts={[
        {
          label: "On hand now",
          value: (
            <span className={cn(sku.stock < 0 && "text-danger-fg")}>
              {cartonsOf(sku.stock)}
            </span>
          ),
        },
        {
          label: "Change",
          value:
            reading.delta === null
              ? "—"
              : reading.delta === 0
                ? "Nothing"
                : `${formatDelta(reading.delta)} cartons`,
        },
        {
          label: "On hand afterwards",
          value:
            reading.after === null ? (
              "—"
            ) : (
              <span className={cn(reading.after < 0 && "text-danger-fg")}>
                {cartonsOf(reading.after)}
              </span>
            ),
          strong: true,
        },
      ]}
      confirmLabel={
        reading.after === null || reading.delta === null
          ? "Save the stock"
          : reading.delta === 0
            ? "Nothing to change"
            : mode === "set"
              ? `Set the stock to ${reading.after}`
              : reading.delta > 0
                ? `Add ${reading.delta} cartons`
                : `Remove ${-reading.delta} cartons`
      }
      canConfirm={reading.body !== null && reading.delta !== 0}
      onConfirm={async () => {
        if (!reading.body) return;
        const result = await change.mutateAsync(reading.body);
        notify.success(
          `Stock of ${sku.sku} is now ${result.sku.stock}`,
          result.movement
            ? `${formatDelta(result.movement.delta)} cartons, recorded in the history.`
            : "Nothing changed: the count was the same already.",
        );
      }}
    >
      <RadioGroup
        aria-label="How the stock changes"
        value={mode}
        onValueChange={(next) => {
          setMode(next as StockMode);
          setValue("");
        }}
        className="gap-3"
      >
        {(Object.keys(STOCK_MODE_LABEL) as StockMode[]).map((option) => (
          <div key={option} className="flex items-start gap-2.5">
            <RadioItem
              id={`${groupId}-${option}`}
              value={option}
              aria-describedby={`${groupId}-${option}-hint`}
              className="mt-0.5"
            />
            <div className="flex min-w-0 flex-col">
              <label
                htmlFor={`${groupId}-${option}`}
                className="text-sm font-medium text-ink"
              >
                {STOCK_MODE_LABEL[option].label}
              </label>
              <p
                id={`${groupId}-${option}-hint`}
                className="text-13 text-ink-muted"
              >
                {STOCK_MODE_LABEL[option].hint}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
      <Labelled
        label={mode === "set" ? "Cartons on hand" : "Cartons in or out"}
        error={value.trim() === "" ? null : reading.problem}
        hint={
          mode === "set"
            ? `A whole number up to ${WHOLESALE_RULES.stockMax.toLocaleString("en")}.`
            : "A plus adds, a minus removes: 24, +24 or −4."
        }
      >
        {(id) => (
          <Input
            id={id}
            inputMode="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={
              value.trim() !== "" && reading.problem ? true : undefined
            }
            autoComplete="off"
            className="w-36 tabular"
          />
        )}
      </Labelled>
      <NoteField
        value={note}
        onChange={setNote}
        label="Note for the history"
        maxLength={WHOLESALE_RULES.stockNoteMax}
      />
    </ConfirmDialog>
  );
}
