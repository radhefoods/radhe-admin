"use client";

import { useEffect, useState } from "react";
import { useWatch } from "react-hook-form";
import { ActionButton } from "@/components/domain/permission";
import { SwitchField } from "@/components/form/fields";
import {
  FormError,
  SelectField,
  TextField,
  TextareaField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { notify } from "@/components/ui/toast";
import {
  FAQ_RULES,
  type Faq,
  type FaqGroup,
  type Locale,
} from "@/lib/api/types";
import { LOCALE_LABEL, translated } from "@/lib/format/names";
import { MarkdownText } from "@/features/legal/markdown";
import {
  faqDefaults,
  faqSchema,
  toFaqInput,
  toFaqPatch,
  type FaqFormOutput,
  type FaqFormValues,
} from "./faq-schema";
import { useCreateFaq, useUpdateFaq } from "./queries";

export type FaqEdit =
  { mode: "new"; groupId: string | null } | { mode: "edit"; faq: Faq };

const LANGUAGES: readonly Locale[] = ["en", "de"];

/** The question and the answer as the shop renders them, in one language. */
function Preview({
  locale,
  form,
}: {
  locale: Locale;
  form: ReturnType<typeof useZodForm<typeof faqSchema>>;
}) {
  const question = useWatch({
    control: form.control,
    name: `question.${locale}`,
  });
  const answer = useWatch({ control: form.control, name: `answer.${locale}` });
  const empty = !question?.trim() && !answer?.trim();
  return (
    <section
      aria-label={`${LOCALE_LABEL[locale]} preview`}
      className="flex flex-col gap-2 rounded-lg border border-line p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-13 font-semibold text-ink-muted">
          {LOCALE_LABEL[locale]}
        </h3>
        {empty ? <Badge tone="attention">Missing</Badge> : null}
      </div>
      {empty ? (
        <p className="text-13 text-ink-subtle">
          {locale === "en"
            ? "Nothing written yet. English is required."
            : "Nothing written yet. The shop shows the English text until the German one is filled in."}
        </p>
      ) : (
        <>
          <p lang={locale} className="text-sm font-semibold text-ink">
            {question}
          </p>
          <MarkdownText lang={locale}>{answer ?? ""}</MarkdownText>
        </>
      )}
    </section>
  );
}

function FaqForm({
  edit,
  groups,
  onClose,
  onDirty,
}: {
  edit: FaqEdit;
  groups: FaqGroup[];
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const create = useCreateFaq();
  const update = useUpdateFaq();
  const faq = edit.mode === "edit" ? edit.faq : undefined;
  const form = useZodForm(faqSchema, {
    defaultValues: faqDefaults(faq, edit.mode === "new" ? edit.groupId : null),
  });
  const [tab, setTab] = useState<string>("en");
  const dirty = form.formState.isDirty;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: FaqFormOutput) => {
      if (faq) {
        const patch = toFaqPatch(values, faq);
        if (Object.keys(patch).length === 0) {
          notify.info("Nothing changed");
          onClose();
          return;
        }
        const saved = await update.mutateAsync({ id: faq.id, ...patch });
        notify.success(
          "Question saved",
          saved.isPublished
            ? "The shop shows it within five minutes."
            : "It is not published: the shop does not show it.",
        );
      } else {
        const saved = await create.mutateAsync(toFaqInput(values));
        notify.success(
          "Question created",
          saved.isPublished
            ? `It stands last in ${saved.group ? translated(saved.group.name) : "the questions without a group"} and the shop shows it within five minutes.`
            : `It stands last in ${saved.group ? translated(saved.group.name) : "the questions without a group"}, not published yet.`,
        );
      }
      onClose();
    },
  );

  /** A problem in a language is shown where that language is written. */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const valid = await form.trigger();
    if (!valid) {
      // The rendered form state lags behind here; the field states are current.
      const wrong = (name: `question.${Locale}` | `answer.${Locale}`) =>
        form.getFieldState(name).error !== undefined;
      if (wrong("question.en") || wrong("answer.en")) setTab("en");
      else if (wrong("question.de") || wrong("answer.de")) setTab("de");
      return;
    }
    await onSubmit();
  }

  const published = form.watch("isPublished");

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader
        title={faq ? "Question" : "New question"}
        description="In English and German. The answer is plain text or Markdown: **bold**, lists with -, [links](https://…). English is required; the shop shows it until the German text is filled in."
      />
      <DialogBody>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex flex-col gap-4"
        >
          <TabsList>
            {LANGUAGES.map((locale) => (
              <TabsTrigger key={locale} value={locale}>
                {LOCALE_LABEL[locale]}
                {locale === "en" ? (
                  <span aria-hidden="true" className="text-danger-fg">
                    *
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          {LANGUAGES.map((locale) => (
            <TabsContent
              key={locale}
              value={locale}
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <div lang={locale} className="flex flex-col gap-4">
                <TextField
                  form={form}
                  name={`question.${locale}` as keyof FaqFormValues & string}
                  label={`Question, ${LOCALE_LABEL[locale]}`}
                  required={locale === "en"}
                  optional={locale === "de"}
                  maxLength={FAQ_RULES.questionMaxLength}
                  autoComplete="off"
                />
                <TextareaField
                  form={form}
                  name={`answer.${locale}` as keyof FaqFormValues & string}
                  label={`Answer, ${LOCALE_LABEL[locale]}`}
                  required={locale === "en"}
                  optional={locale === "de"}
                  rows={10}
                  maxLength={FAQ_RULES.answerMaxLength}
                  className="font-mono text-13"
                  hint="Markdown is rendered by the shop; HTML is not shown."
                />
              </div>
            </TabsContent>
          ))}
          <TabsContent value="preview">
            <div className="grid gap-3 md:grid-cols-2">
              {LANGUAGES.map((locale) => (
                <Preview key={locale} locale={locale} form={form} />
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField form={form} name="groupId" label="Group">
            <option value="">No group (shown after the groups)</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {translated(group.name)}
                {group.isVisible ? "" : " (hidden)"}
              </option>
            ))}
          </SelectField>
          <SwitchField
            form={form}
            name="isPublished"
            label={published ? "Published" : "Not published"}
            hint="A published question appears in the shop within five minutes, when its group is shown."
            className="sm:pt-6"
          />
        </div>
        {faq && faq.groupId !== (form.watch("groupId") || null) ? (
          <p className="text-13 text-ink-muted">
            A moved question goes last in its new group.
          </p>
        ) : null}
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <ActionButton
          type="submit"
          permission="content.manage"
          variant="primary"
          size="lg"
          loading={pending}
        >
          {faq ? "Save changes" : "Create question"}
        </ActionButton>
      </DialogFooter>
    </form>
  );
}

/** Writing or changing a question of the FAQ, in two languages. */
export function FaqDialog({
  edit,
  groups,
  onClose,
}: {
  /** `null` closes the dialog. */
  edit: FaqEdit | null;
  groups: FaqGroup[];
  onClose: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  // The form stays while the dialog fades out.
  const [shown, setShown] = useState<FaqEdit | null>(edit);
  if (edit && edit !== shown) setShown(edit);
  return (
    <Dialog
      open={edit !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        onInteractOutside={(event) => {
          // What was typed is not lost to a click next to the dialog.
          if (dirty) event.preventDefault();
        }}
      >
        {shown ? (
          <FaqForm
            key={
              shown.mode === "edit"
                ? shown.faq.id
                : `new-${shown.groupId ?? ""}`
            }
            edit={shown}
            groups={groups}
            onClose={onClose}
            onDirty={setDirty}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
