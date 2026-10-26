"use client";

import { Plus, Star, Trash2, Undo2 } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { ActionButton } from "@/components/domain/permission";
import { MoneyField, SwitchField, UnitField } from "@/components/form/fields";
import { SelectField, TextField } from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/surface";
import type { ProductDetail, ProductVariant } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { PACK_UNIT_LABEL, plural } from "@/lib/format/names";
import {
  PACK_UNITS,
  SALE_MODES,
  emptyVariantRow,
  salePreview,
  type ProductFormValues,
  type SaleMode,
  type VariantRowValues,
} from "./product-schema";
import { stockState } from "./stock";
import { VARIANTS_MAX, packLabelOf } from "./variants";

type ProductForm = UseFormReturn<ProductFormValues, unknown, FieldValues>;

const SALE_LABEL: Record<SaleMode, string> = {
  none: "No sale",
  price: "Sale price",
  percent: "Discount in percent",
};

/** What the API said about one row when the product was saved, with the way out. */
export interface RowNotice {
  message: string;
  /** The pack size cannot be removed: offer to disable it instead. */
  canDisable: boolean;
}

/** The key of a row for notices: a saved pack size by its id, a new one by its place. */
export function rowKey(
  row: Pick<VariantRowValues, "variantId">,
  index: number,
) {
  return row.variantId || `new:${index}`;
}

