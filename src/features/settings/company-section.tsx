"use client";

import { Plus, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useFieldArray, useWatch } from "react-hook-form";
import { z } from "zod";
import { UnsavedGuard } from "@/components/form/fields";
import {
  TextField,
  TextareaField,
  fieldMessage,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import type { CompanyInput, CompanySettings } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { zOptionalText, zText } from "@/lib/validation";
import { useFollowSaved, useSaveCompany } from "./queries";
import { SettingsFormCard } from "./settings-card";
import { useCurrentSettings } from "./settings-frame";

export const MAX_ADDRESS_LINES = 5;
const VAT_ID = /^[A-Z]{2}[A-Z0-9]{2,13}$/;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** An address that may be left empty; an empty one is left out of the request. */
function zOptionalUrl(accepts: (url: URL) => boolean, message: string) {
  return z
    .string()
    .trim()
    .transform((value, context) => {
      if (value === "") return undefined;
      const url = parseUrl(value);
      if (!url || !accepts(url)) {
        context.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return value;
    });
}

// The rules of the API for the company (documentation, 5: PUT company).
export const companySchema = z.object({
  name: zText(120, "Enter the name of the company."),
  addressLines: z
    .array(z.object({ value: z.string().trim() }))
    .max(MAX_ADDRESS_LINES)
    .superRefine((lines, context) => {
      if (lines.every((line) => line.value === "")) {
        context.addIssue({
          code: "custom",
          path: [0, "value"],
          message: "Enter at least one line of the address.",
        });
      }
    }),
  email: z
    .string()
    .trim()
    .min(1, "Enter the email address.")
    .pipe(z.email("This is not an email address.")),
  phone: zOptionalText(40),
  website: zOptionalUrl(
    (url) => url.protocol === "https:" || url.protocol === "http:",
    "Enter the full address. Example: https://www.radhefoods.de",
  ),
  // Spaces and lower-case letters are a way of writing, not a mistake.
  vatId: z.string().transform((value, context) => {
    const id = value.replace(/[\s.-]/g, "").toUpperCase();
    if (id === "") return undefined;
    if (!VAT_ID.test(id)) {
      context.addIssue({
        code: "custom",
        message:
          "A VAT id is two letters of the country, then 2 to 13 letters or digits. Example: DE123456789",
      });
      return z.NEVER;
    }
    return id;
  }),
  taxNumber: zOptionalText(40),
  registration: zOptionalText(160),
  logoUrl: zOptionalUrl(
    (url) => url.protocol === "https:",
    "Enter the full address of the picture, starting with https://",
  ),
  invoiceFooter: zOptionalText(1000),
});

export type CompanyFormValues = z.input<typeof companySchema>;

export function companyDefaults(company: CompanySettings): CompanyFormValues {
  // A fresh installation has no address: street, then postcode and city.
  const lines =
    company.addressLines.length > 0 ? company.addressLines : ["", ""];
  return {
    name: company.name,
    addressLines: lines.map((value) => ({ value })),
    email: company.email,
    phone: company.phone ?? "",
    website: company.website ?? "",
    vatId: company.vatId ?? "",
    taxNumber: company.taxNumber ?? "",
    registration: company.registration ?? "",
    logoUrl: company.logoUrl ?? "",
    invoiceFooter: company.invoiceFooter ?? "",
  };
}

/** What the API gets: empty lines dropped, optional keys absent when unset. */
export function toCompanyInput(
  values: z.output<typeof companySchema>,
): CompanyInput {
  return {
    name: values.name,
    addressLines: values.addressLines
      .map((line) => line.value)
      .filter((line) => line !== ""),
    email: values.email,
    phone: values.phone,
    website: values.website,
    vatId: values.vatId,
    taxNumber: values.taxNumber,
    registration: values.registration,
    logoUrl: values.logoUrl,
    invoiceFooter: values.invoiceFooter,
  };
}

// The API names a line `addressLines.1`; the form holds it as an object.
const ADDRESS_ALIASES = Object.fromEntries(
  Array.from({ length: MAX_ADDRESS_LINES }, (_, index) => [
    `addressLines.${index}`,
    `addressLines.${index}.value`,
  ]),
);

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description ? (
          <p className="text-13 text-ink-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function CompanyForm({ company }: { company: CompanySettings }) {
  const manage = useCan()("settings.manage");
  const defaults = companyDefaults(company);
  const form = useZodForm(companySchema, { defaultValues: defaults });
  useFollowSaved(form, defaults);
  const lines = useFieldArray({ control: form.control, name: "addressLines" });
  const save = useSaveCompany();
  const addressId = useId();

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values) => {
      const saved = await save.mutateAsync(toCompanyInput(values));
      form.reset(companyDefaults(saved.company));
      notify.success(
        "Company details saved",
        saved.company.missingForInvoices.length === 0
          ? "They are printed on every new invoice and shown in every email."
          : undefined,
      );
    },
    { aliases: ADDRESS_ALIASES },
  );

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,48rem)_minmax(0,22rem)]">
      <SettingsFormCard
        title="Company"
        description="The seller printed on every invoice and shown in every email."
        onSubmit={onSubmit}
        state={state}
        pending={pending}
        dirty={form.formState.isDirty}
        saveLabel="Save the company details"
      >
        <UnsavedGuard when={form.formState.isDirty} />

        <Group title="Name and address">
          <TextField
            form={form}
            name="name"
            label="Company name"
            hint="With its legal form. Example: Radhe Foods GmbH"
            required
            maxLength={120}
            autoComplete="organization"
          />
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="float-left text-13 font-medium text-ink">
              Address
              <span aria-hidden="true" className="ml-0.5 text-danger-fg">
                *
              </span>
            </legend>
            <div className="flex flex-col gap-2">
              {lines.fields.map((line, index) => {
                const error = fieldMessage(form, `addressLines.${index}.value`);
                const errorId = `${addressId}-${index}-error`;
                return (
                  <div key={line.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Address line ${index + 1}`}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : `${addressId}-hint`}
                        placeholder={
                          index === 0
                            ? "Street and number"
                            : index === 1
                              ? "Postcode and city"
                              : undefined
                        }
                        autoComplete="off"
                        {...form.register(`addressLines.${index}.value`)}
                      />
                      {manage ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove address line ${index + 1}`}
                          disabled={lines.fields.length <= 1}
                          onClick={() => lines.remove(index)}
                        >
                          <X />
                        </Button>
                      ) : null}
                    </div>
                    {error ? (
                      <p id={errorId} className="text-13 text-danger-fg">
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id={`${addressId}-hint`} className="text-13 text-ink-subtle">
                1 to {MAX_ADDRESS_LINES} lines, as they are printed: the street,
                then postcode and city.
              </p>
              {manage && lines.fields.length < MAX_ADDRESS_LINES ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus />}
                  onClick={() => lines.append({ value: "" })}
                >
                  Add a line
                </Button>
              ) : null}
            </div>
          </fieldset>
        </Group>

        <Group title="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="email"
              label="Email"
              hint="Where customers write about an invoice."
              required
              type="email"
              inputMode="email"
              autoComplete="off"
            />
            <TextField
              form={form}
              name="phone"
              label="Phone"
              optional
              maxLength={40}
              inputMode="tel"
              autoComplete="off"
            />
          </div>
          <TextField
            form={form}
            name="website"
            label="Website"
            optional
            placeholder="https://"
            inputMode="url"
            autoComplete="off"
          />
        </Group>

        <Group
          title="Tax and register"
          description="Invoices need a VAT id or a tax number. One of the two is enough."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="vatId"
              label="VAT id"
              hint="USt-IdNr. Example: DE123456789"
              optional
              className="uppercase tabular placeholder:normal-case"
              autoComplete="off"
              spellCheck={false}
            />
            <TextField
              form={form}
              name="taxNumber"
              label="Tax number"
              hint="Steuernummer, as the tax office writes it."
              optional
              maxLength={40}
              className="tabular"
              autoComplete="off"
            />
          </div>
          <TextField
            form={form}
            name="registration"
            label="Commercial register"
            hint="Example: Amtsgericht Frankfurt am Main, HRB 12345"
            optional
            maxLength={160}
            autoComplete="off"
          />
        </Group>

        <Group title="Invoices and emails">
          <TextField
            form={form}
            name="logoUrl"
            label="Logo"
            hint="The full https address of the logo picture. It is shown in emails and on invoices."
            optional
            placeholder="https://"
            inputMode="url"
            autoComplete="off"
          />
          <TextareaField
            form={form}
            name="invoiceFooter"
            label="Footer of the invoice"
            hint="A line or two under every invoice: thanks, bank details, opening hours."
            optional
            rows={3}
            maxLength={1000}
          />
        </Group>
      </SettingsFormCard>

      <SellerPreview form={form} />
    </div>
  );
}

