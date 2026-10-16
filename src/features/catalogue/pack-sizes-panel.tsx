"use client";

import { Link2, Plus, Star, Unlink } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Controller, useWatch } from "react-hook-form";
import { ActionButton } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Thumb } from "@/components/domain/values";
import { CheckboxField, MoneyField, UnitField } from "@/components/form/fields";
import {
  Field,
  FormError,
  SelectField,
  TextField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type {
  ProductDetail,
  ProductPackSizeEntry,
  ProductSummary,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { PACK_UNIT_LABEL, plural, translated } from "@/lib/format/names";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { routes } from "@/lib/routes";
import {
  PACK_UNITS,
  SALE_MODES,
  packDefaults,
  packSchema,
  parsePackValue,
  productErrorField,
  salePreview,
  toDuplicateInput,
  type PackFormValues,
} from "./product-schema";
import { ProductPrice } from "./products-view";
import {
  useDuplicateProduct,
  useMakeDefault,
  useProducts,
  useUpdateProduct,
} from "./queries";

const SALE_LABEL = {
  none: "No sale",
  price: "Sale price",
  percent: "Discount in percent",
} as const;

// --- A further pack size ---------------------------------------------------------

/** Whether a typed pack size is already one of the article's. */
function hasPackSize(
  product: ProductDetail,
  value: string,
  unit: string,
): boolean {
  const parsed = parsePackValue(value);
  return [product, ...product.packSizes].some(
    (entry) => entry.packSize.unit === unit && entry.packSize.value === parsed,
  );
}

function AddPackForm({
  product,
  onClose,
}: {
  product: ProductDetail;
  onClose: () => void;
}) {
  const duplicate = useDuplicateProduct(product.id);
  const form = useZodForm(packSchema, { defaultValues: packDefaults(product) });
  const name = translated(product.name);

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: PackFormValues) => {
      const input = toDuplicateInput(values);
      if (
        values.asVariant &&
        hasPackSize(product, values.packSize.value, values.packSize.unit)
      ) {
        form.setError(
          "packSize.value",
          { type: "manual", message: `${name} has this pack size already.` },
          { shouldFocus: true },
        );
        return;
      }
      try {
        const copy = await duplicate.mutateAsync(input);
        notify.success(
          `${copy.packSize.label} created as a draft`,
          <>
            {copy.sku}. Check it and set it active.{" "}
            <Link
              href={routes.product(copy.id)}
              className="font-semibold text-accent-text underline"
            >
              Open the draft
            </Link>
          </>,
        );
        onClose();
      } catch (error) {
        if (hasErrorCode(error, "PRODUCT_SLUG_TAKEN")) {
          // The address of the copy is made of the name and the pack size.
          form.setError(
            "packSize.value",
            {
              type: "server",
              message: "A product with this name and pack size exists already.",
            },
            { shouldFocus: true },
          );
          return;
        }
        const field = productErrorField(error, values.saleMode);
        if (
          field === "sku" ||
          field === "salePrice" ||
          field === "discountPercent" ||
          field === "regularPrice"
        ) {
          form.setError(
            field,
            { type: "server", message: errorMessage(error) },
            { shouldFocus: true },
          );
          return;
        }
        throw error;
      }
    },
  );

  const [saleMode, regularPrice, salePrice, discountPercent] = useWatch({
    control: form.control,
    name: ["saleMode", "regularPrice", "salePrice", "discountPercent"],
  });
  const preview = salePreview({
    saleMode,
    regularPrice,
    salePrice,
    discountPercent,
  });
  const pictures = product.images.length;

  return (
    <form
      onSubmit={(event) => {
        event.stopPropagation();
        void onSubmit(event);
      }}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader
        title="Add a pack size"
        description={`A copy of ${name} ${product.packSize.label} in another size: a draft with the same texts, category and food information. Its own price and article number are set here.`}
      />
      <DialogBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            form={form}
            name="packSize.value"
            label="Pack size"
            required
            inputMode="decimal"
            autoComplete="off"
            className="tabular"
            autoFocus
          />
          <SelectField form={form} name="packSize.unit" label="Unit" required>
            {PACK_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {PACK_UNIT_LABEL[unit]}
              </option>
            ))}
          </SelectField>
          <MoneyField
            form={form}
            name="regularPrice"
            label="Regular price"
            required
            hint="Including VAT."
          />
          <TextField
            form={form}
            name="sku"
            label="Article number (SKU)"
            optional
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            className="uppercase tabular placeholder:normal-case"
            placeholder="Generated when left empty"
          />
        </div>

        <Field label="Sale" hint="Either a price or a percentage, never both.">
          <Controller
            control={form.control}
            name="saleMode"
            render={({ field }) => (
              <RadioGroup
                aria-label="Sale"
                value={field.value}
                onValueChange={(mode) => {
                  field.onChange(mode);
                  form.clearErrors(["salePrice", "discountPercent"]);
                }}
                className="flex-row flex-wrap gap-x-5 gap-y-2"
              >
                {SALE_MODES.map((mode) => (
                  <label
                    key={mode}
                    className="flex cursor-pointer items-center gap-2.5 text-sm text-ink"
                  >
                    <RadioItem value={mode} />
                    {SALE_LABEL[mode]}
                  </label>
                ))}
              </RadioGroup>
            )}
          />
        </Field>
        {saleMode === "price" ? (
          <MoneyField
            form={form}
            name="salePrice"
            label="Sale price"
            required
            fieldClassName="sm:max-w-56"
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
            fieldClassName="sm:max-w-56"
            hint="A whole number from 1 to 99."
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
            {saleMode === "price" ? `, about ${preview.percent} % less.` : "."}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <CheckboxField
            form={form}
            name="asVariant"
            label={`Link it as a pack size of ${name}`}
            hint="The shop shows linked pack sizes as one article. Unticked, the copy is a product of its own."
          />
          <CheckboxField
            form={form}
            name="copyImages"
            label="Copy the pictures"
            hint={
              pictures === 0
                ? "This product has no pictures yet."
                : `${plural(pictures, "picture")} with their descriptions.`
            }
            disabled={pictures === 0}
          />
        </div>
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Create the draft
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- Joining the pack sizes of another product -----------------------------------

function JoinDialog({
  product,
  open,
  onOpenChange,
}: {
  product: ProductDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const searchId = useId();
  const update = useUpdateProduct(product.id);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<ProductSummary | null>(null);
  const q = useDebounced(text.trim(), 300);
  const search = useProducts({ q, limit: 12 }, open && q.length >= 2);
  const own = new Set([
    product.id,
    ...product.packSizes.map((entry) => entry.id),
  ]);
  const results = (q.length >= 2 ? (search.data?.items ?? []) : []).filter(
    (entry) => !own.has(entry.id),
  );
  const label = `${translated(product.name)} ${product.packSize.label}`;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setText("");
          setTarget(null);
        }
        onOpenChange(value);
      }}
      title="Link to another product"
      description={
        <>
          {label} becomes one of the pack sizes of the product you choose: the
          shop shows them as one article.
          {product.packSizes.length > 1
            ? " It leaves the pack sizes it is linked with now."
            : ""}
        </>
      }
      facts={
        target
          ? [
              { label: "This product", value: label },
              {
                label: "Joins",
                value: `${translated(target.name)} ${target.packSize.label}${
                  target.packSizeCount > 1
                    ? ` and ${plural(target.packSizeCount - 1, "other size")}`
                    : ""
                }`,
              },
            ]
          : undefined
      }
      confirmLabel="Link the pack sizes"
      canConfirm={target !== null}
      onConfirm={async () => {
        if (!target) return;
        await update.mutateAsync({ variantOf: target.id });
        notify.success(
          "Pack sizes linked",
          `${label} is now a pack size of ${translated(target.name)}.`,
        );
        setText("");
        setTarget(null);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={searchId} className="text-13 font-medium text-ink">
          Find the product
        </label>
        <Input
          id={searchId}
          type="search"
          value={text}
          placeholder="Name or article number"
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value);
            setTarget(null);
          }}
        />
        {q.length < 2 ? (
          <p className="text-13 text-ink-subtle">At least two characters.</p>
        ) : search.isError ? (
          <p className="text-13 text-danger-fg">{errorMessage(search.error)}</p>
        ) : search.isPending ? (
          <p className="text-13 text-ink-subtle">Searching…</p>
        ) : results.length === 0 ? (
          <p className="text-13 text-ink-subtle">No other product matches.</p>
        ) : (
          <RadioGroup
            aria-label="Products found"
            value={target?.id ?? ""}
            onValueChange={(id) =>
              setTarget(results.find((entry) => entry.id === id) ?? null)
            }
            className="mt-1 max-h-60 gap-0 overflow-y-auto rounded-lg border border-line"
          >
            {results.map((entry) => (
              <label
                key={entry.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-sunken/70",
                  target?.id === entry.id && "bg-accent-soft/60",
                )}
              >
                <RadioItem value={entry.id} />
                <Thumb src={entry.image?.sizes.small.url} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-ink">
                    {translated(entry.name)}{" "}
                    <span className="text-ink-muted">
                      {entry.packSize.label}
                    </span>
                  </span>
                  <span className="truncate text-13 text-ink-subtle tabular">
                    {entry.sku}
                    {entry.packSizeCount > 1
                      ? ` · ${plural(entry.packSizeCount, "pack size")}`
                      : ""}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        )}
      </div>
    </ConfirmDialog>
  );
}

