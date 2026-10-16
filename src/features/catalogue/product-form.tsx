"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Controller, useWatch } from "react-hook-form";
import { ActionButton } from "@/components/domain/permission";
import { Money } from "@/components/domain/values";
import {
  BilingualField,
  MoneyField,
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
  useControlProps,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import { Card, CardBody, CardHeader, Fact } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import type {
  ProductDetail,
  ProductInput,
  ProductPatch,
  ProductStatus,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatMoney, formatVatRate } from "@/lib/format/money";
import { PACK_UNIT_LABEL, translated } from "@/lib/format/names";
import { indentedName } from "./category-tree";
import {
  LIMITS,
  PACK_UNITS,
  PRODUCT_FIELD_ALIASES,
  PRODUCT_STATUSES,
  SALE_MODES,
  STORAGE_TYPES,
  productDefaults,
  productErrorField,
  productSchema,
  salePreview,
  toProductInput,
  toProductPatch,
  toTag,
  type ProductFormValues,
  type SaleMode,
} from "./product-schema";
import { useCategories } from "./queries";
import { TagListField } from "./tag-list-field";

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
    hint: "Part of the shop. Customers can order it while it is available and in stock.",
  },
  archived: {
    label: "Archived",
    hint: "Taken out of the shop. Old orders and invoices keep it.",
  },
};

