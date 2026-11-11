"use client";

import { Undo2 } from "lucide-react";
import { useWatch } from "react-hook-form";
import { ActionButton } from "@/components/domain/permission";
import { BilingualField } from "@/components/form/fields";
import { FormError, useSubmit, useZodForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import { hasErrorCode } from "@/lib/api/errors";
import type { LegalPage, Locale } from "@/lib/api/types";
import { LOCALE_LABEL } from "@/lib/format/names";
import {
  EMPTY_PAGE,
  LEGAL_TYPE,
  PAGE_RULES,
  legalPageUrl,
  pageDefaults,
  pageSchema,
  samePage,
  toPageInput,
  type PageFormValues,
} from "./legal";
import { useSetLegalPage } from "./queries";

const LANGUAGES: readonly Locale[] = ["en", "de"];
const FIELDS = ["slug", "seoTitle", "seoDescription"] as const;

function PageSettingsForm({
  page,
  onClose,
}: {
  page: LegalPage;
  onClose: () => void;
}) {
  const meta = LEGAL_TYPE[page.type];
  const save = useSetLegalPage(page.type);
  const before = pageDefaults(page);
  const form = useZodForm(pageSchema, { defaultValues: before });
  const typed = useWatch({ control: form.control }) as PageFormValues;
  // The title the shop takes while the page has none of its own.
  const title = (page.current ?? page.draft)?.title;

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: PageFormValues) => {
      if (samePage(values, before)) {
        notify.info("Nothing changed");
        onClose();
        return;
      }
      try {
        // The call replaces the whole page: everything it keeps is sent.
        await save.mutateAsync(toPageInput(values));
      } catch (error) {
        if (!hasErrorCode(error, "LEGAL_SLUG_TAKEN")) throw error;
        const taken = error.details;
        const owner = taken?.type
          ? (LEGAL_TYPE[taken.type]?.label ?? taken.type)
          : null;
        // The address that was refused is the typed one, or the default
        // an empty field stands for.
        const refused = LANGUAGES.filter(
          (locale) =>
            (values.slug[locale] || page.defaultSlug[locale]) === taken?.slug,
        );
        const marked = refused.length > 0 ? refused : LANGUAGES.slice(0, 1);
        for (const locale of marked) {
          form.setError(
            `slug.${locale}`,
            {
              type: "server",
              message: owner
                ? `This address belongs to the page ${owner}.`
                : "This address belongs to another legal page.",
            },
            { shouldFocus: locale === marked[0] },
          );
        }
        return;
      }
      notify.success(
        `Page of the ${meta.short} saved`,
        "The shop uses the address and the texts at once.",
      );
      onClose();
    },
    {
      aliases: { "seo.title": "seoTitle", "seo.description": "seoDescription" },
    },
  );

  const own = !samePage(typed, EMPTY_PAGE);

  return (
    <form
      onSubmit={(event) => {
        event.stopPropagation();
        void onSubmit(event);
      }}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogBody>
        <BilingualField
          form={form}
          name="slug"
          label="Address"
          maxLength={PAGE_RULES.slugMaxLength}
          placeholder={page.defaultSlug}
          hint="The last part of the page's link. Lower-case letters, digits and single hyphens. Left empty, the page has its default address."
        />
        <dl
          aria-label="Links of the page"
          className="glass-inset flex flex-col gap-1.5 rounded-lg px-3 py-2.5"
        >
          {LANGUAGES.map((locale) => (
            <div key={locale} className="flex flex-wrap gap-x-2 text-13">
              <dt className="text-ink-subtle">{LOCALE_LABEL[locale]} link</dt>
              <dd className="min-w-0 font-mono break-all text-ink">
                {legalPageUrl(
                  locale,
                  typed.slug?.[locale]?.trim() || page.defaultSlug[locale],
                )}
              </dd>
            </div>
          ))}
        </dl>
        <BilingualField
          form={form}
          name="seoTitle"
          label="Title for search engines"
          maxLength={PAGE_RULES.seoMaxLength}
          placeholder={
            title ? { en: title.en, de: title.de ?? title.en } : undefined
          }
          hint="Left empty, the shop uses the title of the text."
        />
        <BilingualField
          form={form}
          name="seoDescription"
          label="Description for search engines"
          multiline
          rows={2}
          maxLength={PAGE_RULES.seoMaxLength}
          hint="Left empty, the page has no description of its own."
        />
        <p className="text-13 text-ink-muted">
          Changing the address changes the link of the page at once. Links to
          the old address stop working.
        </p>
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        {own ? (
          <Button
            variant="ghost"
            size="lg"
            className="mr-auto"
            disabled={pending}
            onClick={() => {
              for (const field of FIELDS) {
                for (const locale of LANGUAGES) {
                  form.setValue(`${field}.${locale}`, "", {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }
              }
            }}
          >
            <Undo2 />
            Back to the defaults
          </Button>
        ) : null}
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <ActionButton
          permission="legal.manage"
          type="submit"
          variant="primary"
          size="lg"
          loading={pending}
        >
          Save the page
        </ActionButton>
      </DialogFooter>
    </form>
  );
}

/**
 * The page of one legal text in the shop: its address per language and what
 * search engines read about it. These belong to the page, not to a version:
 * saving applies at once and creates no version.
 */
export function PageSettingsDialog({
  page,
  open,
  onOpenChange,
}: {
  page: LegalPage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {page ? (
          <>
            <DialogHeader
              title={`Page settings: ${LEGAL_TYPE[page.type].label}`}
              description="The address of the page in the shop and what search engines read about it. This is no version of the text: it applies at once, to whatever version is shown."
            />
            <PageSettingsForm
              key={page.type}
              page={page}
              onClose={() => onOpenChange(false)}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
