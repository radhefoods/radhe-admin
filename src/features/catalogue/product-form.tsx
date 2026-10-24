"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Controller } from "react-hook-form";
import { ActionButton } from "@/components/domain/permission";
import {
  BilingualField,
  SwitchField,
  UnitField,
  UnsavedGuard,
} from "@/components/form/fields";
import {
  Field,
  FormError,
  SelectField,
  TextField,
  TextareaField,
  applyFieldErrors,
  useControlProps,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type {
  ProductDetail,
  ProductInput,
  ProductStatus,
  ProductVariant,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { plural, translated } from "@/lib/format/names";
import { indentedName } from "./category-tree";
import {
  LIMITS,
  PRODUCT_FIELD_ALIASES,
  PRODUCT_STATUSES,
  STORAGE_TYPES,
  isVariantError,
  planIsEmpty,
  planOf,
  productDefaults,
  productErrorField,
  productSchema,
  toProductInput,
  toTag,
  variantErrorRow,
  variantFieldAliases,
  variantRow,
  type ProductFormValues,
  type ProductPlan,
} from "./product-schema";
import {
  useCategories,
  useSaveProduct,
  type SaveReport,
  type SaveStep,
} from "./queries";
import { StockDialog } from "./stock-panel";
import { TagListField } from "./tag-list-field";
import { VariantRows, rowKey, type RowNotice } from "./variant-rows";

/** What a status means for the shop (documentation, 8). */
export const STATUS_MEANING: Record<
  ProductStatus,
  { label: string; hint: string }
> = {
  draft: {
    label: "Draft",
    hint: "Being prepared. Customers do not see it. A draft can still be deleted.",
  },
  active: {
    label: "Active",
    hint: "Part of the shop. Customers can order its pack sizes while they are offered and in stock.",
  },
  archived: {
    label: "Archived",
    hint: "Taken out of the shop. Old orders and invoices keep it.",
  },
};

const STORAGE_LABEL = {
  ambient: "Ambient (dry goods)",
  chilled: "Chilled",
  frozen: "Frozen",
} as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={id} aria-label={title} className="scroll-mt-20">
      <CardHeader title={title} description={description} />
      <CardBody className="flex flex-col gap-4">{children}</CardBody>
    </Card>
  );
}

/** A choice between a few named options, each with what it means. */
function Choice<V extends string>({
  label,
  value,
  onChange,
  onBlur,
  options,
  inline = false,
  disabled = false,
}: {
  /** What is chosen, for screen readers: "Status". */
  label: string;
  value: V;
  onChange: (value: V) => void;
  onBlur?: () => void;
  options: { value: V; label: string; hint?: string }[];
  inline?: boolean;
  disabled?: boolean;
}) {
  const control = useControlProps();
  return (
    <RadioGroup
      {...control}
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as V)}
      onBlur={onBlur}
      className={inline ? "flex-row flex-wrap gap-x-5 gap-y-2" : "gap-3"}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-start gap-2.5"
        >
          <RadioItem value={option.value} className="mt-0.5" />
          <span className="text-sm text-ink">
            {option.label}
            {option.hint ? (
              <span className="block text-13 text-ink-muted">
                {option.hint}
              </span>
            ) : null}
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

/** The words for what a save did: "the product details and 2 pack sizes". */
function describe(steps: SaveStep[]): string {
  const product = steps.some((step) => step.kind === "product");
  const sizes = steps.filter((step) => step.kind !== "product");
  const parts = [
    ...(product ? ["the product details"] : []),
    ...(sizes.length > 0
      ? [
          sizes.length === 1
            ? `the pack size ${sizes[0]!.label}`
            : plural(sizes.length, "pack size"),
        ]
      : []),
  ];
  return parts.join(" and ");
}

/**
 * The form after a save that stopped at a refusal: the product as the API
 * has it now, with the rows that were not saved as they were typed, so
 * that saving again sends only what is still different and nothing twice.
 */
function afterPartialSave(
  values: ProductFormValues,
  report: SaveReport,
): ProductFormValues {
  const unsaved = [report.failed!.step, ...report.pending];
  const unsavedIds = new Set(
    unsaved.flatMap((step) => (step.variantId ? [step.variantId] : [])),
  );
  const unsavedRows = new Set(
    unsaved.flatMap((step) => (step.row !== undefined ? [step.row] : [])),
  );
  const typed = new Map(
    values.variants
      .filter((row) => row.variantId !== "")
      .map((row) => [row.variantId, row]),
  );
  const rows = report.product.variants.map((variant) => {
    const row = typed.get(variant.id);
    return unsavedIds.has(variant.id) && row ? row : variantRow(variant);
  });
  values.variants.forEach((row, index) => {
    if (row.variantId === "" && unsavedRows.has(index)) rows.push(row);
  });
  const productUnsaved = unsaved.some((step) => step.kind === "product");
  const base = productUnsaved ? values : productDefaults(report.product);
  return { ...base, variants: rows };
}

