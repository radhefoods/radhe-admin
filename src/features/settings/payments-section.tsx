"use client";

import { z } from "zod";
import { UnitField } from "@/components/form/fields";
import { SelectField, useSubmit, useZodForm } from "@/components/form/form";
import { notify } from "@/components/ui/toast";
import type { PaymentSettings } from "@/lib/api/types";
import { formatDuration } from "@/lib/format/dates";
import { zInt } from "@/lib/validation";
import { useFollowSaved, useSavePayments } from "./queries";
import { SettingRow, SettingsFormCard } from "./settings-card";
import { useCurrentSettings } from "./settings-frame";

// The rules of the API (documentation, 5: PUT payments): 0–23 / 1–60 / 30–1440.
export const paymentsSchema = z.object({
  reminderHour: zInt({ min: 0, max: 23 }),
  defaultDeadlineDays: zInt({ min: 1, max: 60 }),
  checkoutMinutes: zInt({ min: 30, max: 1440 }),
});

export type PaymentsFormValues = z.input<typeof paymentsSchema>;

export function paymentsDefaults(
  payments: PaymentSettings,
): PaymentsFormValues {
  return {
    reminderHour: String(payments.reminderHour),
    defaultDeadlineDays: String(payments.defaultDeadlineDays),
    checkoutMinutes: String(payments.checkoutMinutes),
  };
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** `9` reads as `09:00`. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function PaymentsForm({ saved }: { saved: PaymentSettings }) {
  const defaults = paymentsDefaults(saved);
  const form = useZodForm(paymentsSchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const save = useSavePayments();
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const result = await save.mutateAsync(values);
    form.reset(paymentsDefaults(result.payments));
    notify.success("Payment settings saved");
  });

  const minutes = zInt({ min: 30, max: 1440 }).safeParse(
    form.watch("checkoutMinutes"),
  );

  return (
    <SettingsFormCard
      title="Payments"
      description="Customers pay after delivery. These values steer the deadline, the reminders and the online checkout."
      onSubmit={onSubmit}
      state={state}
      pending={pending}
      dirty={form.formState.isDirty}
      saveLabel="Save the payment settings"
      className="max-w-3xl"
    >
      <SettingRow explanation="Proposed when payment is activated for an order or a cargo, and it can be changed for each activation. The deadline is the end of the last day, German time.">
        <UnitField
          form={form}
          name="defaultDeadlineDays"
          label="Days to pay"
          unit="days"
          hint="1 to 60 days."
          required
        />
      </SettingRow>
      <SettingRow explanation="A customer who has not paid is reminded once a day at this hour, until the order is paid.">
        <SelectField
          form={form}
          name="reminderHour"
          label="Reminders go out at"
          hint="German time."
          required
          className="tabular"
        >
          {HOURS.map((hour) => (
            <option key={hour} value={String(hour)}>
              {hourLabel(hour)}
            </option>
          ))}
        </SelectField>
      </SettingRow>
      <SettingRow explanation="How long the payment page stays open once a customer starts to pay online. After that the customer starts again from the payment link.">
        <UnitField
          form={form}
          name="checkoutMinutes"
          label="An online checkout stays open for"
          unit="minutes"
          hint={`30 to 1440 minutes (24 hours)${
            minutes.success && minutes.data >= 60
              ? `. Now: ${formatDuration(minutes.data * 60_000)}`
              : ""
          }.`}
          required
        />
      </SettingRow>
    </SettingsFormCard>
  );
}

export function PaymentsSection() {
  const settings = useCurrentSettings();
  if (!settings) return null;
  return <PaymentsForm saved={settings.payments} />;
}
