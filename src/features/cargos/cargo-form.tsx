"use client";

import { z } from "zod";
import {
  BerlinDateTimeField,
  BilingualField,
  DayField,
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
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import type {
  Cargo,
  CargoInput,
  CargoPatch,
  CargoStatus,
} from "@/lib/api/types";
import {
  berlinDay,
  berlinToDate,
  berlinToIso,
  toLocalInput,
} from "@/lib/format/dates";
import { translatedDefaults } from "@/lib/validation";
import { useCargoChoices } from "./queries";

// The rules of the API for a cargo (documentation, 9): the deadline lies
// after the opening, the delivery window does not end before it starts and
// does not start before the day of the deadline.
const text = (max: number) =>
  z.string().trim().max(max, `At most ${max} characters.`);
const translated = (max: number) => z.object({ en: text(max), de: text(max) });
const moment = z
  .string()
  .refine((value) => berlinToDate(value) !== null, "Enter a date and a time.");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");

export const cargoSchema = z
  .object({
    internalName: text(120).min(1, "Give the cargo a name."),
    customerName: translated(160),
    customerMessage: translated(1000),
    internalNotes: text(5000),
    orderOpenAt: moment,
    orderCloseAt: moment,
    deliveryStart: day,
    deliveryEnd: day,
    status: z.enum(["draft", "scheduled"]),
    copyProductsFrom: z.string(),
  })
  .superRefine((value, context) => {
    const open = berlinToDate(value.orderOpenAt);
    const close = berlinToDate(value.orderCloseAt);
    if (open && close && close <= open) {
      context.addIssue({
        code: "custom",
        path: ["orderCloseAt"],
        message: "The deadline must lie after the opening.",
      });
    }
    if (
      value.deliveryStart &&
      value.deliveryEnd &&
      value.deliveryEnd < value.deliveryStart
    ) {
      context.addIssue({
        code: "custom",
        path: ["deliveryEnd"],
        message: "The window cannot end before it starts.",
      });
    }
    if (
      close &&
      value.deliveryStart &&
      value.deliveryStart < berlinDay(close)
    ) {
      context.addIssue({
        code: "custom",
        path: ["deliveryStart"],
        message: "Delivery cannot start before the day of the deadline.",
      });
    }
  });

export type CargoFormValues = z.input<typeof cargoSchema>;

const optional = (value: { en: string; de: string }) =>
  value.en || value.de
    ? { en: value.en || null, de: value.de || null }
    : undefined;

/** What the API gets for a new cargo. */
export function toCargoInput(values: CargoFormValues): CargoInput {
  return {
    internalName: values.internalName.trim(),
    customerName: optional(values.customerName),
    customerMessage: optional(values.customerMessage),
    internalNotes: values.internalNotes.trim() || undefined,
    orderOpenAt: berlinToIso(values.orderOpenAt) ?? "",
    orderCloseAt: berlinToIso(values.orderCloseAt) ?? "",
    deliveryStart: values.deliveryStart,
    deliveryEnd: values.deliveryEnd,
    status: values.status,
    copyProductsFrom: values.copyProductsFrom || undefined,
  };
}

/** Only what changed: the API refuses a time that can no longer change. */
export function toCargoPatch(
  values: CargoFormValues,
  cargo: Cargo,
): CargoPatch {
  const patch: CargoPatch = {};
  const before = cargoDefaults(cargo);
  if (values.internalName.trim() !== before.internalName) {
    patch.internalName = values.internalName.trim();
  }
  for (const key of ["customerName", "customerMessage"] as const) {
    if (
      values[key].en !== before[key].en ||
      values[key].de !== before[key].de
    ) {
      patch[key] = { en: values[key].en || null, de: values[key].de || null };
    }
  }
  if (values.internalNotes.trim() !== before.internalNotes) {
    patch.internalNotes = values.internalNotes.trim() || null;
  }
  if (values.orderOpenAt !== before.orderOpenAt) {
    patch.orderOpenAt = berlinToIso(values.orderOpenAt) ?? undefined;
  }
  if (values.orderCloseAt !== before.orderCloseAt) {
    patch.orderCloseAt = berlinToIso(values.orderCloseAt) ?? undefined;
  }
  if (values.deliveryStart !== before.deliveryStart)
    patch.deliveryStart = values.deliveryStart;
  if (values.deliveryEnd !== before.deliveryEnd)
    patch.deliveryEnd = values.deliveryEnd;
  return patch;
}

export function cargoDefaults(cargo?: Cargo): CargoFormValues {
  return {
    internalName: cargo?.internalName ?? "",
    customerName: translatedDefaults(cargo?.customerName),
    customerMessage: translatedDefaults(cargo?.customerMessage),
    internalNotes: cargo?.internalNotes ?? "",
    orderOpenAt: toLocalInput(cargo?.orderOpenAt),
    orderCloseAt: toLocalInput(cargo?.orderCloseAt),
    deliveryStart: cargo?.delivery.start ?? "",
    deliveryEnd: cargo?.delivery.end ?? "",
    status: "scheduled",
    copyProductsFrom: "",
  };
}

/** What can still change in which status (documentation, 9: PATCH). */
export function editable(status: CargoStatus | undefined) {
  return {
    any: status !== "cancelled",
    opening:
      status === undefined || status === "draft" || status === "scheduled",
    deadline:
      status === undefined ||
      status === "draft" ||
      status === "scheduled" ||
      status === "taking_orders",
    delivery: status !== "delivered" && status !== "cancelled",
  };
}

function StatusChoice({
  value,
  onChange,
}: {
  value: "draft" | "scheduled";
  onChange: (value: "draft" | "scheduled") => void;
}) {
  const control = useControlProps();
  return (
    <RadioGroup
      {...control}
      value={value}
      onValueChange={(next) => onChange(next as "draft" | "scheduled")}
      className="gap-3"
    >
      {(
        [
          [
            "scheduled",
            "Schedule it",
            "Opens by itself at the opening time and closes at the deadline.",
          ],
          [
            "draft",
            "Keep it as a draft",
            "Nothing happens until you schedule or open it.",
          ],
        ] as const
      ).map(([key, label, hint]) => (
        <label key={key} className="flex cursor-pointer items-start gap-2.5">
          <RadioItem value={key} className="mt-0.5" />
          <span className="text-sm text-ink">
            {label}
            <span className="block text-13 text-ink-muted">{hint}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

/**
 * The form of a cargo, for a new one and for changing one. A field that
 * can no longer change in the cargo's status is locked and says why.
 */
export function CargoForm({
  cargo,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** Set when an existing cargo is changed. */
  cargo?: Cargo;
  submitLabel: string;
  onSubmit: (values: CargoFormValues) => Promise<unknown>;
  onCancel: () => void;
}) {
  const form = useZodForm(cargoSchema, { defaultValues: cargoDefaults(cargo) });
  const { onSubmit: submit, state, pending } = useSubmit(form, onSubmit);
  const can = editable(cargo?.status);
  const creating = !cargo;
  const choices = useCargoChoices(creating).data;
  const sources = (choices?.items ?? []).filter(
    (entry) => entry.products.total > 0,
  );
  const status = form.watch("status");

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-7">
      <UnsavedGuard
        when={form.formState.isDirty && !form.formState.isSubmitSuccessful}
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-ink">Name</h2>
        <TextField
          form={form}
          name="internalName"
          label="Internal name"
          hint="Only the team sees it. Example: October, first week."
          required
          maxLength={120}
          autoFocus={creating}
        />
        <BilingualField
          form={form}
          name="customerName"
          label="Name for customers"
          hint="Shown in the shop next to the delivery days. Optional."
          maxLength={160}
        />
        <BilingualField
          form={form}
          name="customerMessage"
          label="Message for customers"
          hint="A line under the pre-order banner of the shop. Optional."
          multiline
          rows={2}
          maxLength={1000}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Order window</h2>
          <p className="text-13 text-ink-muted">
            All times are German time. Only one cargo can take orders at a time,
            so windows of scheduled cargos must not overlap.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <BerlinDateTimeField
            form={form}
            name="orderOpenAt"
            label="Ordering opens"
            required
            disabled={!can.opening}
            hint={
              can.opening
                ? "German time."
                : "Ordering has begun: the opening is fixed."
            }
          />
          <BerlinDateTimeField
            form={form}
            name="orderCloseAt"
            label="Order deadline"
            required
            disabled={!can.deadline}
            hint={
              can.deadline
                ? "German time. It counts to the second for customers."
                : "Ordering has ended: the deadline is fixed."
            }
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Delivery window</h2>
          <p className="text-13 text-ink-muted">
            The days customers are promised. Orders show the days of the cargo
            they are in.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DayField
            form={form}
            name="deliveryStart"
            label="First delivery day"
            required
            disabled={!can.delivery}
          />
          <DayField
            form={form}
            name="deliveryEnd"
            label="Last delivery day"
            required
            disabled={!can.delivery}
          />
        </div>
      </section>

      {creating ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-ink">
            Products and start
          </h2>
          <SelectField
            form={form}
            name="copyProductsFrom"
            label="Take the products and limits of"
            hint="A product without a setting cannot be ordered in the cargo. You can change them afterwards."
            optional
          >
            <option value="">No cargo: start without products</option>
            {sources.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} · {entry.internalName} · {entry.products.enabled}{" "}
                products
              </option>
            ))}
          </SelectField>
          <Field label="After saving">
            <StatusChoice
              value={status}
              onChange={(value) =>
                form.setValue("status", value, { shouldDirty: true })
              }
            />
          </Field>
        </section>
      ) : null}

      <TextareaField
        form={form}
        name="internalNotes"
        label="Internal notes"
        hint="Container number, supplier, anything the team should know."
        optional
        rows={3}
        maxLength={5000}
      />

      <FormError state={state} />

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" size="lg" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
