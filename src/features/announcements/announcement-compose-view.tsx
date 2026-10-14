"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import {
  BilingualField,
  CheckboxField,
  UnsavedGuard,
} from "@/components/form/fields";
import {
  Field,
  FormError,
  SelectField,
  TextField,
  fieldMessage,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { useCargoChoices } from "@/features/cargos/queries";
import { useWhatsappEnabled } from "@/features/notifications/queries";
import { WhatsappState } from "@/features/notifications/whatsapp-state";
import type { AnnouncementInput, AnnouncementPreview } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { CARGO_STATUS } from "@/lib/status";
import { AnnouncementPreviewPanel } from "./announcement-preview";
import { ProductPicker, type PickedProduct } from "./product-picker";
import { usePreviewAnnouncement, useSendAnnouncement } from "./queries";
import {
  LINK_MAX,
  MESSAGE_MAX,
  SUBJECT_MAX,
  announcementDefaults,
  announcementSchema,
  customersReached,
  messagesQueued,
  toAnnouncementInput,
} from "./schema";

function Steps({ current }: { current: 1 | 2 }) {
  const steps = ["Write", "Preview and send"];
  return (
    <ol
      aria-label="Steps"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 text-13"
    >
      {steps.map((label, index) => {
        const number = index + 1;
        const done = number < current;
        const active = number === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 font-medium",
              active ? "text-ink" : "text-ink-subtle",
            )}
          >
            {index > 0 ? (
              <span aria-hidden="true" className="h-px w-6 bg-line-strong" />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-2xs font-semibold tabular",
                active
                  ? "bg-accent text-accent-fg"
                  : done
                    ? "bg-success-bg text-success-fg"
                    : "bg-neutral-bg text-neutral-fg",
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : number}
            </span>
            {label}
            {done ? <span className="sr-only"> (done)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Writes news for the customers who asked for it, in two steps: the API
 * first says who would get it and how it reads (nothing is sent), then the
 * admin confirms the real numbers and it goes out.
 */
export function AnnouncementComposeView() {
  const router = useRouter();
  const can = useCan();
  const whatsappEnabled = useWhatsappEnabled();
  const form = useZodForm(announcementSchema, {
    defaultValues: announcementDefaults,
  });
  const preview = usePreviewAnnouncement();
  const send = useSendAnnouncement();
  const cargos = useCargoChoices(can("cargos.read")).data;
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [previewed, setPreviewed] = useState<{
    input: AnnouncementInput;
    preview: AnnouncementPreview;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const input = toAnnouncementInput(values);
    setPreviewed({ input, preview: await preview.mutateAsync(input) });
  });

  // The preview replaces the form: the screen reader and the view follow.
  useEffect(() => {
    if (previewed) previewHeading.current?.focus();
  }, [previewed]);

  const reached = previewed
    ? customersReached(previewed.preview.recipients)
    : 0;
  const channelError = fieldMessage(form, "email");

  return (
    <RequirePermission permission="notifications.manage">
      <PageHeader
        title="New announcement"
        back={{ href: routes.announcements, label: "Announcements" }}
        description="News about a product or a cargo, sent by hand. Nothing goes out before you have seen the preview and confirmed."
      />
      <PageBody className={previewed ? undefined : "max-w-3xl"}>
        <UnsavedGuard when={form.formState.isDirty && !sent} />
        <Steps current={previewed ? 2 : 1} />

        <form
          onSubmit={onSubmit}
          noValidate
          hidden={previewed !== null}
          className={cn("flex flex-col gap-7", previewed && "hidden")}
        >
          <Alert title="Who receives it">
            Only customers who opted in to news, each in their own language. The
            preview shows the exact number before anything is sent.
          </Alert>

          <section className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-ink">Content</h2>
            <BilingualField
              form={form}
              name="subject"
              label="Subject"
              requiredEn
              maxLength={SUBJECT_MAX}
              hint="The subject line of the email, up to 160 characters."
            />
            <BilingualField
              form={form}
              name="message"
              label="Message"
              requiredEn
              multiline
              rows={7}
              maxLength={MESSAGE_MAX}
              hint="Up to 2,000 characters per language. Line breaks are kept."
            />
          </section>

          <section className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Button</h2>
              <p className="text-13 text-ink-muted">
                The email ends with one button. Without a link it leads to the
                product&apos;s page when a product is chosen, otherwise to the
                shop.
              </p>
            </div>
            <TextField
              form={form}
              name="link"
              label="Link"
              optional
              type="url"
              inputMode="url"
              maxLength={LINK_MAX}
              placeholder="https://"
              hint="A full address, beginning with https://"
            />
            <BilingualField
              form={form}
              name="linkLabel"
              label="Button label"
              maxLength={160}
              hint="Optional, at most 160 characters. Without a label the button says “Visit the shop” and “Zum Shop”."
            />
          </section>

          <section className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-ink">
                What it is about
              </h2>
              <p className="text-13 text-ink-muted">
                Optional, for the record: the announcement is then listed with
                the product or the cargo.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Product"
                optional
                hint={
                  can("catalog.read")
                    ? undefined
                    : "Your role does not include the catalogue: no product can be chosen."
                }
              >
                {can("catalog.read") ? (
                  <ProductPicker
                    value={product}
                    onChange={(next) => {
                      setProduct(next);
                      form.setValue("productId", next?.id ?? "", {
                        shouldDirty: true,
                      });
                    }}
                  />
                ) : null}
              </Field>
              {can("cargos.read") ? (
                <SelectField form={form} name="cargoId" label="Cargo" optional>
                  <option value="">No cargo</option>
                  {(cargos?.items ?? []).map((cargo) => (
                    <option key={cargo.id} value={cargo.id}>
                      {cargo.code} · {cargo.internalName} ·{" "}
                      {CARGO_STATUS[cargo.status]?.label ?? cargo.status}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <Field
                  label="Cargo"
                  optional
                  hint="Your role does not include cargos: no cargo can be chosen."
                >
                  {null}
                </Field>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-ink">Channels</h2>
            <CheckboxField
              form={form}
              name="email"
              label="Email"
              hint="To every customer who opted in to news."
            />
            <CheckboxField
              form={form}
              name="whatsapp"
              label="WhatsApp"
              disabled={whatsappEnabled !== true}
              hint="To the customers who opted in to news and also to WhatsApp."
            />
            {whatsappEnabled === false ? (
              <WhatsappState enabled={false}>
                News cannot go out by WhatsApp yet, so the choice is switched
                off. It opens by itself once WhatsApp is configured in the API.
              </WhatsappState>
            ) : null}
            {channelError ? (
              <p role="alert" className="text-13 text-danger-fg">
                {channelError}
              </p>
            ) : null}
          </section>

          <FormError state={state} />

          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              size="lg"
              disabled={pending}
              onClick={() => router.push(routes.announcements)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" loading={pending}>
              Preview
            </Button>
          </div>
        </form>

        {previewed ? (
          <section className="flex flex-col gap-5">
            <div>
              <h2
                ref={previewHeading}
                tabIndex={-1}
                className="scroll-mt-20 text-base font-semibold text-ink outline-none"
              >
                Preview: “{previewed.input.subject.en}”
              </h2>
              <p className="text-13 text-ink-muted">
                Nothing has been sent yet. Check who gets it and how it reads,
                then send it or go back and change it.
              </p>
            </div>

            {reached === 0 ? (
              <Alert tone="warning" title="No customer has asked for news yet">
                There is nobody to send this to: announcements only go to
                customers who opted in to news.
              </Alert>
            ) : null}

            <AnnouncementPreviewPanel
              input={previewed.input}
              preview={previewed.preview}
              about={{
                product:
                  product && previewed.input.productId === product.id
                    ? `${product.name} (${product.sku})`
                    : undefined,
                cargo: cargos?.items.find(
                  (cargo) => cargo.id === previewed.input.cargoId,
                )?.code,
              }}
            />

            <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="ghost"
                size="lg"
                onClick={() => setPreviewed(null)}
              >
                Back to editing
              </Button>
              <ActionButton
                permission="notifications.manage"
                variant="primary"
                size="lg"
                blocked={
                  reached === 0 ? "No customer has asked for news yet." : null
                }
                onClick={() => setConfirming(true)}
              >
                Send to {plural(reached, "customer")}
              </ActionButton>
            </div>

            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={`Send this announcement to ${plural(reached, "customer")}?`}
              description="One message per customer and channel is queued and goes out within a minute. What has gone out cannot be taken back; what still waits can be cancelled."
              facts={[
                { label: "Subject", value: previewed.input.subject.en },
                ...(previewed.preview.channels.includes("email")
                  ? [
                      {
                        label: "By email",
                        value: plural(
                          previewed.preview.recipients.email,
                          "customer",
                        ),
                        strong: true,
                      },
                    ]
                  : []),
                ...(previewed.preview.channels.includes("whatsapp")
                  ? [
                      {
                        label: "By WhatsApp",
                        value: plural(
                          previewed.preview.recipients.whatsapp,
                          "customer",
                        ),
                        strong: true,
                      },
                    ]
                  : []),
                {
                  label: "Messages in all",
                  value: messagesQueued(
                    previewed.preview.recipients,
                  ).toLocaleString("en"),
                },
              ]}
              confirmLabel={`Send to ${plural(reached, "customer")}`}
              cancelLabel="Not yet"
              onConfirm={async () => {
                const result = await send.mutateAsync(previewed.input);
                setSent(true);
                notify.success(
                  `The announcement goes out to ${plural(result.announcement.recipients, "customer")}`,
                  `${plural(result.announcement.queued, "message")} queued.`,
                );
                router.push(routes.announcement(result.announcement.id));
              }}
            />
          </section>
        ) : null}
      </PageBody>
    </RequirePermission>
  );
}
