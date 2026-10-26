"use client";

import { Plus, Trash2, Undo2 } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { ActionButton } from "@/components/domain/permission";
import { SwitchField, UnitField } from "@/components/form/fields";
import { SelectField, TextField } from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/surface";
import type { WholesaleProductDetail, WholesaleSku } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { PACK_UNIT_LABEL, plural } from "@/lib/format/names";
import {
  LIMITS,
  PACK_UNITS,
  emptySkuRow,
  rowLabel,
  type ProductFormValues,
  type SkuRowValues,
} from "./product-schema";
import { cartonsOf, skuStockState } from "./rules";

type ProductForm = UseFormReturn<ProductFormValues, unknown, FieldValues>;

/** What the API said about one row when the product was saved, with the way out. */
export interface RowNotice {
  message: string;
  /** The SKU cannot be removed (the last one): offer to disable it instead. */
  canDisable: boolean;
}

/** The key of a row for notices: a saved SKU by its id, a new one by its place. */
export function rowKey(row: Pick<SkuRowValues, "skuId">, index: number) {
  return row.skuId || `new:${index}`;
}

function Row({
  form,
  index,
  sku,
  manage,
  removable,
  notice,
  onRemove,
  onRestore,
  onDisableInstead,
  onSetStock,
}: {
  form: ProductForm;
  index: number;
  /** The SKU as the API has it; `undefined` for a row that is not saved yet. */
  sku: WholesaleSku | undefined;
  manage: boolean;
  removable: boolean;
  notice: RowNotice | undefined;
  onRemove: () => void;
  onRestore: () => void;
  onDisableInstead: () => void;
  onSetStock: (sku: WholesaleSku) => void;
}) {
  const row = useWatch({ control: form.control, name: `skus.${index}` });
  const label = rowLabel(row);
  const title = label === "a new SKU" ? "New SKU" : label;
  const state = sku ? skuStockState(sku.stock) : null;
  const name = (field: string) =>
    `skus.${index}.${field}` as `skus.${number}.sku`;

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
          {sku && !row.isEnabled ? (
            <Badge tone="neutral">Not offered</Badge>
          ) : null}
          {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
          {sku ? (
            <span className="text-13 text-ink-subtle tabular">
              {sku.sku} · a carton is {sku.carton.label},{" "}
              {sku.carton.content.label}
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
              aria-label={`Remove the SKU ${title}`}
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
          Removed for good when you save. Its stock history stays. Quotations
          that name it keep their own copy of the line.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            <UnitField
              form={form}
              name={name("unitsPerCarton")}
              label="Packs per carton"
              required
              unit="packs"
              placeholder="20"
              hint={`${LIMITS.cartonMin} to ${LIMITS.cartonMax.toLocaleString("en")}. The API works out the carton from it.`}
            />
            <TextField
              form={form}
              name={name("sku")}
              label="Article number (SKU)"
              optional={!sku}
              required={Boolean(sku)}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              className="uppercase tabular placeholder:normal-case"
              placeholder={sku ? undefined : "Generated when left empty"}
            />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-line pt-3">
            {sku ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  <span
                    className={cn(
                      "font-semibold tabular",
                      sku.stock < 0 && "text-danger-fg",
                    )}
                  >
                    {sku.stock}
                  </span>{" "}
                  <span className="text-ink-muted">
                    {sku.stock === 1 || sku.stock === -1
                      ? "carton on hand"
                      : "cartons on hand"}
                  </span>
                </span>
                <ActionButton
                  permission="wholesale.manage"
                  size="sm"
                  variant={sku.stock < 0 ? "primary" : "ghost"}
                  aria-label={`Set the stock of ${title}`}
                  onClick={() => onSetStock(sku)}
                >
                  Set stock
                </ActionButton>
              </div>
            ) : (
              <UnitField
                form={form}
                name={name("stock")}
                label="Opening stock"
                unit="cartons"
                fieldClassName="sm:max-w-60"
                hint="Cartons on hand now, recorded in the stock history. Later changes go through the stock dialog."
              />
            )}
            <SwitchField
              form={form}
              name={name("isEnabled")}
              label="Offered on the wholesale site"
              disabled={!manage}
              hint="Off: the carton cannot be asked for. The product stays on the site with its other SKUs."
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
 * The SKU table of the product form (25): one row per SKU with its pack
 * size, its packs per carton, its article number, its enabled switch and
 * its stock in cartons. A new product sends the rows with `POST
 * …/products`; an existing one sends each row to its own endpoint.
 */
export function SkuRows({
  form,
  product,
  manage,
  notices,
  tableNotice,
  onDisableInstead,
  onSetStock,
}: {
  form: ProductForm;
  /** Set when an existing product is changed. */
  product?: WholesaleProductDetail;
  manage: boolean;
  /** What the API said about a row, by `rowKey`. */
  notices: Record<string, RowNotice>;
  /** What the API said about the SKUs as a set (`WHOLESALE_SKU_INVALID`). */
  tableNotice: string | null;
  onDisableInstead: (index: number) => void;
  onSetStock: (sku: WholesaleSku) => void;
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "skus",
  });
  const rows = useWatch({ control: form.control, name: "skus" });
  const live = rows.filter((row) => !row.removed);
  const byId = new Map((product?.skus ?? []).map((sku) => [sku.id, sku]));
  const tableError = form.formState.errors.skus;
  const tableMessage =
    typeof tableError?.message === "string"
      ? tableError.message
      : typeof tableError?.root?.message === "string"
        ? tableError.root.message
        : null;
  const onHand = product?.stock.quantity;

  return (
    <div className="flex flex-col gap-3">
      {tableNotice ? (
        <Alert tone="danger" title="The SKUs do not fit together">
          {tableNotice}
        </Alert>
      ) : null}
      <ol aria-label="SKUs" className="flex flex-col gap-3">
        {fields.map((field, index) => {
          const row = rows[index];
          if (!row) return null;
          return (
            <Row
              key={field.id}
              form={form}
              index={index}
              sku={byId.get(row.skuId)}
              manage={manage}
              removable={live.length > 1}
              notice={notices[rowKey(row, index)]}
              onRemove={() => {
                if (row.skuId === "") remove(index);
                else
                  form.setValue(`skus.${index}.removed`, true, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
              }}
              onRestore={() =>
                form.setValue(`skus.${index}.removed`, false, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onDisableInstead={() => onDisableInstead(index)}
              onSetStock={onSetStock}
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
          permission="wholesale.manage"
          variant="secondary"
          icon={<Plus />}
          disabled={live.length >= LIMITS.skus}
          onClick={() => append(emptySkuRow(live[0]?.packSize.unit ?? "kg"))}
        >
          Add a SKU
        </ActionButton>
        <span className="text-13 text-ink-subtle">
          {plural(live.length, "SKU")} of {LIMITS.skus} at most. All of one unit
          family; the same pack in two carton sizes is fine.
          {onHand !== undefined ? ` ${cartonsOf(onHand)} on hand in all.` : ""}
        </span>
      </div>
    </div>
  );
}
