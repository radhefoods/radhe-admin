"use client";

import { Plus, ScrollText, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { useWatch, type Control } from "react-hook-form";
import { z } from "zod";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime } from "@/components/domain/values";
import { BilingualField, UnsavedGuard } from "@/components/form/fields";
import {
  FormError,
  TextareaField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/controls";
import {
  Alert,
  Card,
  CardBody,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import type {
  LegalDocument,
  LegalDocumentSummary,
  Locale,
  UpdateLegalDocumentInput,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { LOCALE_LABEL } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { translatedDefaults } from "@/lib/validation";
import {
  CONTENT_MAX,
  LEGAL_TYPE,
  NOTE_MAX,
  TITLE_MAX,
  hasText,
  previousVersion,
  toContent,
  toTitle,
  versionName,
} from "./legal";
import { LegalCompare } from "./legal-compare";
import { MarkdownText } from "./markdown";
import { NewVersionDialog } from "./new-version-dialog";
import {
  useDeleteLegalDocument,
  useLegalDocument,
  useLegalDocuments,
  usePublishLegalDocument,
  useUpdateLegalDocument,
} from "./queries";

const atMost = (max: number) =>
  `At most ${max.toLocaleString("en")} characters.`;

// The rules of the API for a draft (documentation, 6).
export const draftSchema = z.object({
  title: z.object({
    en: z
      .string()
      .trim()
      .min(1, "The English title is required.")
      .max(TITLE_MAX, atMost(TITLE_MAX)),
    de: z.string().trim().max(TITLE_MAX, atMost(TITLE_MAX)),
  }),
  content: z.object({
    en: z.string().max(CONTENT_MAX, atMost(CONTENT_MAX)),
    de: z.string().max(CONTENT_MAX, atMost(CONTENT_MAX)),
  }),
  note: z.string().trim().max(NOTE_MAX, atMost(NOTE_MAX)),
});

export type DraftFormValues = z.input<typeof draftSchema>;

export function draftDefaults(document: LegalDocument): DraftFormValues {
  return {
    title: translatedDefaults(document.title),
    content: translatedDefaults(document.content),
    note: document.note ?? "",
  };
}

/** Only what changed. A language without text is left out of its field. */
export function toDraftPatch(
  values: DraftFormValues,
  document: LegalDocument,
): UpdateLegalDocumentInput {
  const before = draftDefaults(document);
  const patch: UpdateLegalDocumentInput = {};
  if (
    values.title.en !== before.title.en ||
    values.title.de !== before.title.de
  ) {
    patch.title = toTitle(values.title);
  }
  if (
    values.content.en !== before.content.en ||
    values.content.de !== before.content.de
  ) {
    patch.content = toContent(values.content);
  }
  if (values.note !== before.note && values.note !== "")
    patch.note = values.note;
  return patch;
}

const LANGUAGES: readonly Locale[] = ["en", "de"];

/** Both languages as customers read them, next to each other. */
function RenderedText({
  content,
}: {
  content: { en?: string | null; de?: string | null };
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {LANGUAGES.map((language) => {
        const text = content[language];
        return (
          <Card key={language} aria-label={`${LOCALE_LABEL[language]} text`}>
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 sm:px-5">
              <h3 className="text-13 font-semibold text-ink">
                {LOCALE_LABEL[language]}
              </h3>
              {hasText(text) ? null : <Badge tone="attention">Missing</Badge>}
            </div>
            <CardBody>
              {hasText(text) ? (
                <MarkdownText lang={language}>{text ?? ""}</MarkdownText>
              ) : (
                <p className="py-6 text-center text-13 text-ink-muted">
                  {language === "en"
                    ? "There is no English text. A version cannot be published without it."
                    : "There is no German text in this version."}
                </p>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function Frame({
  document,
  isCurrent,
  description,
  actions,
  children,
}: {
  document: LegalDocument;
  isCurrent: boolean;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        back={{ href: routes.legal, label: "Legal texts" }}
        title={versionName(document)}
        badges={
          <>
            <StatusBadge kind="legal" value={document.status} />
            {isCurrent ? (
              <Badge tone="planned" dot={false}>
                Current
              </Badge>
            ) : null}
          </>
        }
        description={description}
        actions={actions}
      />
      {children}
    </>
  );
}

// --- A draft: the editor -----------------------------------------------------

function LivePreview({ control }: { control: Control<DraftFormValues> }) {
  const content = useDeferredValue(useWatch({ control, name: "content" }));
  return <RenderedText content={content} />;
}

function LiveCompare({
  control,
  document,
  others,
  previous,
}: {
  control: Control<DraftFormValues>;
  document: LegalDocument;
  others: readonly LegalDocumentSummary[];
  previous: LegalDocumentSummary | null;
}) {
  const title = useDeferredValue(useWatch({ control, name: "title" }));
  const content = useDeferredValue(useWatch({ control, name: "content" }));
  return (
    <LegalCompare
      current={{
        type: document.type,
        version: document.version,
        status: document.status,
        title,
        content,
        live: true,
      }}
      others={others}
      defaultOtherId={previous?.id ?? null}
    />
  );
}

function DraftEditor({
  document,
  others,
  previous,
  onDone,
}: {
  document: LegalDocument;
  others: readonly LegalDocumentSummary[];
  previous: LegalDocumentSummary | null;
  /** The draft was published: the page shows it as it now is. */
  onDone: () => void;
}) {
  const router = useRouter();
  const update = useUpdateLegalDocument(document.id);
  const publish = usePublishLegalDocument(document.id);
  const remove = useDeleteLegalDocument();
  const form = useZodForm(draftSchema, {
    defaultValues: draftDefaults(document),
  });
  const [tab, setTab] = useState("write");
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const dirty = form.formState.isDirty;
  // Another admin published this version while it was open here.
  const publishedMeanwhile = document.status === "published";
  useEffect(() => {
    if (publishedMeanwhile && !dirty) onDone();
  }, [publishedMeanwhile, dirty, onDone]);

  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    setRefused(null);
    if (document.note && values.note === "") {
      form.setError(
        "note",
        {
          type: "server",
          message:
            "A note cannot be removed once it is saved: the API keeps it. Write a new note instead.",
        },
        { shouldFocus: true },
      );
      return;
    }
    const patch = toDraftPatch(values, document);
    if (Object.keys(patch).length === 0) {
      form.reset(values);
      return;
    }
    const saved = await update.mutateAsync(patch);
    form.reset(draftDefaults(saved));
    notify.success(
      "Draft saved",
      "Customers see nothing of it until it is published.",
    );
  });

  const type = LEGAL_TYPE[document.type];
  const germanMissing = !hasText(document.content.de);
  const publishBlocked = publishedMeanwhile
    ? "This version is published already."
    : dirty
      ? "Save your changes first."
      : !hasText(document.content.en)
        ? "The English text is needed to publish."
        : null;

  return (
    <Frame
      document={document}
      isCurrent={false}
      description="A draft. Customers do not see it, and it can change, until it is published."
      actions={
        <Button
          variant="danger-outline"
          icon={<Trash2 />}
          disabled={publishedMeanwhile}
          onClick={() => setDeleting(true)}
        >
          Delete the draft
        </Button>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          void onSubmit(event).then(() => {
            // A problem in the text is shown where the text is written.
            if (form.formState.errors.content) setTab("write");
          });
        }}
        className="flex flex-col"
      >
        <UnsavedGuard when={dirty} />
        <PageBody className="pb-6">
          {publishedMeanwhile && dirty ? (
            <Alert
              tone="danger"
              title="This version was published while you were editing"
            >
              A published version can never change, so what you typed cannot be
              saved here. Copy what you still need, then start a new version
              from the list of legal texts.
            </Alert>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <BilingualField
              form={form}
              name="title"
              label="Title"
              hint="The heading customers see above the text."
              requiredEn
              maxLength={TITLE_MAX}
            />
            <TextareaField
              form={form}
              name="note"
              label="Note for the team"
              hint="What changed in this version. Customers never see it."
              optional
              rows={1}
              maxLength={NOTE_MAX}
              className="min-h-[34px]"
            />
          </div>

          <Tabs
            value={tab}
            onValueChange={setTab}
            className="flex flex-col gap-4"
          >
            <TabsList>
              <TabsTrigger value="write">Write</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="changes">
                {previous
                  ? `Changes since version ${previous.version}`
                  : "Changes"}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="write">
              <BilingualField
                form={form}
                name="content"
                label="Text"
                hint="Markdown: # for headings, **bold**, lists with -, [links](https://…), tables. HTML is not shown. English is needed to publish; German can follow."
                multiline
                mono
                rows={24}
                maxLength={CONTENT_MAX}
              />
            </TabsContent>
            <TabsContent value="preview">
              <LivePreview control={form.control} />
            </TabsContent>
            <TabsContent value="changes">
              <LiveCompare
                control={form.control}
                document={document}
                others={others}
                previous={previous}
              />
            </TabsContent>
          </Tabs>

          <FormError state={state} />
          {refused ? (
            <Alert tone="danger" title="This version cannot be published yet">
              {refused}
            </Alert>
          ) : null}
        </PageBody>

        <div
          className={cn(
            gutter,
            "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-surface/95 py-3 backdrop-blur-sm",
          )}
        >
          <p className="text-13 text-ink-muted" aria-live="polite">
            {dirty
              ? "Changes are not saved yet."
              : `Saved ${formatDateTime(document.updatedAt)}.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant={dirty ? "primary" : "secondary"}
              size="lg"
              loading={pending}
              disabled={!dirty || publishedMeanwhile}
            >
              Save the draft
            </Button>
            <ActionButton
              permission="legal.manage"
              variant={dirty ? "secondary" : "primary"}
              size="lg"
              blocked={publishBlocked}
              onClick={() => {
                setRefused(null);
                setPublishing(true);
              }}
            >
              Publish
            </ActionButton>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={publishing}
        onOpenChange={setPublishing}
        title={`Publish version ${document.version} of the ${type.short}?`}
        description="Customers accept this version from now on, with their next order. A published version can never change: a correction is a new version."
        facts={[
          { label: "Text", value: type.label },
          { label: "Version", value: document.version },
          {
            label: "Replaces",
            value: previous
              ? `Version ${previous.version}${
                  previous.publishedAt
                    ? `, published ${formatDate(previous.publishedAt)}`
                    : ""
                }`
              : "Nothing: the first version",
          },
          {
            label: "Languages",
            value: germanMissing
              ? "English only: German is missing"
              : "English and German",
          },
        ]}
        confirmLabel={`Publish version ${document.version}`}
        onConfirm={async () => {
          try {
            await publish.mutateAsync();
          } catch (error) {
            if (!hasErrorCode(error, "VALIDATION_FAILED")) throw error;
            // The only rule of publishing: the English text must be there.
            setTab("write");
            setRefused(
              "A legal text needs its English text before it is published. Write it, save the draft and publish again.",
            );
            form.setError("content.en", {
              type: "server",
              message: "The English text is needed to publish.",
            });
            return;
          }
          notify.success(
            `Version ${document.version} of the ${type.short} is published`,
            "Customers accept it from now on.",
          );
          onDone();
        }}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the draft of version ${document.version}?`}
        description={`The draft of the ${type.short} is removed for good, with everything written in it. Published versions are not touched.`}
        confirmLabel="Delete the draft"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync(document.id);
          notify.success(`Draft of version ${document.version} deleted`);
          router.replace(routes.legal);
        }}
      />
    </Frame>
  );
}

// --- A published version, or a draft without the right to change it ---------

function ReadOnlyDocument({
  document,
  isCurrent,
  versions,
  others,
  previous,
}: {
  document: LegalDocument;
  isCurrent: boolean;
  /** Every version of the type, newest first. */
  versions: readonly LegalDocumentSummary[];
  others: readonly LegalDocumentSummary[];
  previous: LegalDocumentSummary | null;
}) {
  const [starting, setStarting] = useState(false);
  const published = document.status === "published";

  return (
    <Frame
      document={document}
      isCurrent={isCurrent}
      description={
        published
          ? isCurrent
            ? "Customers accept this version at checkout. A published version can never change: a correction is a new version."
            : "An earlier version: orders placed while it was current refer to it. It can never change."
          : "A draft. Customers do not see it until it is published."
      }
      actions={
        <ActionButton
          permission="legal.manage"
          variant={published ? "primary" : "secondary"}
          icon={<Plus />}
          onClick={() => setStarting(true)}
        >
          New version
        </ActionButton>
      }
    >
      <PageBody>
        <Card>
          <CardBody>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Title, English">{document.title.en}</Fact>
              <Fact label="Title, German">
                {document.title.de ? (
                  <span lang="de">{document.title.de}</span>
                ) : (
                  <Badge tone="attention">Missing</Badge>
                )}
              </Fact>
              <Fact label={published ? "Published" : "Created"}>
                <DateTime
                  value={published ? document.publishedAt : document.createdAt}
                />
              </Fact>
              <Fact label="Last change">
                <DateTime value={document.updatedAt} />
              </Fact>
              <Fact
                label="Note for the team"
                className="sm:col-span-2 lg:col-span-4"
              >
                {document.note ? (
                  <span className="whitespace-pre-line">{document.note}</span>
                ) : (
                  <span className="text-ink-subtle">No note</span>
                )}
              </Fact>
            </dl>
          </CardBody>
        </Card>

        <Tabs defaultValue="text" className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="changes">
              {previous
                ? `Changes since version ${previous.version}`
                : "Changes"}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="text">
            <RenderedText content={document.content} />
          </TabsContent>
          <TabsContent value="changes">
            <LegalCompare
              current={{
                type: document.type,
                version: document.version,
                status: document.status,
                publishedAt: document.publishedAt,
                title: document.title,
                content: document.content,
              }}
              others={others}
              defaultOtherId={previous?.id ?? null}
            />
          </TabsContent>
        </Tabs>
      </PageBody>

      <NewVersionDialog
        type={document.type}
        versions={versions}
        open={starting}
        onOpenChange={setStarting}
      />
    </Frame>
  );
}

function Loaded({
  document,
  items,
}: {
  document: LegalDocument;
  items: readonly LegalDocumentSummary[];
}) {
  const can = useCan();
  // A draft opens as an editor and stays one until this admin publishes it
  // or leaves: what was typed is never thrown away by a refresh.
  const [editing, setEditing] = useState(
    document.status === "draft" && can("legal.manage"),
  );
  const versions = items
    .filter((item) => item.type === document.type)
    .sort((a, b) => b.version - a.version);
  const others = versions.filter((item) => item.id !== document.id);
  const previous = previousVersion(items, document);
  const isCurrent =
    items.find((item) => item.id === document.id)?.isCurrent ?? false;

  return editing ? (
    <DraftEditor
      document={document}
      others={others}
      previous={previous}
      onDone={() => setEditing(false)}
    />
  ) : (
    <ReadOnlyDocument
      document={document}
      isCurrent={isCurrent}
      versions={versions}
      others={others}
      previous={previous}
    />
  );
}

/** One version of a legal text: the editor of a draft, or the published text. */
export function LegalDocumentView() {
  const { id } = useParams<{ id: string }>();
  const document = useLegalDocument(id);
  const list = useLegalDocuments();
  const back = { href: routes.legal, label: "Legal texts" };

  if (document.isError && !document.isFetching) {
    const gone = hasErrorCode(
      document.error,
      "LEGAL_DOCUMENT_NOT_FOUND",
      "VALIDATION_FAILED",
    );
    if (gone || !document.data) {
      return (
        <RequirePermission permission="legal.read">
          <PageHeader title="Legal text" back={back} />
          <div className={gutter}>
            {gone ? (
              <div className="rounded-lg border border-line">
                <EmptyState
                  icon={<ScrollText />}
                  title="This legal text does not exist"
                >
                  It may have been a draft that was deleted.
                </EmptyState>
              </div>
            ) : (
              <Alert
                tone="danger"
                title="The legal text could not be loaded"
                actions={
                  <Button onClick={() => void document.refetch()}>
                    Try again
                  </Button>
                }
              >
                {errorMessage(document.error)}
              </Alert>
            )}
          </div>
        </RequirePermission>
      );
    }
  }

  if (!document.data) {
    return (
      <RequirePermission permission="legal.read">
        <PageHeader title={<Skeleton className="h-9 w-72" />} back={back} />
        <div className={cn(gutter, "flex flex-col gap-4")} aria-busy="true">
          <span className="sr-only" role="status">
            Loading the legal text
          </span>
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </RequirePermission>
    );
  }

  return (
    <RequirePermission permission="legal.read">
      <Loaded
        key={document.data.id}
        document={document.data}
        items={list.data?.items ?? []}
      />
    </RequirePermission>
  );
}
