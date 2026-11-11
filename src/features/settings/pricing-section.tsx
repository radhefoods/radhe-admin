"use client";

import { Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useWatch } from "react-hook-form";
import { z } from "zod";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import {
  MoneyField,
  SwitchField,
  UnitField,
  UnsavedGuard,
} from "@/components/form/fields";
import { useSubmit, useZodForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { formatExact, formatPercent } from "@/features/finance/profit-format";
import {
  RULE_FIELD_LABEL,
  priceFromCost,
  priceRuleDefaults,
  priceRuleFields,
  ruleValueText,
  sameRule,
  typedRule,
} from "@/features/supply/pricing";
import {
  useSaveSupplySettings,
  useSupplySettings,
} from "@/features/supply/queries";
import { describeError } from "@/lib/api/error-text";
import {
  PRICE_RULE_FIELDS,
  PRICE_RULE_LIMITS,
  type PriceRule,
  type SupplierBrand,
  type SupplySettings,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { zInt } from "@/lib/validation";
import { useFollowSaved } from "./queries";
import { SettingRow, SettingsFormCard } from "./settings-card";

// Settings → Pricing & supplier (documentation, 31): the price rule of the
// shop, the safety buffer, the check before activation and the brand list.
// VAT is not set here (it is a field of each product), and neither is what
// the customer pays for delivery (the page "Delivery fee").

const pricingSchema = z.object({
  ...priceRuleFields,
  safetyUnits: zInt({ min: 0, max: PRICE_RULE_LIMITS.safetyUnits }),
  publishCheck: z.boolean(),
});

type PricingFormValues = z.input<typeof pricingSchema>;

function pricingDefaults(settings: SupplySettings): PricingFormValues {
  return {
    ...priceRuleDefaults(settings.pricing),
    safetyUnits: String(settings.safetyUnits),
    publishCheck: settings.publishCheck,
  };
}

/** The buying price and the VAT rate of the example: €1.38 at 7 %. */
const EXAMPLE = { cost: 138, vatRate: 700 } as const;

/** "5 prices changed", for the message after a save. */
export function repricedText(repriced: number): string {
  return repriced === 0
    ? "No calculated price changed."
    : `${plural(repriced, "calculated price")} changed.`;
}

/** How a price comes about with the rule as it is typed, step by step. */
function Example({ rule }: { rule: PriceRule | null }) {
  if (!rule) {
    return (
      <p className="text-13 text-ink-muted">
        The example follows once the four values are complete.
      </p>
    );
  }
  const steps = priceFromCost(EXAMPLE.cost, rule, EXAMPLE.vatRate);
  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: "Buying price", value: formatExact(steps.cost) },
    {
      label: `Fulfilment cost (${formatPercent(rule.fulfilmentPercent)})`,
      value: formatExact(steps.fulfilment),
    },
    ...(steps.extra !== 0
      ? [{ label: "Other expenses", value: formatExact(steps.extra) }]
      : []),
    {
      label: `Markup (${formatPercent(rule.markupPercent)})`,
      value: formatExact(steps.markup),
    },
    { label: "Price before VAT", value: formatExact(steps.net) },
    { label: "VAT (7 %)", value: formatExact(steps.vat) },
    {
      label: "Selling price",
      value: formatMoney(steps.price),
      strong: true,
    },
  ];
  return (
    <dl
      aria-label="Example of a calculated price"
      className="glass-inset divide-y divide-line overflow-hidden rounded-lg text-13"
    >
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-4 px-3 py-1.5"
        >
          <dt className="text-ink-muted">{row.label}</dt>
          <dd
            className={
              row.strong
                ? "text-right font-semibold text-ink tabular"
                : "text-right text-ink tabular"
            }
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PriceRuleForm({ saved }: { saved: SupplySettings }) {
  const can = useCan();
  const defaults = pricingDefaults(saved);
  const form = useZodForm(pricingSchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const save = useSaveSupplySettings();
  /** A changed rule waits here for the confirmation. */
  const [confirming, setConfirming] = useState<{
    rule: PriceRule;
    values: PricingFormValues;
  } | null>(null);

  async function send(rule: PriceRule, values: PricingFormValues) {
    // The brand list stays as it is: it is saved by its own card.
    const result = await save.mutateAsync({
      safetyUnits: Number(values.safetyUnits),
      pricing: rule,
      publishCheck: values.publishCheck,
    });
    form.reset(pricingDefaults(result.settings));
    notify.success("Pricing saved", repricedText(result.repriced));
  }

  const { onSubmit, state, pending } = useSubmit(form, async () => {
    const values = form.getValues();
    const rule = typedRule(values);
    if (!rule) return;
    // Every calculated price of the shop changes at once: asked first.
    if (!sameRule(rule, saved.pricing)) {
      setConfirming({ rule, values });
      return;
    }
    await send(rule, values);
  });

  const typed = typedRule(useWatch({ control: form.control }));
  const changed = confirming
    ? PRICE_RULE_FIELDS.filter(
        (field) => confirming.rule[field] !== saved.pricing[field],
      )
    : [];

  return (
    <>
      <SettingsFormCard
        title="Price rule"
        description="How a selling price comes from a buying price: the buying price, plus the fulfilment cost on it, plus other expenses, then the markup on all of that, then the VAT of the product. Rounded to the cent at the end only."
        onSubmit={onSubmit}
        state={state}
        pending={pending || save.isPending}
        dirty={form.formState.isDirty}
        saveLabel="Save the pricing"
        permission="catalog.manage"
        className="max-w-3xl"
      >
        <UnsavedGuard when={form.formState.isDirty} />
        <SettingRow explanation="What handling an order costs, as a percentage of the buying price.">
          <UnitField
            form={form}
            name="fulfilmentPercent"
            label="Fulfilment cost"
            unit="%"
            decimal
            required
            hint="0 to 1000, two decimals."
          />
        </SettingRow>
        <SettingRow explanation="Further costs as a percentage of the buying price. 0 for none.">
          <UnitField
            form={form}
            name="extraPercent"
            label="Other expenses"
            unit="%"
            decimal
            required
          />
        </SettingRow>
        <SettingRow explanation="A fixed amount added per pack. 0 for none.">
          <MoneyField
            form={form}
            name="extraAmount"
            label="Other expenses per pack"
            required
            hint="Up to €1,000.00."
          />
        </SettingRow>
        <SettingRow explanation="The profit added on the buying price and all charges. A markup, not a margin: 35 % on top of the costs leaves 25.9 % of the price before VAT.">
          <UnitField
            form={form}
            name="markupPercent"
            label="Markup"
            unit="%"
            decimal
            required
          />
        </SettingRow>
        <div className="flex flex-col gap-2">
          <p className="text-13 font-semibold text-ink">
            Example: a pack bought for €1.38, at 7 % VAT
          </p>
          <div className="sm:max-w-sm">
            <Example rule={typed} />
          </div>
        </div>
        <div className="flex flex-col gap-5 border-t border-line pt-5">
          <SettingRow explanation="Units of the supplier's stock that are never offered in the shop. Applies from the next upload of the supplier's file; the stock in the shop does not change before that.">
            <UnitField
              form={form}
              name="safetyUnits"
              label="Safety buffer"
              unit="units"
              required
              hint="A whole number from 0 to 1000."
            />
          </SettingRow>
          <SwitchField
            form={form}
            name="publishCheck"
            label="Check before activation"
            disabled={!can("catalog.manage")}
            hint="On: a product can only be activated when it is complete (a category, and for food the German name, ingredients, allergens and the responsible business). Off: every product can be activated."
          />
        </div>
        <ul className="flex list-disc flex-col gap-1 border-t border-line pt-4 pl-4 text-13 text-ink-muted">
          <li>
            The rule counts for every pack size whose price follows the buying
            price. A category or a product can set single values differently, on
            its own page. A price set by hand does not change.
          </li>
          <li>
            VAT is not set here: it is a field of each product, filled from the
            supplier&apos;s file for new products.
          </li>
          <li>
            What the customer pays for delivery is set on the page{" "}
            <Link
              href={routes.settingsDeliveryFee}
              className="font-medium text-accent-text hover:underline"
            >
              Delivery fee
            </Link>
            {can("finance.read") ? (
              <>
                ; what an order costs the shop besides its goods on the page{" "}
                <Link
                  href={routes.settingsOrderCosts}
                  className="font-medium text-accent-text hover:underline"
                >
                  Order costs
                </Link>
              </>
            ) : null}
            .
          </li>
        </ul>
      </SettingsFormCard>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Change the price rule of the shop?"
        description="Every price that follows a buying price is calculated again at once, and customers see the new prices right away. Prices set by hand, and values a category or a product sets itself, stay."
        facts={changed.map((field) => ({
          label: RULE_FIELD_LABEL[field],
          value: confirming
            ? `${ruleValueText(field, saved.pricing[field])} → ${ruleValueText(field, confirming.rule[field])}`
            : "",
        }))}
        confirmLabel="Save and recalculate the prices"
        cancelLabel="Not now"
        onConfirm={async () => {
          if (!confirming) return;
          await send(confirming.rule, confirming.values);
        }}
      />
    </>
  );
}

// --- The brand list --------------------------------------------------------------

interface BrandRow extends SupplierBrand {
  /** Stable while the row is edited. */
  key: number;
}

/** A prefix as the import compares it: case, accents and punctuation do not matter. */
export function prefixKey(prefix: string): string {
  return prefix
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Why the list cannot be saved as it is, by row key; empty when it can. */
export function brandProblems(
  rows: readonly { key: number; prefix: string; name: string }[],
): Map<number, string> {
  const problems = new Map<number, string>();
  const seen = new Map<string, number>();
  for (const row of rows) {
    const prefix = row.prefix.trim();
    if (prefix === "") {
      problems.set(row.key, "Enter the prefix.");
      continue;
    }
    if (prefix.length > PRICE_RULE_LIMITS.brandPrefix) {
      problems.set(
        row.key,
        `A prefix has at most ${PRICE_RULE_LIMITS.brandPrefix} characters.`,
      );
      continue;
    }
    if (row.name.trim().length > PRICE_RULE_LIMITS.brandName) {
      problems.set(
        row.key,
        `A brand name has at most ${PRICE_RULE_LIMITS.brandName} characters.`,
      );
      continue;
    }
    // Two rows for one prefix would be one row for the API: the last wins.
    const key = prefixKey(prefix);
    if (seen.has(key)) {
      problems.set(row.key, "This prefix is in the list already.");
      continue;
    }
    seen.set(key, row.key);
  }
  return problems;
}

const toRows = (brands: readonly SupplierBrand[]): BrandRow[] =>
  brands.map((brand, index) => ({ ...brand, key: index }));

const sameBrands = (
  rows: readonly SupplierBrand[],
  saved: readonly SupplierBrand[],
) =>
  rows.length === saved.length &&
  rows.every(
    (row, index) =>
      row.prefix.trim() === saved[index]?.prefix &&
      row.name.trim() === saved[index]?.name,
  );

function BrandList({ saved }: { saved: SupplySettings }) {
  const manage = useCan()("catalog.manage");
  const save = useSaveSupplySettings();
  const id = useId();
  const [rows, setRows] = useState(() => toRows(saved.brands));
  // The list the rows were last brought in line with: another admin's save
  // is followed while nothing was typed here.
  const [base, setBase] = useState(saved.brands);
  const [nextKey, setNextKey] = useState(saved.brands.length);
  const [query, setQuery] = useState("");
  const [failure, setFailure] = useState<ReactNode>(null);
  if (saved.brands !== base && sameBrands(rows, base)) {
    setBase(saved.brands);
    setRows(toRows(saved.brands));
    setNextKey(saved.brands.length);
  }

  const dirty = !sameBrands(rows, saved.brands);
  const problems = useMemo(() => brandProblems(rows), [rows]);
  const tooMany = rows.length > PRICE_RULE_LIMITS.brands;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter(
        (row) =>
          row.prefix.toLowerCase().includes(needle) ||
          row.name.toLowerCase().includes(needle),
      )
    : rows;

  const change = (key: number, patch: Partial<SupplierBrand>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  async function submit() {
    setFailure(null);
    try {
      // The rule and the buffer go along as they are saved: the API wants
      // them every time, and unchanged they recalculate nothing.
      const result = await save.mutateAsync({
        safetyUnits: saved.safetyUnits,
        pricing: saved.pricing,
        brands: rows.map((row) => ({
          prefix: row.prefix.trim(),
          name: row.name.trim(),
        })),
      });
      setBase(result.settings.brands);
      setRows(toRows(result.settings.brands));
      setNextKey(result.settings.brands.length);
      notify.success(
        "Brand list saved",
        "It is used for products created from the next upload on.",
      );
    } catch (error) {
      const notice = describeError(error);
      setFailure(notice.message);
    }
  }

  return (
    <Card aria-label="Brand list" className="max-w-3xl">
      <CardHeader
        title="Brand list"
        description="The supplier writes the brand before the colon of a name, often shortened: “AB: 100g Black Pepper Powder”. The list says which brand a prefix stands for. A prefix that is not in the list is used as it is written."
      />
      <CardBody className="flex flex-col gap-4">
        <UnsavedGuard when={dirty} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Find a prefix or a brand"
              placeholder="Find a prefix or a brand"
              className="pl-9"
            />
          </div>
          {manage ? (
            <Button
              variant="secondary"
              icon={<Plus />}
              disabled={rows.length >= PRICE_RULE_LIMITS.brands}
              onClick={() => {
                setQuery("");
                setRows((current) => [
                  { key: nextKey, prefix: "", name: "" },
                  ...current,
                ]);
                setNextKey((key) => key + 1);
              }}
            >
              Add a prefix
            </Button>
          ) : null}
        </div>

        {shown.length === 0 ? (
          <p className="text-13 text-ink-muted">
            {rows.length === 0
              ? "The list is empty: every prefix is used as it is written."
              : "No prefix or brand matches."}
          </p>
        ) : (
          <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-2">
            <legend className="sr-only">Prefixes and their brands</legend>
            <div
              aria-hidden="true"
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_34px] gap-3 text-13 font-medium text-ink"
            >
              <span>Prefix in the supplier&apos;s names</span>
              <span>Brand</span>
              <span />
            </div>
            <ol className="flex flex-col gap-2">
              {shown.map((row) => {
                const problem = problems.get(row.key) ?? null;
                const label = row.prefix.trim() || "the new prefix";
                const errorId = `${id}-${row.key}`;
                return (
                  <li key={row.key} className="flex flex-col gap-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_34px] items-center gap-3">
                      <Input
                        value={row.prefix}
                        onChange={(event) =>
                          change(row.key, { prefix: event.target.value })
                        }
                        aria-label={`Prefix of ${label}`}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? errorId : undefined}
                        maxLength={PRICE_RULE_LIMITS.brandPrefix}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="AB"
                      />
                      <Input
                        value={row.name}
                        onChange={(event) =>
                          change(row.key, { name: event.target.value })
                        }
                        aria-label={`Brand of ${label}`}
                        maxLength={PRICE_RULE_LIMITS.brandName}
                        autoComplete="off"
                        placeholder="Not a brand"
                      />
                      {manage ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${label}`}
                          onClick={() =>
                            setRows((current) =>
                              current.filter((entry) => entry.key !== row.key),
                            )
                          }
                        >
                          <X />
                        </Button>
                      ) : (
                        <span />
                      )}
                    </div>
                    {problem ? (
                      <p id={errorId} className="text-13 text-danger-fg">
                        {problem}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </fieldset>
        )}
        <p className="text-13 text-ink-subtle">
          {plural(rows.length, "prefix", "prefixes")} of{" "}
          {PRICE_RULE_LIMITS.brands.toLocaleString("en")} at most
          {needle ? `, ${shown.length} shown` : ""}. Upper and lower case and
          punctuation of a prefix do not matter. An empty brand says the prefix
          is not a brand: “NW Pooja: 100g Kumkum” becomes the product “Kumkum”.
        </p>
        {failure ? <Alert tone="danger">{failure}</Alert> : null}
      </CardBody>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-3 sm:px-5">
        <p className="text-13 text-ink-subtle" aria-live="polite">
          {!manage
            ? "Your role can read the list, not change it."
            : problems.size > 0
              ? `${plural(problems.size, "row")} cannot be saved yet.`
              : tooMany
                ? "The list is too long."
                : dirty
                  ? "Changes are not saved yet."
                  : "No unsaved changes."}
        </p>
        <div className="flex gap-2">
          {manage && dirty ? (
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setRows(toRows(saved.brands));
                setNextKey(saved.brands.length);
                setFailure(null);
              }}
            >
              Discard changes
            </Button>
          ) : null}
          <ActionButton
            permission="catalog.manage"
            variant="primary"
            loading={save.isPending}
            disabled={!dirty || problems.size > 0 || tooMany}
            onClick={() => void submit()}
          >
            Save the brand list
          </ActionButton>
        </div>
      </div>
    </Card>
  );
}

/**
 * Settings → Pricing & supplier (31). It belongs to the catalogue:
 * `catalog.read` to see it, `catalog.manage` to save.
 */
export function PricingSection() {
  const settings = useSupplySettings();
  let body: ReactNode;
  if (settings.data) {
    body = (
      <>
        <PriceRuleForm saved={settings.data} />
        <BrandList saved={settings.data} />
      </>
    );
  } else if (settings.isError) {
    const notice = describeError(settings.error);
    body = (
      <Alert
        tone="danger"
        title="The pricing could not be loaded"
        actions={
          <Button onClick={() => void settings.refetch()}>Try again</Button>
        }
      >
        {notice.message}
        {notice.requestId ? (
          <span className="mt-1 block font-mono text-2xs break-all">
            {notice.technical} · Request {notice.requestId}
          </span>
        ) : null}
      </Alert>
    );
  } else {
    body = (
      <div className="flex max-w-3xl flex-col gap-4" aria-busy="true">
        <span className="sr-only" role="status">
          Loading the pricing
        </span>
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  return (
    <RequirePermission permission="catalog.read">{body}</RequirePermission>
  );
}
