"use client";

import { Plus, Truck, X } from "lucide-react";
import { useId, type ComponentProps } from "react";
import { useFieldArray, useWatch } from "react-hook-form";
import { z } from "zod";
import { UnsavedGuard } from "@/components/form/fields";
import { fieldMessage, useSubmit, useZodForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import type { DeliveryFeeTier } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { centsToInput, parseEuros } from "@/lib/format/money";
import { zEuros } from "@/lib/validation";
import {
  MAX_TIER_AMOUNT,
  MAX_TIERS,
  MIN_TIERS,
  sortTiers,
  tierProblems,
  tierSentences,
} from "./delivery-fee";
import { useFollowSaved, useSaveDeliveryFee } from "./queries";
import { SettingsFormCard } from "./settings-card";
import { useCurrentSettings } from "./settings-frame";

// Typed in euros, sent as integer cents (documentation, 5: PUT delivery-fee).
const amount = zEuros({ min: 0, max: MAX_TIER_AMOUNT });

export const deliveryFeeSchema = z
  .object({
    tiers: z
      .array(z.object({ minOrderValue: amount, fee: amount }))
      .min(MIN_TIERS, "At least one tier is needed.")
      .max(MAX_TIERS, `At most ${MAX_TIERS} tiers.`),
  })
  .superRefine((value, context) => {
    for (const problem of tierProblems(value.tiers)) {
      context.addIssue({
        code: "custom",
        path: ["tiers", problem.index, "minOrderValue"],
        message: problem.message,
      });
    }
  });

export type DeliveryFeeFormValues = z.input<typeof deliveryFeeSchema>;

export function deliveryFeeDefaults(
  tiers: readonly DeliveryFeeTier[],
): DeliveryFeeFormValues {
  return {
    tiers: sortTiers(tiers).map((tier) => ({
      minOrderValue: centsToInput(tier.minOrderValue),
      fee: centsToInput(tier.fee),
    })),
  };
}

/** The tiers as they are typed right now, or `null` while an amount is not one. */
function typedTiers(
  rows: readonly { minOrderValue?: string; fee?: string }[] | undefined,
): DeliveryFeeTier[] | null {
  const tiers: DeliveryFeeTier[] = [];
  for (const row of rows ?? []) {
    const minOrderValue = parseEuros(row.minOrderValue ?? "");
    const fee = parseEuros(row.fee ?? "");
    if (minOrderValue === null || fee === null) return null;
    if (minOrderValue > MAX_TIER_AMOUNT || fee > MAX_TIER_AMOUNT) return null;
    tiers.push({ minOrderValue, fee });
  }
  return tiers;
}

function EuroInput({
  label,
  error,
  errorId,
  ...input
}: {
  label: string;
  error: string | null;
  errorId: string;
} & ComponentProps<"input">) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
      >
        €
      </span>
      <Input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        className="pl-7 tabular"
        {...input}
      />
    </div>
  );
}

function DeliveryFeeForm({ saved }: { saved: readonly DeliveryFeeTier[] }) {
  const manage = useCan()("settings.manage");
  const defaults = deliveryFeeDefaults(saved);
  const form = useZodForm(deliveryFeeSchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const rows = useFieldArray({ control: form.control, name: "tiers" });
  const save = useSaveDeliveryFee();
  const id = useId();

  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const result = await save.mutateAsync(sortTiers(values.tiers));
    form.reset(deliveryFeeDefaults(result.deliveryFee.tiers));
    notify.success("Delivery fee saved", "New orders use it from now on.");
  });

  const typed = typedTiers(useWatch({ control: form.control, name: "tiers" }));
  const valid =
    typed !== null && typed.length > 0 && tierProblems(typed).length === 0;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,40rem)_minmax(0,24rem)]">
      <SettingsFormCard
        title="Delivery fee"
        description="What delivery costs, by the value of the goods in an order (VAT included)."
        onSubmit={onSubmit}
        state={state}
        pending={pending}
        dirty={form.formState.isDirty}
        saveLabel="Save the delivery fee"
      >
        <UnsavedGuard when={form.formState.isDirty} />
        <div className="flex flex-col gap-2">
          <div
            aria-hidden="true"
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_34px] gap-3 text-13 font-medium text-ink"
          >
            <span>Order value from</span>
            <span>Delivery fee</span>
            <span />
          </div>
          <ol className="flex flex-col gap-2">
            {rows.fields.map((row, index) => {
              const fromError = fieldMessage(
                form,
                `tiers.${index}.minOrderValue`,
              );
              const feeError = fieldMessage(form, `tiers.${index}.fee`);
              const fromErrorId = `${id}-${index}-from`;
              const feeErrorId = `${id}-${index}-fee`;
              return (
                <li key={row.id} className="flex flex-col gap-1">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_34px] items-center gap-3">
                    <EuroInput
                      label={`Tier ${index + 1}: order value from`}
                      error={fromError}
                      errorId={fromErrorId}
                      {...form.register(`tiers.${index}.minOrderValue`)}
                    />
                    <EuroInput
                      label={`Tier ${index + 1}: delivery fee`}
                      error={feeError}
                      errorId={feeErrorId}
                      {...form.register(`tiers.${index}.fee`)}
                    />
                    {manage ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove tier ${index + 1}`}
                        disabled={rows.fields.length <= MIN_TIERS}
                        onClick={() => rows.remove(index)}
                      >
                        <X />
                      </Button>
                    ) : (
                      <span />
                    )}
                  </div>
                  {fromError ? (
                    <p id={fromErrorId} className="text-13 text-danger-fg">
                      {fromError}
                    </p>
                  ) : null}
                  {feeError ? (
                    <p id={feeErrorId} className="text-13 text-danger-fg">
                      Fee: {feeError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-13 text-ink-subtle">
              {MIN_TIERS} to {MAX_TIERS} tiers. One starts at €0.00; a fee of
              €0.00 means free delivery.
            </p>
            {manage ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus />}
                disabled={rows.fields.length >= MAX_TIERS}
                onClick={() =>
                  rows.append(
                    { minOrderValue: "", fee: "" },
                    { shouldFocus: true },
                  )
                }
              >
                Add a tier
              </Button>
            ) : null}
          </div>
        </div>
      </SettingsFormCard>

      <Card aria-label="What the tiers mean">
        <CardHeader
          title="What customers pay"
          description="The tiers as they stand in the form, saved or not."
        />
        <CardBody className="flex flex-col gap-4">
          {valid ? (
            <ul className="flex flex-col gap-2">
              {tierSentences(typed).map((sentence) => (
                <li
                  key={sentence}
                  className="flex items-start gap-2.5 text-sm text-ink"
                >
                  <Truck
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-ink-subtle"
                  />
                  {sentence}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">
              The tiers are not complete yet: every tier needs an amount, one
              tier starts at €0.00, and no two tiers start at the same value.
            </p>
          )}
          <ul className="flex list-disc flex-col gap-1 border-t border-line pt-3 pl-4 text-13 text-ink-muted">
            <li>The highest tier an order reaches applies.</li>
            <li>The value of the goods counts, VAT included.</li>
            <li>Orders that are already placed keep their fee.</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

export function DeliveryFeeSection() {
  const settings = useCurrentSettings();
  if (!settings) return null;
  return <DeliveryFeeForm saved={settings.deliveryFee.tiers} />;
}
