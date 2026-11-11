"use client";

import { Plus, Star, Trash2, Undo2 } from "lucide-react";
import { useEffect } from "react";
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
import type { Cents, ProductDetail, ProductVariant } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { centsToInput, formatMoney } from "@/lib/format/money";
import { PACK_UNIT_LABEL, plural } from "@/lib/format/names";
import { CopyPictures } from "./copy-pictures";
import { ImageManager } from "./image-manager";
import type { SizeReader } from "./image-rules";
import { NewRowPictures } from "./new-product-pictures";
import {
  PACK_UNITS,
  SALE_MODES,
  emptyVariantRow,
  salePreview,
  type ProductFormValues,
  type SaleMode,
  type VariantRowValues,
} from "./product-schema";
import { parseCost } from "../supply/pricing";
import { variantImages } from "./queries";
import { stockState } from "./stock";
import { VARIANTS_MAX, packLabelOf } from "./variants";

type ProductForm = UseFormReturn<ProductFormValues, unknown, FieldValues>;

const SALE_LABEL: Record<SaleMode, string> = {
  none: "No sale",
  price: "Sale price",
  percent: "Discount in percent",
};

/**
 * The price the price rule gives for a buying price (cents), with the
 * category and the VAT rate as the form has them; `null` while the rule is
 * not known.
 */
export type Quote = (cost: number) => Cents | null;
const noQuote: Quote = () => null;

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
  product,
  variant,
  manage,
  removable,
  notice,
  readSize,
  quote,
  onRemove,
  onRestore,
  onDisableInstead,
  onChangeStock,
}: {
  form: ProductForm;
  index: number;
  /** The product the row belongs to; `undefined` while a new one is typed. */
  product: ProductDetail | undefined;
  /** The pack size as the API has it; `undefined` for a row that is not saved yet. */
  variant: ProductVariant | undefined;
  manage: boolean;
  removable: boolean;
  notice: RowNotice | undefined;
  /** How the size of a picture file is read; tests have no decoder. */
  readSize: SizeReader | undefined;
  /** What the price rule gives for a buying price; `null` while the rule is not known. */
  quote: Quote;
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

  // The price of a pack size that follows its buying price (31): the API
  // calculates it; the form shows what the rule gives before it is saved.
  const cost = row.auto ? parseCost(row.cost) : null;
  const calculated = cost !== null && cost > 0 ? quote(cost) : null;
  // The API wants a regular price for a new pack size also in `auto`, and
  // calculates over it: the form sends what the rule gives.
  const fill = !variant && calculated !== null && calculated >= 1;
  useEffect(() => {
    if (!fill) return;
    const text = centsToInput(calculated);
    const path = `variants.${index}.regularPrice` as const;
    if (form.getValues(path) !== text) {
      form.setValue(path, text, { shouldDirty: true, shouldValidate: true });
    }
  }, [fill, calculated, form, index]);
  // A saved pack size in `auto` shows its price and cannot be typed over;
  // a new one once the rule gave its price.
  const locked = row.auto && (variant ? true : fill);
  const priceHint = !row.auto
    ? undefined
    : !variant
      ? fill
        ? "Calculated from the buying price."
        : "Type a price: it stands until a buying price is known."
      : calculated !== null && calculated !== variant.pricing.regularPrice
        ? `Calculated. After saving: about ${formatMoney(calculated)}.`
        : variant.cost === null && cost === null
          ? "Calculated, but there is no buying price yet: it stays as it is."
          : "Calculated from the buying price.";

  return (
    <li
      aria-label={title}
      className={cn(
        "glass-inset flex flex-col gap-3 rounded-lg p-3.5",
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
            <Button
              size="sm"
              variant="ghost"
              onClick={onRestore}
              aria-label={`Keep the pack size ${title}`}
            >
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
          Removed for good when you save.{" "}
          {variant && variant.images.length > 0
            ? `Its ${variant.images.length === 1 ? "picture is" : `${variant.images.length} pictures are`} deleted with it, and its price history goes too; `
            : "Its pictures and its price history go with it; "}
          its stock history stays. A pack size an order holds cannot be removed:
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
              readOnly={locked}
              aria-readonly={locked || undefined}
              className={cn(
                "pl-7 tabular",
                locked && "bg-sunken text-ink-muted",
              )}
              hint={priceHint}
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
          <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <MoneyField
              form={form}
              name={name("cost")}
              label="Buying price"
              optional
              placeholder="Not known"
              hint="What one pack costs the shop, without VAT."
            />
            <SwitchField
              form={form}
              name={name("auto")}
              label="Price follows the buying price"
              disabled={!manage}
              hint="On: the regular price is calculated from the buying price by the price rule, and again whenever one of them changes. Off: only you change the price."
              className="sm:pt-[26px]"
            />
          </div>
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
          {/* The pictures belong to the pack size (8): a saved one has its
              gallery, which saves by itself; a new product takes the files
              along and uploads them once it exists. */}
          {product && variant ? (
            <ImageManager
              product={product}
              target={variantImages(product.id, variant)}
              readSize={readSize}
              inline
              actions={
                manage && product.variants.length > 1 ? (
                  <CopyPictures product={product} variant={variant} />
                ) : undefined
              }
            />
          ) : product ? (
            <p className="border-t border-line pt-3 text-13 text-ink-muted">
              <span className="font-semibold text-ink">Pictures</span> can be
              added here once the pack size is saved: up to 8 of its own, or
              copies of the pictures of another pack size.
            </p>
          ) : (
            <NewRowPictures
              files={row.pictures}
              onChange={(files) =>
                form.setValue(`variants.${index}.pictures`, files, {
                  shouldDirty: true,
                })
              }
              label={label}
              disabled={!manage || form.formState.isSubmitting}
              readSize={readSize}
            />
          )}
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
 * its article number, barcode, pack, prices, enabled switch, threshold,
 * stock and pictures. A new product sends the rows with `POST /products`;
 * an existing one sends each row to its own endpoint when it is saved. The
 * pictures of a saved pack size are saved by its gallery, not by the form.
 */
export function VariantRows({
  form,
  product,
  manage,
  notices,
  readSize,
  quote = noQuote,
  onDisableInstead,
  onChangeStock,
}: {
  form: ProductForm;
  /** Set when an existing product is changed. */
  product?: ProductDetail;
  manage: boolean;
  /** What the API said about a row, by `rowKey`. */
  notices: Record<string, RowNotice>;
  readSize?: SizeReader;
  /** What the price rule of the product gives for a buying price, as the form stands. */
  quote?: Quote;
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
              product={product}
              variant={byId.get(row.variantId)}
              manage={manage}
              removable={live.length > 1}
              notice={notices[rowKey(row, index)]}
              readSize={readSize}
              quote={quote}
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