function Logo({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="text-13 text-danger-fg">
        The logo could not be loaded from this address.
      </p>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an address typed by the admin, shown as it is
    <img
      src={url}
      alt="Logo of the company"
      className="max-h-12 max-w-40 object-contain object-left"
      onError={() => setFailed(true)}
    />
  );
}

/** What the fields add up to: the seller as customers will read it. */
function SellerPreview({
  form,
}: {
  form: ReturnType<typeof useZodForm<typeof companySchema>>;
}) {
  const values = useWatch({ control: form.control });
  const lines = (values.addressLines ?? [])
    .map((line) => line?.value?.trim() ?? "")
    .filter((line) => line !== "");
  const vatId = (values.vatId ?? "").replace(/[\s.-]/g, "").toUpperCase();
  const taxNumber = values.taxNumber?.trim() ?? "";
  const logoUrl = values.logoUrl?.trim() ?? "";
  const logo = parseUrl(logoUrl)?.protocol === "https:" ? logoUrl : null;
  const contact = [values.email, values.phone, values.website]
    .map((entry) => entry?.trim() ?? "")
    .filter((entry) => entry !== "");
  const footer = values.invoiceFooter?.trim() ?? "";

  return (
    <Card aria-label="Preview of the seller" className="xl:sticky xl:top-20">
      <CardHeader
        title="As customers read it"
        description="The details as they stand in the form, saved or not."
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        {logo ? <Logo key={logo} url={logo} /> : null}
        <div>
          <p className="font-semibold text-ink">
            {values.name?.trim() || (
              <span className="font-normal text-ink-subtle">No name yet</span>
            )}
          </p>
          {lines.length > 0 ? (
            lines.map((line, index) => (
              <p key={index} className="text-ink-muted">
                {line}
              </p>
            ))
          ) : (
            <p className="text-ink-subtle">No address yet</p>
          )}
        </div>
        {contact.length > 0 ? (
          <div className="break-words text-ink-muted">
            {contact.map((entry) => (
              <p key={entry}>{entry}</p>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5 text-ink-muted">
          {vatId ? <p>VAT id: {vatId}</p> : null}
          {taxNumber ? <p>Tax number: {taxNumber}</p> : null}
          {!vatId && !taxNumber ? (
            <Badge tone="attention" className="self-start">
              VAT id or tax number is missing
            </Badge>
          ) : null}
          {values.registration?.trim() ? (
            <p>{values.registration.trim()}</p>
          ) : null}
        </div>
        {footer ? (
          <p className="border-t border-line pt-3 text-13 whitespace-pre-line text-ink-muted">
            {footer}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function CompanySection() {
  const settings = useCurrentSettings();
  if (!settings) return null;
  return <CompanyForm company={settings.company} />;
}
