"use client";

import { useId } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { UnitField } from "@/components/form/fields";
import { SelectField, useSubmit, useZodForm } from "@/components/form/form";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import {
  DELIVERY_METHODS,
  type CustomerCancellation,
  type DeliveryMethod,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { DELIVERY_METHOD_LABEL, plural } from "@/lib/format/names";
import { zInt } from "@/lib/validation";
import {
  useFollowSaved,
  useSaveDeliveryMethod,
  useSaveOrderPolicy,
  useSaveReturnPolicy,
} from "./queries";
import { SettingRow, SettingsFormCard } from "./settings-card";
import { useCurrentSettings } from "./settings-frame";

// --- Customer cancellation (PUT order-policy) --------------------------------

export const CANCELLATION_RULES: {
  value: CustomerCancellation;
  label: string;
  explanation: string;
}[] = [
  {
    value: "while_confirmed",
    label: "While the order is confirmed",
    explanation:
      "Customers can cancel until the team starts preparing the order. After that only the team can cancel.",
  },
  {
    value: "until_dispatched",
    label: "Until the order is dispatched",
    explanation:
      "Customers can cancel while the order is confirmed or being prepared, up to the moment it is dispatched.",
  },
  {
    value: "never",
    label: "Never",
    explanation:
      "Customers cannot cancel by themselves. They ask, and the team cancels the order for them.",
  },
];

const cancellationSchema = z.object({
  customerCancellation: z.enum([
    "while_confirmed",
    "until_dispatched",
    "never",
  ]),
});

function CancellationForm({ saved }: { saved: CustomerCancellation }) {
  const manage = useCan()("settings.manage");
  const defaults = { customerCancellation: saved };
  const form = useZodForm(cancellationSchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const save = useSaveOrderPolicy();
  const groupId = useId();
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const result = await save.mutateAsync(values.customerCancellation);
    form.reset(result.orderPolicy);
    notify.success("Cancellation rule saved");
  });

  return (
    <SettingsFormCard
      title="Cancellation by customers"
      description="Until when a customer can cancel an order in the shop. The team can cancel in the panel as long as the order allows it."
      onSubmit={onSubmit}
      state={state}
      pending={pending}
      dirty={form.formState.isDirty}
      saveLabel="Save the cancellation rule"
    >
      <Controller
        control={form.control}
        name="customerCancellation"
        render={({ field }) => (
          <RadioGroup
            aria-label="Customers can cancel"
            value={field.value}
            onValueChange={field.onChange}
            disabled={!manage}
            className="gap-3"
          >
            {CANCELLATION_RULES.map((rule) => (
              <div key={rule.value} className="flex items-start gap-2.5">
                <RadioItem
                  id={`${groupId}-${rule.value}`}
                  value={rule.value}
                  aria-describedby={`${groupId}-${rule.value}-hint`}
                  className="mt-0.5"
                />
                <div className="flex min-w-0 flex-col">
                  <label
                    htmlFor={`${groupId}-${rule.value}`}
                    className="text-sm font-medium text-ink"
                  >
                    {rule.label}
                  </label>
                  <p
                    id={`${groupId}-${rule.value}-hint`}
                    className="text-13 text-ink-muted"
                  >
                    {rule.explanation}
                  </p>
                </div>
              </div>
            ))}
          </RadioGroup>
        )}
      />
    </SettingsFormCard>
  );
}

// --- Default delivery method (PUT delivery) -----------------------------------

const deliverySchema = z.object({ defaultMethod: z.enum(DELIVERY_METHODS) });

function DeliveryMethodForm({ saved }: { saved: DeliveryMethod }) {
  const defaults = { defaultMethod: saved };
  const form = useZodForm(deliverySchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const save = useSaveDeliveryMethod();
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const result = await save.mutateAsync(values.defaultMethod);
    form.reset(result.delivery);
    notify.success(
      "Delivery method saved",
      `New orders get ${DELIVERY_METHOD_LABEL[result.delivery.defaultMethod]}.`,
    );
  });

  return (
    <SettingsFormCard
      title="Delivery method"
      description="Every new order gets this method. Customers never choose it."
      onSubmit={onSubmit}
      state={state}
      pending={pending}
      dirty={form.formState.isDirty}
      saveLabel="Save the delivery method"
    >
      <SettingRow explanation="Orders that exist keep their method. It can be changed for one order, or for all orders of a cargo at once.">
        <SelectField
          form={form}
          name="defaultMethod"
          label="Method of every new order"
        >
          {DELIVERY_METHODS.map((method) => (
            <option key={method} value={method}>
              {DELIVERY_METHOD_LABEL[method]}
            </option>
          ))}
        </SelectField>
      </SettingRow>
    </SettingsFormCard>
  );
}

// --- Return window (PUT return-policy) -----------------------------------------

const returnSchema = z.object({ windowDays: zInt({ min: 0, max: 365 }) });

function ReturnWindowForm({ saved }: { saved: number }) {
  const defaults = { windowDays: String(saved) };
  const form = useZodForm(returnSchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const save = useSaveReturnPolicy();
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const result = await save.mutateAsync(values.windowDays);
    form.reset({ windowDays: String(result.returnPolicy.windowDays) });
    notify.success(
      "Return window saved",
      result.returnPolicy.windowDays === 0
        ? "Return requests are switched off."
        : `Customers have ${plural(result.returnPolicy.windowDays, "day")} after delivery.`,
    );
  });

  const typed = returnSchema.safeParse({
    windowDays: form.watch("windowDays"),
  });
  const days = typed.success ? typed.data.windowDays : null;

  return (
    <SettingsFormCard
      title="Returns"
      description="How long after delivery a customer can ask to return products."
      onSubmit={onSubmit}
      state={state}
      pending={pending}
      dirty={form.formState.isDirty}
      saveLabel="Save the return window"
    >
      <SettingRow
        explanation={
          days === 0
            ? "With 0 days no customer can ask for a return in the shop."
            : days !== null
              ? `A customer can ask for a return up to ${plural(days, "day")} after the order was delivered.`
              : "The days count from the delivery of the order."
        }
      >
        <UnitField
          form={form}
          name="windowDays"
          label="Return window"
          unit="days"
          hint="0 to 365 days. 0 switches return requests off."
          required
        />
      </SettingRow>
      {days === 0 ? (
        <Alert tone="warning" title="Return requests are switched off">
          Customers cannot ask for a return while the window is 0 days. Returns
          that were already requested stay as they are.
        </Alert>
      ) : null}
    </SettingsFormCard>
  );
}

/** Three rules, three endpoints: three small forms, each with its own save. */
export function OrdersSection() {
  const settings = useCurrentSettings();
  if (!settings) return null;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <CancellationForm saved={settings.orderPolicy.customerCancellation} />
      <DeliveryMethodForm saved={settings.delivery.defaultMethod} />
      <ReturnWindowForm saved={settings.returnPolicy.windowDays} />
    </div>
  );
}
