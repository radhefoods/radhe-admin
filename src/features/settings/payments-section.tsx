"use client";

import { z } from "zod";
import { UnitField } from "@/components/form/fields";
import { useSubmit, useZodForm } from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import type { PaymentSettings, Settings } from "@/lib/api/types";
import { formatDuration } from "@/lib/format/dates";
import { zInt } from "@/lib/validation";
import { useFollowSaved, useSavePayments } from "./queries";
import { SettingRow, SettingsFormCard } from "./settings-card";
import { useCurrentSettings } from "./settings-frame";

// The rule of the API (documentation, 5: PUT payments): 30 to 1440 minutes.
export const paymentsSchema = z.object({
  checkoutMinutes: zInt({ min: 30, max: 1440 }),
});

export type PaymentsFormValues = z.input<typeof paymentsSchema>;

export function paymentsDefaults(
  payments: PaymentSettings,
): PaymentsFormValues {
  return { checkoutMinutes: String(payments.checkoutMinutes) };
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
      description="Customers pay at checkout on a Stripe page, by card or PayPal. The payment confirms the order; the admin records no payment."
      onSubmit={onSubmit}
      state={state}
      pending={pending}
      dirty={form.formState.isDirty}
      saveLabel="Save the payment settings"
      className="max-w-3xl"
    >
      <SettingRow explanation="How long the Stripe page stays open once a customer starts to pay. An order whose page expired without a payment is given up by the shop a little later; the customer can open a new page from the order page until then.">
        <UnitField
          form={form}
          name="checkoutMinutes"
          label="A payment page stays open for"
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

/** What the server is connected to (5, 18): said here, before anyone tries. */
function Integrations({
  integrations,
}: {
  integrations: NonNullable<Settings["integrations"]>;
}) {
  const rows = [
    {
      name: "Online payment (Stripe)",
      on: integrations.stripeConnected,
      yes: "Connected: customers can pay at checkout, and refunds can go through Stripe.",
      no: "Not set up: the shop cannot sell, because every order is paid at checkout. Refunds by hand still work. The Stripe keys are set on the server.",
    },
    {
      name: "WhatsApp",
      on: integrations.whatsappConfigured,
      yes: "Configured: customers who opted in get dispatch notes and news on WhatsApp as well.",
      no: "Not set up: every message goes by email only. The WhatsApp credentials are set on the server.",
    },
  ];
  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Connected services"
        description="Set on the server, not here. The panel follows them."
      />
      <CardBody>
        <dl className="flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.name} className="flex flex-col gap-1">
              <dt className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                {row.name}
                <Badge tone={row.on ? "success" : "neutral"}>
                  {row.on ? "On" : "Off"}
                </Badge>
              </dt>
              <dd className="text-13 text-ink-muted">
                {row.on ? row.yes : row.no}
              </dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

export function PaymentsSection() {
  const settings = useCurrentSettings();
  if (!settings) return null;
  return (
    <div className="flex flex-col gap-6">
      {settings.integrations ? (
        <Integrations integrations={settings.integrations} />
      ) : null}
      <PaymentsForm saved={settings.payments} />
    </div>
  );
}