const SALE_LABEL: Record<SaleMode, string> = {
  none: "No sale",
  price: "Sale price",
  percent: "Discount in percent",
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

/**
 * The form of a product, for a new one and for changing one. Saving a
 * product sends only what changed; while the admin types, the product may
 * change underneath (a picture is uploaded, a pack size becomes the
 * default): what was typed stays, the rest follows the product.
 */
export function ProductForm({
  product,
  categoryId,
  onCreate,
  onUpdate,
  onCancel,
  pictures,
  alsoUnsaved = false,
}: {
  /** Set when an existing product is changed. */
  product?: ProductDetail;
  /** The category a new product starts in (the list was filtered by it). */
  categoryId?: string;
  onCreate?: (input: ProductInput) => Promise<unknown>;
  onUpdate?: (patch: ProductPatch) => Promise<ProductDetail>;
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

  // The product the form was last brought in line with: a save compares
  // against it, so a field nobody touched here is never sent.
  const baseline = useRef(product);
  useEffect(() => {
    if (!product || product === baseline.current) return;
    baseline.current = product;
    form.reset(productDefaults(product), { keepDirtyValues: true });
  }, [product, form]);

  const {
    onSubmit: submit,
    state,
    pending,
  } = useSubmit(
    form,
    async (values: ProductFormValues) => {
      try {
        if (!baseline.current) {
          await onCreate?.(toProductInput(values));
          return;
        }
        const patch = toProductPatch(values, baseline.current);
        if (Object.keys(patch).length === 0) {
          form.reset(productDefaults(baseline.current));
          notify.info(
            "Nothing to save",
            "The product already has these values.",
          );
          return;
        }
        const updated = await onUpdate?.(patch);
        if (updated) {
          baseline.current = updated;
          form.reset(productDefaults(updated));
        }
      } catch (error) {
        // A documented refusal that belongs to one field is shown there.
        const field = productErrorField(error, values.saleMode);
        if (!field) throw error;
        form.setError(
          field,
          { type: "server", message: errorMessage(error) },
          { shouldFocus: true },
        );
      }
    },
    { aliases: PRODUCT_FIELD_ALIASES },
  );

  const [
    saleMode,
    regularPrice,
    salePrice,
    discountPercent,
    packValue,
    packUnit,
  ] = useWatch({
    control: form.control,
    name: [
      "saleMode",
      "regularPrice",
      "salePrice",
      "discountPercent",
      "packSize.value",
      "packSize.unit",
    ],
  });
  const preview = salePreview({
    saleMode,
    regularPrice,
    salePrice,
    discountPercent,
  });
  const saved = product?.pricing;
  const endsSale = Boolean(saved?.onSale) && saleMode === "none";
  const priceTouched =
    Boolean(product) &&
    (form.formState.dirtyFields.regularPrice ||
      form.formState.dirtyFields.saleMode ||
      form.formState.dirtyFields.salePrice ||
      form.formState.dirtyFields.discountPercent ||
      form.formState.dirtyFields.packSize ||
      form.formState.dirtyFields.vatRate);
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
            hint="Without the pack size: it is shown next to the name."
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
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="sku"
              label="Article number (SKU)"
              optional={creating}
              required={!creating}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              className="uppercase tabular placeholder:normal-case"
              placeholder={creating ? "Generated when left empty" : undefined}
              hint={
                creating
                  ? "Leave it empty and the API gives the next number (RF-00001 …)."
                  : "Letters, digits, dot, underscore, hyphen. No other product may have it."
              }
            />
            <TextField
              form={form}
              name="gtin"
              label="Barcode (GTIN)"
              optional
              inputMode="numeric"
              maxLength={14}
              autoComplete="off"
              className="tabular"
              hint="8, 12, 13 or 14 digits."
            />
          </div>
        </Section>

        {pictures}

        <Section
          id="price"
          title="Pack size and price"
          description="Prices are typed in euros and include VAT."
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
            <TextField
              form={form}
              name="packSize.value"
              label="Pack size"
              required
              inputMode="decimal"
              autoComplete="off"
              className="tabular"
              placeholder="5"
            />
            <SelectField form={form} name="packSize.unit" label="Unit" required>
              {PACK_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {PACK_UNIT_LABEL[unit]}
                </option>
              ))}
            </SelectField>
            <p className="self-end pb-1.5 text-13 text-ink-subtle">
              Up to three decimals. The shop shows it as “
              {packValue.trim() || "5"} {packUnit}”.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField
              form={form}
              name="regularPrice"
              label="Regular price"
              required
              hint="From €0.01 to €100,000.00."
            />
            <div className="flex items-start gap-2">
              <UnitField
                form={form}
                name="vatRate"
                label="VAT rate"
                required
                unit="%"
                decimal
                placeholder="7"
                fieldClassName="flex-1"
                hint="Contained in the price."
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
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-line bg-canvas/50 p-3.5">
            <Field
              label="Sale"
              hint="A sale is given either as a price or as a percentage of the regular price, never both."
            >
              <Controller
                control={form.control}
                name="saleMode"
                render={({ field }) => (
                  <Choice
                    label="Sale"
                    inline
                    value={field.value}
                    onBlur={field.onBlur}
                    disabled={!manage}
                    onChange={(mode) => {
                      field.onChange(mode);
                      form.clearErrors(["salePrice", "discountPercent"]);
                    }}
                    options={SALE_MODES.map((mode) => ({
                      value: mode,
                      label: SALE_LABEL[mode],
                    }))}
                  />
                )}
              />
            </Field>
            {saleMode === "price" ? (
              <MoneyField
                form={form}
                name="salePrice"
                label="Sale price"
                required
                fieldClassName="sm:max-w-80"
                hint="Must be below the regular price."
              />
            ) : null}
            {saleMode === "percent" ? (
              <UnitField
                form={form}
                name="discountPercent"
                label="Discount"
                required
                unit="%"
                placeholder="20"
                fieldClassName="sm:max-w-80"
                hint="A whole number from 1 to 99. The API sets the sale price from it."
              />
            ) : null}
            {preview ? (
              <p className="text-13 text-ink-muted" aria-live="polite">
                {saleMode === "percent"
                  ? "Customers will pay about "
                  : "Customers will pay "}
                <span className="font-semibold text-ink">
                  {formatMoney(preview.price)}
                </span>
                {saleMode === "price"
                  ? `, about ${preview.percent} % less.`
                  : "."}
              </p>
            ) : null}
            {endsSale ? (
              <p className="text-13 text-ink-muted">
                Saving ends the sale of{" "}
                <span className="font-semibold text-ink">
                  {formatMoney(saved?.salePrice ?? 0)}
                </span>
                : customers pay the regular price again.
              </p>
            ) : null}
          </div>

          {saved ? (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-13 font-semibold text-ink">
                  As the shop has it now
                </h3>
                {priceTouched ? (
                  <Badge tone="attention">Calculated again when you save</Badge>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Fact label="Customers pay">
                  <Money cents={saved.price} className="font-semibold" />
                  {saved.onSale && saved.discountPercent !== null ? (
                    <span className="text-ink-muted">
                      {" "}
                      (−{saved.discountPercent} %)
                    </span>
                  ) : null}
                </Fact>
                <Fact label="Base price">
                  {saved.basePrice ? (
                    <span className="tabular">
                      {formatMoney(saved.basePrice.amount)} per{" "}
                      {saved.basePrice.per === "pcs"
                        ? "piece"
                        : saved.basePrice.per}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">None</span>
                  )}
                </Fact>
                <Fact label={`VAT inside (${formatVatRate(saved.vatRate)})`}>
                  <Money cents={saved.vatAmount} />
                </Fact>
                <Fact label="Regular price">
                  <Money cents={saved.regularPrice} />
                </Fact>
              </dl>
            </div>
          ) : (
            <p className="text-13 text-ink-subtle">
              The base price (per kg, litre or piece) is calculated by the API
              when the product is saved.
            </p>
          )}
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
              hint="Switch it off while the product cannot be supplied. It stays in the catalogue, shown as sold out. A product with a stock of 0 is sold out as well."
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
              hint="What a customer orders at least: 1 to 10,000."
            />
            <UnitField
              form={form}
              name="maxOrderQuantity"
              label="Largest order quantity"
              optional
              placeholder="No limit"
              hint="What a customer orders at most. Empty: no limit."
            />
            <UnitField
              form={form}
              name="sortOrder"
              label="Sort order"
              required
              hint="The place among the products: 0 to 1,000,000."
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
                ? "Generated from the name and the pack size when left empty. Lower-case letters, digits and single hyphens."
                : "Generated when the product was created. Changing it breaks links that point to the old address."
            }
          />
        </Section>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-line bg-surface px-4 pt-3 pb-safe sm:mx-0 sm:px-0 sm:pb-3">
        <FormError state={state} />
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
                onClick={() => form.reset(productDefaults(baseline.current))}
              >
                Discard changes
              </Button>
            )}
            <ActionButton
              type="submit"
              permission="catalog.manage"
              variant="primary"
              size="lg"
              loading={pending}
              disabled={!creating && !dirty}
            >
              {creating ? "Create product" : "Save changes"}
            </ActionButton>
          </div>
        </div>
      </div>
    </form>
  );
}