// --- The panel ------------------------------------------------------------------

function PackRow({
  entry,
  current,
  manage,
  pending,
  onMakeDefault,
}: {
  entry: ProductPackSizeEntry;
  current: boolean;
  manage: boolean;
  pending: boolean;
  onMakeDefault: () => void;
}) {
  return (
    <li
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex flex-col gap-1 px-4 py-2.5 sm:px-5",
        current && "bg-accent-soft/40",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {current ? (
            <span className="font-semibold text-ink">
              {entry.packSize.label}
            </span>
          ) : (
            <Link
              href={routes.product(entry.id)}
              className="font-semibold text-accent-text hover:underline"
            >
              {entry.packSize.label}
            </Link>
          )}
          {entry.isDefault ? (
            <Badge tone="neutral" dot={false} className="gap-1">
              <Star aria-hidden="true" className="size-3 fill-current" />
              Default
            </Badge>
          ) : null}
          {current ? (
            <span className="text-xs text-ink-subtle">this product</span>
          ) : null}
        </span>
        <ProductPrice pricing={entry.pricing} className="shrink-0 text-sm" />
      </div>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-13 text-ink-subtle">
          <span className="tabular">{entry.sku}</span>
          <StatusBadge kind="product" value={entry.status} />
          {entry.isAvailable ? null : <Badge tone="neutral">Unavailable</Badge>}
          <span className="tabular">{entry.stock.quantity} in stock</span>
          {entry.stock.quantity === 0 ? (
            <Badge tone="danger">Sold out</Badge>
          ) : entry.stock.isLow ? (
            <Badge tone="attention">Low stock</Badge>
          ) : null}
        </span>
        {!entry.isDefault && manage ? (
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            onClick={onMakeDefault}
            aria-label={`Make ${entry.packSize.label} the default pack size`}
            className="shrink-0"
          >
            Make default
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The pack sizes of an article: the members of the variant group, which of
 * them the shop's listings show, adding one, and linking or separating.
 */
export function PackSizesPanel({ product }: { product: ProductDetail }) {
  const manage = useCan()("catalog.manage");
  const makeDefault = useMakeDefault();
  const update = useUpdateProduct(product.id);
  const [adding, setAdding] = useState(false);
  const [joining, setJoining] = useState(false);
  const [separating, setSeparating] = useState(false);

  const grouped = product.packSizes.length > 0;
  const others = product.packSizes.filter((entry) => entry.id !== product.id);
  const label = `${translated(product.name)} ${product.packSize.label}`;

  return (
    <Card id="pack-sizes" aria-label="Pack sizes" className="scroll-mt-20">
      <CardHeader
        title="Pack sizes"
        description={
          grouped
            ? "Linked as one article, smallest first. The default one is shown in the shop's listings."
            : "Other sizes of the same article are products of their own, linked to this one."
        }
      />
      {grouped ? (
        <ul className="divide-y divide-line border-b border-line">
          {product.packSizes.map((entry) => (
            <PackRow
              key={entry.id}
              entry={entry}
              current={entry.id === product.id}
              manage={manage}
              pending={
                makeDefault.isPending && makeDefault.variables === entry.id
              }
              onMakeDefault={() =>
                makeDefault.mutate(entry.id, {
                  onSuccess: () =>
                    notify.success(
                      `${entry.packSize.label} is now the default`,
                      "The shop's listings show this pack size.",
                    ),
                })
              }
            />
          ))}
        </ul>
      ) : null}
      <CardBody className="flex flex-col gap-3">
        {grouped ? null : (
          <p className="text-13 text-ink-muted">
            {label} has no other pack sizes. Add one, or link it to a product
            that exists already.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <ActionButton
            permission="catalog.manage"
            icon={<Plus />}
            onClick={() => setAdding(true)}
          >
            Add a pack size
          </ActionButton>
          <ActionButton
            permission="catalog.manage"
            variant="ghost"
            icon={<Link2 />}
            onClick={() => setJoining(true)}
          >
            Link to another product
          </ActionButton>
          {grouped ? (
            <ActionButton
              permission="catalog.manage"
              variant="ghost"
              icon={<Unlink />}
              onClick={() => setSeparating(true)}
            >
              Separate
            </ActionButton>
          ) : null}
        </div>
      </CardBody>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent size="md">
          {adding ? (
            <AddPackForm product={product} onClose={() => setAdding(false)} />
          ) : null}
        </DialogContent>
      </Dialog>

      <JoinDialog product={product} open={joining} onOpenChange={setJoining} />

      <ConfirmDialog
        open={separating}
        onOpenChange={setSeparating}
        title={`Separate ${product.packSize.label} from the other pack sizes?`}
        description={`${label} becomes a product of its own: the shop no longer offers it as a size of the same article. Its price, pictures and texts stay as they are.`}
        facts={[
          {
            label: others.length === 1 ? "Stays on its own" : "Stay linked",
            value:
              others.map((entry) => entry.packSize.label).join(", ") || "None",
          },
        ]}
        confirmLabel={`Separate ${product.packSize.label}`}
        cancelLabel="Keep them linked"
        onConfirm={async () => {
          await update.mutateAsync({ variantOf: null });
          notify.success(
            `${product.packSize.label} separated`,
            `${label} is a product of its own now.`,
          );
        }}
      />
    </Card>
  );
}
