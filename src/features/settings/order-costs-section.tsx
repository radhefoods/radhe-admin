"use client";

import { useWatch } from "react-hook-form";
import { MoneyField, UnitField, UnsavedGuard } from "@/components/form/fields";
import { useSubmit, useZodForm } from "@/components/form/form";
import { RequirePermission } from "@/components/domain/permission";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { describeError } from "@/lib/api/error-text";
import type { OrderCostSettings } from "@/lib/api/types";
import {
  feeExample,
  feeExampleText,
  orderCostsDefaults,
  orderCostsSchema,
} from "@/features/finance/order-costs";
import {
  useOrderCostSettings,
  useSaveOrderCostSettings,
} from "@/features/finance/queries";
import { useFollowSaved } from "./queries";
import { SettingRow, SettingsFormCard } from "./settings-card";

function OrderCostsForm({ saved }: { saved: OrderCostSettings }) {
  const defaults = orderCostsDefaults(saved);
  const form = useZodForm(orderCostsSchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const save = useSaveOrderCostSettings();
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    // The whole document, every time (32).
    const result = await save.mutateAsync(values);
    form.reset(orderCostsDefaults(result));
    notify.success(
      "Order costs saved",
      "They count for orders placed from now on.",
    );
  });

  const example = feeExample(
    useWatch({ control: form.control, name: "paymentFee" }),
  );

  return (
    <SettingsFormCard
      title="Order costs"
      description="What one order costs the shop besides its goods. The profit of an order is worked out with these. All amounts without VAT."
      onSubmit={onSubmit}
      state={state}
      pending={pending}
      dirty={form.formState.isDirty}
      saveLabel="Save the order costs"
      permission="finance.manage"
      className="max-w-3xl"
    >
      <UnsavedGuard when={form.formState.isDirty} />
      <SettingRow explanation="What it costs the shop to bring one order to the customer. Not what the customer pays for delivery: that is the delivery fee.">
        <MoneyField
          form={form}
          name="deliveryCost"
          label="Delivery cost per order"
          required
        />
      </SettingRow>
      <SettingRow explanation="Box, filling and tape of one order.">
        <MoneyField
          form={form}
          name="packagingCost"
          label="Packaging cost per order"
          required
        />
      </SettingRow>
      <SettingRow explanation="Anything else that one order costs.">
        <MoneyField
          form={form}
          name="otherCost"
          label="Other costs per order"
          required
        />
      </SettingRow>
      <fieldset className="flex min-w-0 flex-col gap-3 border-t border-line pt-5">
        <legend className="sr-only">Estimated payment fee</legend>
        <p aria-hidden="true" className="text-sm font-semibold text-ink">
          Estimated payment fee
        </p>
        <SettingRow explanation="What the payment provider takes: a percentage of what the customer pays, plus an amount per payment. The default, 1.5 % and €0.25, is Stripe's price in Germany for a standard card from the European Economic Area; other cards and PayPal cost more.">
          <div className="grid grid-cols-2 gap-3">
            <UnitField
              form={form}
              name="paymentFee.percent"
              label="Percentage"
              unit="%"
              decimal
              required
              hint="0 to 100, two decimals."
            />
            <MoneyField
              form={form}
              name="paymentFee.fixed"
              label="Amount per payment"
              required
              hint="Up to €100.00."
            />
          </div>
        </SettingRow>
        <p
          aria-live="polite"
          className="glass-inset rounded-lg px-3 py-2.5 text-sm text-ink"
        >
          {example ? (
            feeExampleText(example)
          ) : (
            <span className="text-ink-muted">
              The example follows once the percentage and the amount are
              complete.
            </span>
          )}
        </p>
      </fieldset>
      <ul className="flex list-disc flex-col gap-1 border-t border-line pt-4 pl-4 text-13 text-ink-muted">
        <li>
          Counts for orders placed from now on. Earlier orders keep the costs
          they were placed with.
        </li>
        <li>
          The payment fee is an estimate. The real fee of each payment replaces
          it once Stripe reports it.
        </li>
        <li>
          Product prices are calculated on the page Pricing &amp; supplier.
        </li>
      </ul>
    </SettingsFormCard>
  );
}

/**
 * Settings → Order costs (32): delivery, packaging and other costs of one
 * order and the estimate of the payment fee. It has a permission of its
 * own: `finance.read` to see it, `finance.manage` to save.
 */
export function OrderCostsSection() {
  const settings = useOrderCostSettings();
  let body;
  if (settings.data) {
    body = <OrderCostsForm saved={settings.data} />;
  } else if (settings.isError) {
    const notice = describeError(settings.error);
    body = (
      <Alert
        tone="danger"
        title="The order costs could not be loaded"
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
          Loading the order costs
        </span>
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }
  return (
    <RequirePermission permission="finance.read">{body}</RequirePermission>
  );
}