function Row({
  form,
  index,
  variant,
  manage,
  removable,
  notice,
  onRemove,
  onRestore,
  onDisableInstead,
  onChangeStock,
}: {
  form: ProductForm;
  index: number;
  /** The pack size as the API has it; `undefined` for a row that is not saved yet. */
  variant: ProductVariant | undefined;
  manage: boolean;
  removable: boolean;
  notice: RowNotice | undefined;
  onRemove: () => void;
  onRestore: () => void;
  onDisableInstead: () => void;
  onChangeStock: (variant: ProductVariant) => void;
}) {
  const row = useWatch({ control: form.control, name: `variants.${index}` });
  const label = packLabelOf(row.packSize.value, row.packSize.unit);
  const title = label || "New pack size";
  const preview = salePreview(row);
  const state = variant ? stockState(variant.stock) : null;
  const name = (field: string) =>
    `variants.${index}.${field}` as `variants.${number}.sku`;

  return (
    <li
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-line p-3.5",
        row.removed && "border-dashed bg-canvas/50",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{title}</span>
          {variant?.isDefault ? (
            <Badge tone="neutral" dot={false} className="gap-1">
              <Star aria-hidden="true" className="size-3 fill-current" />
              Default
            </Badge>
          ) : null}
          {variant && !row.isEnabled ? (
            <Badge tone="neutral">Not offered</Badge>
          ) : null}
          {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
          {variant ? (
            <span className="text-13 text-ink-subtle tabular">
              {variant.sku} · /{variant.slug.en}
            </span>
          ) : (
            <Badge tone="planned">Not saved yet</Badge>
          )}
        </div>
        {manage ? (
          row.removed ? (
            <Button size="sm" variant="ghost" onClick={onRestore}>
              <Undo2 />
              Keep it
            </Button>
          ) : removable ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove the pack size ${title}`}
              onClick={onRemove}
            >
              <Trash2 />
              Remove
            </Button>
          ) : null
        ) : null}
      </div>

      {row.removed ? (
        <p className="text-13 text-gold">
          Removed for good when you save. Its price history goes with it; its
          stock history stays. A pack size an order holds cannot be removed:
          disable it instead.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)]">
            <TextField
              form={form}
              name={name("packSize.value")}
              label="Pack size"
              required
              inputMode="decimal"
              autoComplete="off"
              className="tabular"
              placeholder="5"
            />
            <SelectField
              form={form}
              name={name("packSize.unit")}
              label="Unit"
              required
            >
              {PACK_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {PACK_UNIT_LABEL[unit]}
                </option>
              ))}
            </SelectField>
            <MoneyField
              form={form}
              name={name("regularPrice")}
              label="Regular price"
              required
            />
            <SelectField form={form} name={name("saleMode")} label="Sale">
              {SALE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SALE_LABEL[mode]}
                </option>
              ))}
            </SelectField>
          </div>
          {row.saleMode === "price" ? (
            <MoneyField
              form={form}
              name={name("salePrice")}
              label="Sale price"
              required
              fieldClassName="sm:max-w-60"
              hint="Must be below the regular price."
            />
          ) : null}
          {row.saleMode === "percent" ? (
            <UnitField
              form={form}
              name={name("discountPercent")}
              label="Discount"
              required
              unit="%"
              placeholder="20"
              fieldClassName="sm:max-w-60"
              hint="A whole number from 1 to 99. The API sets the sale price from it."
            />
          ) : null}
          {preview ? (
            <p className="text-13 text-ink-muted" aria-live="polite">
              {row.saleMode === "percent"
                ? "Customers will pay about "
                : "Customers will pay "}
              <span className="font-semibold text-ink">
                {formatMoney(preview.price)}
              </span>
              {row.saleMode === "price"
                ? `, about ${preview.percent} % less.`
                : "."}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <TextField
              form={form}
              name={name("sku")}
              label="Article number (SKU)"
              optional={!variant}
              required={Boolean(variant)}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              className="uppercase tabular placeholder:normal-case"
              placeholder={variant ? undefined : "Generated when left empty"}
            />
            <TextField
              form={form}
              name={name("gtin")}
              label="Barcode (GTIN)"
              optional
              inputMode="numeric"
              maxLength={14}
              autoComplete="off"
              className="tabular"
            />
            <UnitField
              form={form}
              name={name("lowStockThreshold")}
              label="Low-stock threshold"
              unit="units"
              optional
              placeholder="No threshold"
            />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-line pt-3">
            {variant ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  <span className="font-semibold tabular">
                    {variant.stock.quantity}
                  </span>{" "}
                  <span className="text-ink-muted">in stock</span>
                </span>
                <ActionButton
                  permission="catalog.manage"
                  size="sm"
                  variant="ghost"
                  aria-label={`Change the stock of ${title}`}
                  onClick={() => onChangeStock(variant)}
                >
                  Change
                </ActionButton>
                <span className="text-13 text-ink-subtle">
                  Now {formatMoney(variant.pricing.price)}
                  {variant.pricing.basePrice
                    ? `, ${formatMoney(variant.pricing.basePrice.amount)} per ${
                        variant.pricing.basePrice.per === "pcs"
                          ? "piece"
                          : variant.pricing.basePrice.per
                      }`
                    : ""}
                  .
                </span>
              </div>
            ) : (
              <UnitField
                form={form}
                name={name("stockQuantity")}
                label="Opening stock"
                unit="units"
                fieldClassName="sm:max-w-60"
                hint="What is on the shelf now, recorded in the stock history. Later changes go through the stock dialog."
              />
            )}
            <SwitchField
              form={form}
              name={name("isEnabled")}
              label="Offered in the shop"
              disabled={!manage}
              hint="Off: not listed and not orderable. The product stays in the shop with its other pack sizes."
              className="sm:max-w-72"
            />
          </div>
        </>
      )}

      {notice ? (
        <Alert
          tone="danger"
          title={notice.message}
          actions={
            notice.canDisable ? (
              <Button size="sm" onClick={onDisableInstead}>
                Disable it instead
              </Button>
            ) : undefined
          }
        />
      ) : null}
    </li>
  );
}

/**
 * The pack-size table of the product form (8): one row per pack size with
 * its article number, barcode, pack, prices, enabled switch, threshold and
 * stock. A new product sends the rows with `POST /products`; an existing
 * one sends each row to its own endpoint when it is saved.
 */
export function VariantRows({
  form,
  product,
  manage,
  notices,
  onDisableInstead,
  onChangeStock,
}: {
  form: ProductForm;
  /** Set when an existing product is changed. */
  product?: ProductDetail;
  manage: boolean;
  /** What the API said about a row, by `rowKey`. */
  notices: Record<string, RowNotice>;
  onDisableInstead: (index: number) => void;
  onChangeStock: (variant: ProductVariant) => void;
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "variants",
  });
  const rows = useWatch({ control: form.control, name: "variants" });
  const live = rows.filter((row) => !row.removed);
  const byId = new Map((product?.variants ?? []).map((v) => [v.id, v]));
  const tableError = form.formState.errors.variants;
  const tableMessage =
    typeof tableError?.message === "string"
      ? tableError.message
      : typeof tableError?.root?.message === "string"
        ? tableError.root.message
        : null;

  return (
    <div className="flex flex-col gap-3">
      <ol aria-label="Pack sizes" className="flex flex-col gap-3">
        {fields.map((field, index) => {
          const row = rows[index];
          if (!row) return null;
          return (
            <Row
              key={field.id}
              form={form}
              index={index}
              variant={byId.get(row.variantId)}
              manage={manage}
              removable={live.length > 1}
              notice={notices[rowKey(row, index)]}
              onRemove={() => {
                // A row that is not saved yet simply goes; a saved one is
                // marked and removed when the product is saved.
                if (row.variantId === "") remove(index);
                else
                  form.setValue(`variants.${index}.removed`, true, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
              }}
              onRestore={() =>
                form.setValue(`variants.${index}.removed`, false, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onDisableInstead={() => onDisableInstead(index)}
              onChangeStock={onChangeStock}
            />
          );
        })}
      </ol>
      {tableMessage ? (
        <p className="text-13 text-danger-fg" role="alert">
          {tableMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ActionButton
          permission="catalog.manage"
          variant="secondary"
          icon={<Plus />}
          disabled={live.length >= VARIANTS_MAX}
          onClick={() => append(emptyVariantRow(live[0]?.packSize.unit ?? "g"))}
        >
          Add a pack size
        </ActionButton>
        <span className="text-13 text-ink-subtle">
          {plural(live.length, "pack size")} of {VARIANTS_MAX} at most. All of
          one unit family, each pack once; the smallest enabled one in stock
          stands for the product in the shop.
        </span>
      </div>
    </div>
  );
}