/**
 * The form of a product, for a new one and for changing one, with the
 * pack-size table. A new product goes to the API in one request. An
 * existing one is saved in a sequence: the product fields, then every pack
 * size that is removed, changed or added; the sequence stops at the first
 * refusal, what went through stays saved, and the form says what is left.
 */
export function ProductForm({
  product,
  categoryId,
  onCreate,
  onSaved,
  onCancel,
  pictures,
  alsoUnsaved = false,
}: {
  /** Set when an existing product is changed. */
  product?: ProductDetail;
  /** The category a new product starts in (the list was filtered by it). */
  categoryId?: string;
  onCreate?: (input: ProductInput) => Promise<unknown>;
  /** An existing product was saved, wholly or in part: the product as the API has it now. */
  onSaved?: (product: ProductDetail) => void;
  onCancel?: () => void;
  /** For a new product: the pictures that go with it, as a part of the form. */
  pictures?: ReactNode;
  /** Something outside the fields would be lost on leaving (chosen pictures). */
  alsoUnsaved?: boolean;
}) {
  const creating = !product;
  const manage = useCan()("catalog.manage");
  const schema = useMemo(() => productSchema({ creating }), [creating]);
  const form = useZodForm(schema, {
    defaultValues: product
      ? productDefaults(product)
      : { ...productDefaults(), categoryId: categoryId ?? "" },
  });
  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data?.items;
  const save = useSaveProduct(product?.id ?? "");
  const [confirming, setConfirming] = useState<{
    values: ProductFormValues;
    plan: ProductPlan;
  } | null>(null);
  const [report, setReport] = useState<SaveReport | null>(null);
  const [notices, setNotices] = useState<Record<string, RowNotice>>({});
  const [changingStock, setChangingStock] = useState<ProductVariant | null>(
    null,
  );

  // The product the form was last brought in line with: a save compares
  // against it, so a field nobody touched here is never sent.
  const baseline = useRef(product);
  useEffect(() => {
    if (!product || product === baseline.current) return;
    // The same product loaded again (after a save) changes nothing here.
    if (JSON.stringify(product) === JSON.stringify(baseline.current)) {
      baseline.current = product;
      return;
    }
    baseline.current = product;
    form.reset(productDefaults(product), { keepDirtyValues: true });
  }, [product, form]);

  /** Runs the sequence of requests and brings the form in line with what came of it. */
  async function run(values: ProductFormValues, plan: ProductPlan) {
    const base = baseline.current!;
    const result = await save.mutateAsync({ product: base, plan });
    baseline.current = result.product;
    onSaved?.(result.product);
    setNotices({});
    if (!result.failed) {
      form.reset(productDefaults(result.product));
      setReport(null);
      notify.success(
        `${translated(result.product.name)} saved`,
        `Saved: ${describe(result.done)}.`,
      );
      return;
    }
    // What was not saved stays in the form as typed; the rest follows the API.
    const merged = afterPartialSave(values, result);
    form.reset(productDefaults(result.product));
    form.reset(merged, { keepDefaultValues: true });
    setReport(result);
    const { step, error } = result.failed;
    if (step.kind === "product") {
      const field = productErrorField(error, "none");
      if (field && !isVariantError(field)) {
        form.setError(
          field,
          { type: "server", message: errorMessage(error) },
          { shouldFocus: true },
        );
      } else {
        applyFieldErrors(form, error, PRODUCT_FIELD_ALIASES);
      }
      return;
    }
    const index =
      step.kind === "add"
        ? result.product.variants.length
        : merged.variants.findIndex((row) => row.variantId === step.variantId);
    const row = merged.variants[index];
    if (!row) return;
    const key = rowKey(row, index);
    if (step.kind === "remove") {
      setNotices({
        [key]: {
          message: errorMessage(error),
          canDisable:
            hasErrorCode(error, "PRODUCT_VARIANT_IN_USE") ||
            hasErrorCode(error, "PRODUCT_VARIANT_LAST"),
        },
      });
      return;
    }
    const field = productErrorField(error, row.saleMode);
    if (field && isVariantError(field)) {
      form.setError(
        `variants.${index}.${field}`,
        { type: "server", message: errorMessage(error) },
        { shouldFocus: true },
      );
      return;
    }
    const unplaced = applyFieldErrors(form, error, variantFieldAliases(index));
    const placed =
      Object.keys(unplaced).length === 0 &&
      Object.keys(form.formState.errors).length > 0;
    if (!placed) {
      setNotices({
        [key]: { message: errorMessage(error), canDisable: false },
      });
    }
  }

  const {
    onSubmit: submit,
    state,
    pending,
  } = useSubmit(
    form,
    async (values: ProductFormValues) => {
      setReport(null);
      setNotices({});
      if (!baseline.current) {
        try {
          await onCreate?.(toProductInput(values));
        } catch (error) {
          // A documented refusal that belongs to a field is shown there; one
          // about a pack size at its row, when the row can be told.
          const row = variantErrorRow(error, values.variants);
          const field = productErrorField(
            error,
            row === null ? "none" : values.variants[row]!.saleMode,
          );
          if (!field) throw error;
          if (isVariantError(field)) {
            if (row === null) throw error;
            form.setError(
              `variants.${row}.${field}`,
              { type: "server", message: errorMessage(error) },
              { shouldFocus: true },
            );
            return;
          }
          form.setError(
            field,
            { type: "server", message: errorMessage(error) },
            { shouldFocus: true },
          );
        }
        return;
      }
      const plan = planOf(values, baseline.current);
      if (planIsEmpty(plan)) {
        form.reset(productDefaults(baseline.current));
        notify.info("Nothing to save", "The product already has these values.");
        return;
      }
      if (plan.remove.length > 0) {
        setConfirming({ values, plan });
        return;
      }
      await run(values, plan);
    },
    { aliases: PRODUCT_FIELD_ALIASES },
  );

  const dirty = form.formState.isDirty;
  const problems = Object.keys(form.formState.errors).length;
  // The category of the product is an option from the first moment on, also
  // while the list still loads: the select never shows another one meanwhile.
  const own =
    product && !categories?.some((entry) => entry.id === product.categoryId)
      ? [{ id: product.categoryId, label: translated(product.category.name) }]
      : [];
  const categoryOptions = [
    ...own,
    ...(categories ?? []).map((entry) => ({
      id: entry.id,
      label: indentedName(entry),
    })),
  ];
  const removing = confirming?.plan.remove ?? [];
  const staying = confirming
    ? confirming.values.variants.filter((row) => !row.removed)
    : [];

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6">
      <UnsavedGuard
        when={(dirty || alsoUnsaved) && !form.formState.isSubmitSuccessful}
      />

      <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-6">
        <legend className="sr-only">
          {creating ? "New product" : "Product"}
        </legend>

        <Section id="basics" title="Basics">
          <BilingualField
            form={form}
            name="name"
            label="Name"
            requiredEn
            maxLength={LIMITS.name}
            hint="Without the pack size: the shop adds it, “Basmati Rice (1 kg)”."
          />
          <BilingualField
            form={form}
            name="subtitle"
            label="Subtitle"
            maxLength={LIMITS.short}
            hint="A short line under the name. Optional."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              form={form}
              name="categoryId"
              label="Category"
              required
              hint={
                categoriesQuery.isError ? (
                  <span className="text-danger-fg">
                    The categories could not be loaded.{" "}
                    <button
                      type="button"
                      className="font-semibold underline underline-offset-2"
                      onClick={() => void categoriesQuery.refetch()}
                    >
                      Try again
                    </button>
                  </span>
                ) : undefined
              }
            >
              <option value="">Choose a category</option>
              {categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <TextField
              form={form}
              name="brand"
              label="Brand"
              optional
              maxLength={LIMITS.brand}
              autoComplete="off"
            />
          </div>
        </Section>

        {pictures}

        <Section
          id="pack-sizes"
          title="Pack sizes and prices"
          description="Each pack size has its own article number, price and stock; the VAT rate is the product's. Prices are typed in euros and include VAT."
        >
          <div className="flex items-start gap-2 sm:max-w-80">
            <UnitField
              form={form}
              name="vatRate"
              label="VAT rate"
              required
              unit="%"
              decimal
              placeholder="7"
              fieldClassName="flex-1"
              hint="Contained in every price. The same for every pack size."
            />
            <div className="flex gap-1 pt-[26px]">
              {["7", "19"].map((rate) => (
                <Button
                  key={rate}
                  variant="ghost"
                  className="px-2.5"
                  aria-label={`Set the VAT rate to ${rate} percent`}
                  onClick={() =>
                    form.setValue("vatRate", rate, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  {rate} %
                </Button>
              ))}
            </div>
          </div>
          <VariantRows
            form={form}
            product={product}
            manage={manage}
            notices={notices}
            onDisableInstead={(index) => {
              form.setValue(`variants.${index}.removed`, false, {
                shouldDirty: true,
              });
              form.setValue(`variants.${index}.isEnabled`, false, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setNotices({});
            }}
            onChangeStock={setChangingStock}
          />
        </Section>

        <Section id="status" title="Status and ordering">
          <Field label="Status">
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Choice
                  label="Status"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={!manage}
                  options={PRODUCT_STATUSES.map((status) => ({
                    value: status,
                    ...STATUS_MEANING[status],
                  }))}
                />
              )}
            />
          </Field>
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <SwitchField
              form={form}
              name="isAvailable"
              label="Available"
              disabled={!manage}
              hint="Switch it off while the product cannot be supplied: every pack size is shown as sold out. A pack size with a stock of 0 is sold out on its own."
            />
            <SwitchField
              form={form}
              name="isFeatured"
              label="Featured"
              disabled={!manage}
              hint="Marks the product for the shop's featured places."
            />
          </div>
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <UnitField
              form={form}
              name="minOrderQuantity"
              label="Smallest order quantity"
              required
              hint="Packs a customer orders at least, of any pack size: 1 to 10,000."
            />
            <UnitField
              form={form}
              name="maxOrderQuantity"
              label="Largest order quantity"
              optional
              placeholder="No limit"
              hint="Packs a customer orders at most. Empty: no limit."
            />
            <UnitField
              form={form}
              name="sortOrder"
              label="Position in its category"
              optional
              placeholder={product ? undefined : "Last"}
              hint={
                product
                  ? "0 comes first. The order page of the category (Categories, then Product order) is the easier tool."
                  : "0 comes first; empty puts the product last in its category. The order page of the category (Categories, then Product order) is the easier tool."
              }
            />
            <SelectField form={form} name="storageType" label="Storage">
              {product && !product.storageType ? (
                <option value="">Not set</option>
              ) : null}
              {STORAGE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {STORAGE_LABEL[type]}
                </option>
              ))}
            </SelectField>
          </div>
        </Section>

        <Section
          id="texts"
          title="Texts"
          description="English is what the shop falls back to. A language that is still empty is marked."
        >
          <BilingualField
            form={form}
            name="shortDescription"
            label="Short description"
            multiline
            rows={2}
            maxLength={LIMITS.short}
            hint="One or two sentences for listings. At most 300 characters."
          />
          <BilingualField
            form={form}
            name="description"
            label="Description"
            multiline
            rows={6}
            maxLength={LIMITS.long}
          />
          <BilingualField
            form={form}
            name="highlights"
            label="Highlights"
            multiline
            rows={3}
            hint="One per line, at most 20 in each language."
          />
          <BilingualField
            form={form}
            name="uses"
            label="Uses"
            multiline
            rows={3}
            hint="What it is used for. One per line, at most 20 in each language."
          />
        </Section>

        <Section
          id="food"
          title="Food information"
          description="What the label of the product says, in each language."
        >
          <BilingualField
            form={form}
            name="food.ingredients"
            label="Ingredients"
            multiline
            rows={3}
            maxLength={LIMITS.long}
          />
          <BilingualField
            form={form}
            name="food.allergens"
            label="Allergens"
            multiline
            rows={2}
            maxLength={LIMITS.long}
          />
          <BilingualField
            form={form}
            name="food.nutrition"
            label="Nutrition"
            multiline
            rows={3}
            maxLength={LIMITS.long}
            hint="For example: Energy 1,480 kJ / 350 kcal, Fat 0.6 g, …"
          />
          <BilingualField
            form={form}
            name="food.storageInstructions"
            label="Storage instructions"
            multiline
            rows={2}
            maxLength={LIMITS.long}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="food.origin"
              label="Origin"
              optional
              maxLength={LIMITS.origin}
              placeholder="India"
            />
            <TextareaField
              form={form}
              name="food.manufacturer"
              label="Manufacturer"
              optional
              rows={2}
              maxLength={LIMITS.manufacturer}
              className="min-h-0"
              hint="Name and address."
            />
          </div>
        </Section>

        <Section id="seo" title="Search and SEO">
          <TagListField
            form={form}
            name="tags"
            label="Tags"
            noun="tag"
            max={LIMITS.tags}
            normalize={toTag}
            disabled={!manage}
            placeholder="vegan, new …"
            hint="Lower-case words joined by hyphens. Enter or a comma adds a tag."
          />
          <TagListField
            form={form}
            name="searchKeywords"
            label="Search keywords"
            noun="keyword"
            max={LIMITS.keywords}
            normalize={(text) => text.trim().slice(0, LIMITS.keywordMax)}
            accepts={(entry) => entry.length >= LIMITS.keywordMin}
            disabled={!manage}
            placeholder="Reis, chawal …"
            hint="Other words customers search with: other spellings, the name in another language. 2 to 60 characters each."
          />
          <BilingualField
            form={form}
            name="seo.title"
            label="SEO title"
            maxLength={LIMITS.short}
            hint="The title search engines show. Optional."
          />
          <BilingualField
            form={form}
            name="seo.description"
            label="SEO description"
            multiline
            rows={2}
            maxLength={LIMITS.short}
            hint="At most 300 characters. Optional."
          />
          <BilingualField
            form={form}
            name="slug"
            label="Address in the shop (slug)"
            maxLength={LIMITS.slug}
            hint={
              creating
                ? "The base of the URLs: each pack size adds its pack to it (basmati-rice-1kg). Generated from the name when left empty."
                : "The base of the URLs of every pack size (basmati-rice-1kg). Changing it renames them all and breaks links to the old addresses."
            }
          />
        </Section>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-line bg-surface px-4 pt-3 pb-safe sm:mx-0 sm:px-0 sm:pb-3">
        <FormError state={state} />
        {report?.failed ? (
          <Alert
            tone="warning"
            title={
              report.done.length > 0
                ? `Saved: ${describe(report.done)}. Not saved: ${report.failed.step.label}.`
                : `Not saved: ${report.failed.step.label}.`
            }
          >
            {errorMessage(report.failed.error)}
            {report.pending.length > 0
              ? ` ${plural(report.pending.length, "further change")} ${
                  report.pending.length === 1 ? "was" : "were"
                } not sent.`
              : ""}{" "}
            What was saved stays saved; save again to send what is left.
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 text-13 text-ink-muted" aria-live="polite">
            {problems > 0 && form.formState.submitCount > 0 ? (
              <span className="font-medium text-danger-fg">
                {problems === 1
                  ? "One part of the form needs your attention."
                  : `${problems} parts of the form need your attention.`}
              </span>
            ) : creating ? (
              <span className="hidden sm:inline">
                It is saved with the status you chose: a draft stays out of the
                shop.
              </span>
            ) : dirty ? (
              <span className="font-medium text-gold">Unsaved changes</span>
            ) : (
              <span className="hidden sm:inline">No unsaved changes</span>
            )}
          </p>
          <div className="ml-auto flex gap-2">
            {creating ? (
              <Button
                variant="ghost"
                size="lg"
                onClick={onCancel}
                disabled={pending}
              >
                Cancel
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="lg"
                disabled={!dirty || pending}
                onClick={() => {
                  form.reset(productDefaults(baseline.current));
                  setReport(null);
                  setNotices({});
                }}
              >
                Discard changes
              </Button>
            )}
            <ActionButton
              type="submit"
              permission="catalog.manage"
              variant="primary"
              size="lg"
              loading={pending || save.isPending}
              disabled={!creating && !dirty}
            >
              {creating ? "Create product" : "Save changes"}
            </ActionButton>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          removing.length === 1
            ? `Remove the pack size ${removing[0]!.packSize.label}?`
            : `Remove ${plural(removing.length, "pack size")}?`
        }
        description="Removed for good when the product is saved. The price history of a removed pack size goes with it; its stock history stays. A pack size an order holds cannot be removed: the API says so, and you can disable it instead."
        facts={[
          {
            label: "Removed",
            value: removing.map((entry) => entry.packSize.label).join(", "),
          },
          {
            label: staying.length === 1 ? "Stays" : "Stay",
            value:
              staying
                .map((row) => `${row.packSize.value} ${row.packSize.unit}`)
                .join(", ") || "None",
          },
        ]}
        confirmLabel={
          removing.length === 1
            ? `Save and remove ${removing[0]!.packSize.label}`
            : `Save and remove ${removing.length} pack sizes`
        }
        cancelLabel="Keep them"
        tone="danger"
        onConfirm={async () => {
          if (!confirming) return;
          const { values, plan } = confirming;
          setConfirming(null);
          await run(values, plan);
        }}
      />

      {product && changingStock ? (
        <StockDialog
          product={product}
          variant={
            product.variants.find((entry) => entry.id === changingStock.id) ??
            changingStock
          }
          open
          onOpenChange={(open) => {
            if (!open) setChangingStock(null);
          }}
        />
      ) : null}
    </form>
  );
}
