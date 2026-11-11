"use client";

import { ActionButton } from "@/components/domain/permission";
import { DateTime } from "@/components/domain/values";
import { FormError, useSubmit, useZodForm } from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import {
  formatExact,
  formatFine,
  formatPercent,
} from "@/features/finance/profit-format";
import { errorMessage } from "@/lib/api/error-text";
import {
  PRICE_RULE_FIELDS,
  type PriceRuleField,
  type ProductDetail,
  type ProductPricing,
  type VariantPricing,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";
import { translated } from "@/lib/format/names";
import { humanize } from "@/lib/status";
import {
  RULE_SOURCE_LABEL,
  overrideDefaults,
  overrideFields,
  sameOverride,
  toOverride,
} from "../supply/pricing";
import {
  inheritedRule,
  useProductPricing,
  useSupplySettings,
} from "../supply/queries";
import { RuleOverrideFields } from "../supply/rule-fields";
import { useCategories, useUpdateProduct } from "./queries";
import { usePackSizeChoice } from "./stock-panel";

// The pricing of a product (documentation, 31; doc/SUPPLIER_IMPORT.md):
// how the price of each pack size comes about, what it earns, and the
// values of the price rule the product sets itself. Every figure is the
// API's. Buying prices and markups need `catalog.read`, which the page of
// a product needs anyway.

interface Line {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}

function Lines({ label, rows }: { label: string; rows: Line[] }) {
  return (
    <dl
      aria-label={label}
      className="glass-inset divide-y divide-line overflow-hidden rounded-lg text-13"
    >
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-4 px-3 py-1.5"
        >
          <dt className="text-ink-muted">{row.label}</dt>
          <dd
            className={cn(
              "text-right text-ink tabular",
              row.strong && "font-semibold",
              row.className,
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One pack size: from its buying price to its price, and what the price earns. */
function VariantBreakdown({
  pricing,
  variant,
}: {
  pricing: ProductPricing;
  variant: VariantPricing;
}) {
  const { rule, sources } = pricing;
  const steps = variant.calculated;
  const profit = variant.profit;
  const from = (field: PriceRuleField) =>
    `${formatPercent(rule[field])}, ${RULE_SOURCE_LABEL[sources[field]]}`;
  const auto = variant.priceMode === "auto";
  const loss = profit !== null && Math.round(profit.profit) < 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={auto ? "success" : "neutral"}>
          {auto ? "Follows the buying price" : "Price set by hand"}
        </Badge>
        {variant.salePrice !== null ? (
          <Badge tone="neutral">On sale</Badge>
        ) : null}
      </div>

      {steps ? (
        <Lines
          label="How the price is calculated"
          rows={[
            { label: "Buying price", value: formatExact(steps.cost) },
            {
              label: `Fulfilment cost (${from("fulfilmentPercent")})`,
              value: formatExact(steps.fulfilment),
            },
            ...(steps.extra !== 0
              ? [{ label: "Other expenses", value: formatExact(steps.extra) }]
              : []),
            {
              label: `Markup (${from("markupPercent")})`,
              value: formatExact(steps.markup),
            },
            { label: "Price before VAT", value: formatExact(steps.net) },
            {
              label: `VAT (${formatPercent(pricing.vatPercent)})`,
              value: formatExact(steps.vat),
            },
            {
              label: "Calculated price",
              value: formatMoney(steps.price),
              strong: true,
            },
          ]}
        />
      ) : (
        <p className="text-13 text-ink-muted">
          No buying price is known for this pack size, so nothing can be
          calculated and its profit is not known. Type the buying price in the
          row of the pack size.
        </p>
      )}

      <Lines
        label="What customers pay and what it earns"
        rows={[
          {
            label:
              variant.salePrice !== null
                ? `Customers pay now (regular ${formatMoney(variant.regularPrice)})`
                : "Customers pay now",
            value: formatMoney(variant.price),
            strong: true,
          },
          ...(profit
            ? [
                {
                  label: "Without VAT",
                  value: formatMoney(profit.net),
                },
                {
                  label: "Costs of the pack",
                  value: formatExact(profit.costs),
                },
                {
                  label: "Profit per pack",
                  value: formatFine(profit.profit),
                  strong: true,
                  className: loss
                    ? "text-danger-fg"
                    : Math.round(profit.profit) > 0
                      ? "text-success-fg"
                      : undefined,
                },
                {
                  label: "As a markup on the costs",
                  value: formatPercent(profit.markupPercent),
                },
                {
                  label: "As a margin of the price",
                  value: formatPercent(profit.marginPercent),
                },
              ]
            : []),
        ]}
      />

      {loss ? (
        <Alert tone="warning" title="This price is below what the pack costs">
          Every pack sold loses {formatFine(-(profit?.profit ?? 0))}.
          {steps ? ` The rule would give ${formatMoney(steps.price)}.` : ""}
        </Alert>
      ) : !auto && steps && steps.price !== variant.regularPrice ? (
        <p className="text-13 text-ink-muted">
          The rule would give {formatMoney(steps.price)}; the regular price is
          set by hand at {formatMoney(variant.regularPrice)}.
        </p>
      ) : null}

      {variant.supplier ? (
        <div className="flex flex-col gap-1 text-13 text-ink-muted">
          <p className="font-semibold text-ink">Supplier&apos;s line</p>
          <p className="break-words text-ink">{variant.supplier.name}</p>
          <p>
            {variant.supplier.quantity.toLocaleString("en")} at the supplier ·
            last in the file <DateTime value={variant.supplier.lastSeenAt} />
          </p>
          {variant.supplier.missingSince ? (
            <p className="text-attention-fg">
              Not in the supplier&apos;s file since{" "}
              <DateTime value={variant.supplier.missingSince} />.
            </p>
          ) : null}
          {variant.supplier.hints.length > 0 ? (
            <p className="flex flex-wrap gap-1.5">
              {variant.supplier.hints.map((hint) => (
                <Badge key={hint} tone="attention">
                  {humanize(hint)}
                </Badge>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The values of the price rule the product sets itself: each may stay empty. */
function ProductRuleForm({ product }: { product: ProductDetail }) {
  const categories = useCategories().data?.items;
  const shop = useSupplySettings().data?.pricing;
  const update = useUpdateProduct(product.id);
  const form = useZodForm(overrideFields, {
    defaultValues: overrideDefaults(product.pricing),
  });
  // What counts where the product says nothing: its category, then the shop.
  const inherited = inheritedRule(shop, categories, product.categoryId);

  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const pricing = toOverride(values);
    if (sameOverride(pricing, product.pricing)) {
      form.reset(overrideDefaults(product.pricing));
      notify.info("Nothing to save", "The product already has these values.");
      return;
    }
    // Replaced as a whole; `null` removes it. The calculated prices of the
    // product follow in the same request.
    const saved = await update.mutateAsync({ pricing });
    form.reset(overrideDefaults(saved.pricing));
    notify.success(
      "Price rule saved",
      saved.pricing
        ? "The prices that follow a buying price were calculated again."
        : "The product follows its category and the shop again.",
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Price rule of this product"
      className="flex flex-col gap-3 border-t border-line pt-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">
          Price rule of this product
        </h3>
        <p className="mt-0.5 text-13 text-ink-muted">
          Set a value only where {translated(product.name)} differs from its
          category and the shop. It counts for the pack sizes whose price
          follows the buying price.
        </p>
      </div>
      <fieldset
        disabled={!useCan()("catalog.manage")}
        className="flex min-w-0 flex-col gap-3"
      >
        <legend className="sr-only">Values this product sets itself</legend>
        <RuleOverrideFields
          form={form}
          names={
            Object.fromEntries(
              PRICE_RULE_FIELDS.map((field) => [field, field]),
            ) as Record<PriceRuleField, PriceRuleField>
          }
          inherited={inherited}
        />
      </fieldset>
      <FormError state={state} />
      <div className="flex justify-end">
        <ActionButton
          type="submit"
          permission="catalog.manage"
          size="sm"
          loading={pending}
          disabled={!form.formState.isDirty}
        >
          Save the price rule
        </ActionButton>
      </div>
    </form>
  );
}

/**
 * The pricing of a product, one pack size at a time: the calculation from
 * its buying price, what customers pay and what that earns, and the
 * supplier's line it follows; under it the values of the price rule the
 * product sets itself.
 */
export function PricingPanel({
  product,
  paused = false,
}: {
  product: ProductDetail;
  /** The product is being deleted: its pricing is not asked for again. */
  paused?: boolean;
}) {
  const { variant, chooser } = usePackSizeChoice(product);
  const pricing = useProductPricing(product.id, !paused);
  const line = pricing.data?.variants.find(
    (entry) => entry.variantId === variant.id,
  );

  return (
    <Card id="pricing" aria-label="Pricing" className="scroll-mt-20">
      <CardHeader
        title="Pricing"
        description="How the price of a pack size comes from its buying price, and what it earns. Without VAT unless a row says otherwise."
      />
      <CardBody className="flex flex-col gap-4">
        {chooser}
        {pricing.isPending ? (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-label="Loading the pricing"
          >
            <Skeleton className="h-9" />
            <Skeleton className="h-32" />
          </div>
        ) : pricing.isError ? (
          <Alert
            tone="danger"
            title="The pricing could not be loaded"
            actions={
              <Button size="sm" onClick={() => void pricing.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(pricing.error)}
          </Alert>
        ) : line ? (
          <VariantBreakdown pricing={pricing.data} variant={line} />
        ) : (
          <p className="text-13 text-ink-muted">
            The pricing of this pack size is not there yet. Save the product and
            it follows.
          </p>
        )}
        <ProductRuleForm product={product} />
      </CardBody>
    </Card>
  );
}
