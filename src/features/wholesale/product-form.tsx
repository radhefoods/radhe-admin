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
import { TagListField } from "@/features/catalogue/tag-list-field";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type {
  ProductStatus,
  WholesaleProductDetail,
  WholesaleProductInput,
  WholesaleSku,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { plural, translated } from "@/lib/format/names";
import {
  LIMITS,
  PRODUCT_FIELD_ALIASES,
  PRODUCT_STATUSES,
  STORAGE_TYPES,
  planIsEmpty,
  planOf,
  productDefaults,
  productErrorField,
  productSchema,
  skuErrorRow,
  skuFieldAliases,
  skuRow,
  toProductInput,
  type ProductFormValues,
  type ProductPlan,
} from "./product-schema";
import {
  useSaveWholesaleProduct,
  useWholesaleCategories,
  type SaveReport,
  type SaveStep,
} from "./queries";
import { SkuRows, rowKey, type RowNotice } from "./sku-rows";
import { StockDialog } from "./stock-dialog";

/** What a status means for the wholesale site (25). */
export const STATUS_MEANING: Record<
  ProductStatus,
  { label: string; hint: string }
> = {
  draft: {
    label: "Draft",
    hint: "Being prepared. Not on the wholesale site.",
  },
  active: {
    label: "Active",
    hint: "On the wholesale site, with every SKU that is offered. Business customers can ask for it.",
  },
  archived: {
    label: "Archived",
    hint: "Taken off the wholesale site. Quotations keep their own copy of its lines.",
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
  disabled = false,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  onBlur?: () => void;
  options: { value: V; label: string; hint?: string }[];
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
      className="gap-3"
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

/** The words for what a save did: "the product details and 2 SKUs". */
function describe(steps: SaveStep[]): string {
  const product = steps.some((step) => step.kind === "product");
  const skus = steps.filter((step) => step.kind !== "product");
  const parts = [
    ...(product ? ["the product details"] : []),
    ...(skus.length > 0
      ? [
          skus.length === 1
            ? `the SKU ${skus[0]!.label}`
            : plural(skus.length, "SKU"),
        ]
      : []),
  ];
  return parts.join(" and ");
}

/**
 * The form after a save that stopped at a refusal: the product as the API
 * has it now, with the rows that were not saved as they were typed.
 */
function afterPartialSave(
  values: ProductFormValues,
  report: SaveReport,
): ProductFormValues {
  const unsaved = [report.failed!.step, ...report.pending];
  const unsavedIds = new Set(
    unsaved.flatMap((step) => (step.skuId ? [step.skuId] : [])),
  );
  const unsavedRows = new Set(
    unsaved.flatMap((step) => (step.row !== undefined ? [step.row] : [])),
  );
  const typed = new Map(
    values.skus
      .filter((row) => row.skuId !== "")
      .map((row) => [row.skuId, row]),
  );
  const rows = report.product.skus.map((sku) => {
    const row = typed.get(sku.id);
    return unsavedIds.has(sku.id) && row ? row : skuRow(sku);
  });
  values.skus.forEach((row, index) => {
    if (row.skuId === "" && unsavedRows.has(index)) rows.push(row);
  });
  const productUnsaved = unsaved.some((step) => step.kind === "product");
  const base = productUnsaved ? values : productDefaults(report.product);
  return { ...base, skus: rows };
}

/**
 * The form of a wholesale product, for a new one and for changing one,
 * with the SKU table. A new product goes to the API in one request. An
 * existing one is saved in a sequence: the product fields, then every SKU
 * that is removed, changed or added; the sequence stops at the first
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
  product?: WholesaleProductDetail;
  /** The category a new product starts in (the list was filtered by it). */
  categoryId?: string;
  onCreate?: (input: WholesaleProductInput) => Promise<unknown>;
  onSaved?: (product: WholesaleProductDetail) => void;
  onCancel?: () => void;
  /** For a new product: the pictures that go with it, as a part of the form. */
  pictures?: ReactNode;
  /** Something outside the fields would be lost on leaving (chosen pictures). */
  alsoUnsaved?: boolean;
}) {
  const creating = !product;
  const manage = useCan()("wholesale.manage");
  const schema = useMemo(() => productSchema({ creating }), [creating]);
  const form = useZodForm(schema, {
    defaultValues: product
      ? productDefaults(product)
      : { ...productDefaults(), categoryId: categoryId ?? "" },
  });
  const categoriesQuery = useWholesaleCategories();
  const categories = categoriesQuery.data?.items;
  const save = useSaveWholesaleProduct(product?.id ?? "");
  const [confirming, setConfirming] = useState<{
    values: ProductFormValues;
    plan: ProductPlan;
  } | null>(null);
  const [report, setReport] = useState<SaveReport | null>(null);
  const [notices, setNotices] = useState<Record<string, RowNotice>>({});
  const [tableNotice, setTableNotice] = useState<string | null>(null);
  const [settingStock, setSettingStock] = useState<WholesaleSku | null>(null);

  // The product the form was last brought in line with: a save compares
  // against it, so a field nobody touched here is never sent.
  const baseline = useRef(product);
  useEffect(() => {
    if (!product || product === baseline.current) return;
    if (JSON.stringify(product) === JSON.stringify(baseline.current)) {
      baseline.current = product;
      return;
    }
    baseline.current = product;
    form.reset(productDefaults(product), { keepDirtyValues: true });
  }, [product, form]);

  /** Puts a refusal of the API where it belongs: a field, a row, the table, or above the buttons. */
  function place(
    error: unknown,
    rows: ProductFormValues["skus"],
    row: number | null,
  ): boolean {
    const field = productErrorField(error);
    if (field === "skus") {
      setTableNotice(errorMessage(error));
      return true;
    }
    if (field === "sku") {
      const index = row ?? skuErrorRow(error, rows);
      if (index === null) {
        setTableNotice(errorMessage(error));
        return true;
      }
      form.setError(
        `skus.${index}.sku`,
        { type: "server", message: errorMessage(error) },
        { shouldFocus: true },
      );
      return true;
    }
    if (field) {
      form.setError(
        field,
        { type: "server", message: errorMessage(error) },
        { shouldFocus: true },
      );
      return true;
    }
    return false;
  }

  /** Runs the sequence of requests and brings the form in line with what came of it. */
  async function run(values: ProductFormValues, plan: ProductPlan) {
    const base = baseline.current!;
    const result = await save.mutateAsync({ product: base, plan });
    baseline.current = result.product;
    onSaved?.(result.product);
    setNotices({});
    setTableNotice(null);
    if (!result.failed) {
      form.reset(productDefaults(result.product));
      setReport(null);
      notify.success(
        `${translated(result.product.name)} saved`,
        `Saved: ${describe(result.done)}.`,
      );
      return;
    }
    const merged = afterPartialSave(values, result);
    form.reset(productDefaults(result.product));
    form.reset(merged, { keepDefaultValues: true });
    setReport(result);
    const { step, error } = result.failed;
    if (step.kind === "product") {
      if (!place(error, merged.skus, null)) {
        applyFieldErrors(form, error, PRODUCT_FIELD_ALIASES);
      }
      return;
    }
    const index =
      step.kind === "add"
        ? result.product.skus.length
        : merged.skus.findIndex((row) => row.skuId === step.skuId);
    const row = merged.skus[index];
    if (!row) return;
    const key = rowKey(row, index);
    if (step.kind === "remove") {
      setNotices({
        [key]: {
          message: errorMessage(error),
          canDisable: hasErrorCode(error, "WHOLESALE_SKU_LAST"),
        },
      });
      return;
    }
    if (place(error, merged.skus, index)) return;
    const unplaced = applyFieldErrors(form, error, skuFieldAliases(index));
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
      setTableNotice(null);
      if (!baseline.current) {
        try {
          await onCreate?.(toProductInput(values));
        } catch (error) {
          if (!place(error, values.skus, null)) throw error;
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
  const own =
    product && !categories?.some((entry) => entry.id === product.categoryId)
      ? [{ id: product.categoryId, label: translated(product.category.name) }]
      : [];
  const categoryOptions = [
    ...own,
    ...(categories ?? []).map((entry) => ({
      id: entry.id,
      label: entry.isVisible ? entry.name.en : `${entry.name.en} (hidden)`,
    })),
  ];
  const removing = confirming?.plan.remove ?? [];

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6">
      <UnsavedGuard
        when={(dirty || alsoUnsaved) && !form.formState.isSubmitSuccessful}
      />

      <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-6">
        <legend className="sr-only">
          {creating ? "New wholesale product" : "Wholesale product"}
        </legend>

        <Section id="basics" title="Basics">
          <BilingualField
            form={form}
            name="name"
            label="Name"
            requiredEn
            maxLength={LIMITS.name}
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
              label="Wholesale category"
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
          id="skus"
          title="SKUs and cartons"
          description="Each SKU is a pack size in its carton, with its own article number and its stock in cartons. The VAT rate is the product's and goes into every quotation line. No prices here: the admin prices each quotation."
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
              hint="Copied into every quotation line."
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
          <SkuRows
            form={form}
            product={product}
            manage={manage}
            notices={notices}
            tableNotice={tableNotice}
            onDisableInstead={(index) => {
              form.setValue(`skus.${index}.removed`, false, {
                shouldDirty: true,
              });
              form.setValue(`skus.${index}.isEnabled`, false, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setNotices({});
            }}
            onSetStock={setSettingStock}
          />
        </Section>

        <Section id="status" title="Status and availability">
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
              hint="Switch it off while the product cannot be supplied: the wholesale site shows it as currently not available, and no carton of it can be asked for."
            />
            <SelectField form={form} name="storageType" label="Storage">
              {STORAGE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {STORAGE_LABEL[type]}
                </option>
              ))}
            </SelectField>
            <UnitField
              form={form}
              name="sortOrder"
              label="Position in its category"
              optional
              placeholder={product ? undefined : "Last"}
              hint="0 comes first. The category page has the easier tool: drag the products into their order."
            />
          </div>
        </Section>

        <Section
          id="texts"
          title="Texts"
          description="English is what the wholesale site falls back to. A language that is still empty is marked."
        >
          <BilingualField
            form={form}
            name="shortDescription"
            label="Short description"
            multiline
            rows={2}
            maxLength={LIMITS.short}
            hint="One or two sentences for the product grid. At most 300 characters."
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

        <Section id="search" title="Search and address">
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
            hint="Other words business customers search with. 2 to 60 characters each."
          />
          <BilingualField
            form={form}
            name="slug"
            label="Address on the wholesale site (slug)"
            maxLength={LIMITS.slug}
            hint={
              creating
                ? "Generated from the names when left empty. Lower-case letters, digits and single hyphens."
                : "Changing it breaks links to the old address. Lower-case letters, digits and single hyphens."
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
                It is saved with the status you chose: a draft stays off the
                wholesale site.
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
                  setTableNotice(null);
                }}
              >
                Discard changes
              </Button>
            )}
            <ActionButton
              type="submit"
              permission="wholesale.manage"
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
            ? `Remove the SKU ${removing[0]!.carton.label}?`
            : `Remove ${plural(removing.length, "SKU")}?`
        }
        description="Removed for good when the product is saved. The stock history stays; quotations that name the SKU keep their own copy of the line. The last SKU of a product cannot be removed: disable it instead."
        facts={[
          {
            label: "Removed",
            value: removing.map((entry) => entry.carton.label).join(", "),
          },
        ]}
        confirmLabel={
          removing.length === 1
            ? `Save and remove ${removing[0]!.carton.label}`
            : `Save and remove ${removing.length} SKUs`
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

      {product && settingStock ? (
        <StockDialog
          product={product}
          sku={
            product.skus.find((entry) => entry.id === settingStock.id) ??
            settingStock
          }
          open
          onOpenChange={(open) => {
            if (!open) setSettingStock(null);
          }}
        />
      ) : null}
    </form>
  );
}
