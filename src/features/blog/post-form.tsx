"use client";

import { CalendarClock, Send, Undo2 } from "lucide-react";
import { useState, type MutableRefObject, type ReactNode } from "react";
import { ActionButton } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { DateTime } from "@/components/domain/values";
import { BilingualField, UnsavedGuard } from "@/components/form/fields";
import {
  FormError,
  SelectField,
  TextField,
  TextareaField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  RadioGroup,
  RadioItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import {
  BLOG_RULES,
  type BlogCategory,
  type BlogPost,
  type BlogPostInput,
  type Locale,
} from "@/lib/api/types";
import { useAdmin, useCan } from "@/lib/auth/auth-provider";
import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/cn";
import { berlinToIso, formatDateTime, toLocalInput } from "@/lib/format/dates";
import { LOCALE_LABEL, plural, translated } from "@/lib/format/names";
import { TagListField } from "@/features/catalogue/tag-list-field";
import type { SizeReader } from "@/features/catalogue/image-rules";
import { MarkdownEditor, type Inserter } from "./markdown-editor";
import { FeaturedPicture, TextPictures } from "./post-pictures";
import {
  normalizeTag,
  postDefaults,
  postSchema,
  toPostInput,
  toPostPatch,
  type PostFormOutput,
  type PostFormValues,
} from "./post-schema";
import {
  usePublishBlogPost,
  useUnpublishBlogPost,
  useUpdateBlogPost,
} from "./queries";

const LANGUAGES: readonly Locale[] = ["en", "de"];

type Path = keyof PostFormValues & string;
const path = (field: string, locale: Locale) => `${field}.${locale}` as Path;

/** How the shop will show the post, in a sentence. */
export function visibilityText(post: BlogPost): string {
  switch (post.visibility) {
    case "published":
      return `Published since ${formatDateTime(post.publishedAt)}: the shop shows it.`;
    case "scheduled":
      return `Scheduled for ${formatDateTime(post.publishedAt)} German time: the shop shows it from then on.`;
    default:
      return post.publishedAt
        ? `A draft, taken offline. Its date, ${formatDateTime(post.publishedAt)}, is kept for the next publication.`
        : "A draft: only the panel sees it.";
  }
}

/**
 * Publishing: now, or on a date. A date in the future schedules the post;
 * a past date publishes it at once, dated then.
 */
function PublishDialog({
  post,
  open,
  onOpenChange,
  onRefused,
}: {
  post: BlogPost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The API refused: the English text is missing. */
  onRefused: () => void;
}) {
  const publish = usePublishBlogPost(post.id);
  const now = useNow().getTime();
  const [when, setWhen] = useState<"now" | "date">(
    post.visibility === "scheduled" ? "date" : "now",
  );
  const [date, setDate] = useState(
    post.publishedAt && Date.parse(post.publishedAt) > now
      ? toLocalInput(post.publishedAt)
      : "",
  );
  const instant = when === "now" ? null : berlinToIso(date);
  const scheduled = instant !== null && Date.parse(instant) > now;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        post.status === "published" ? "Change the date" : "Publish this post?"
      }
      description="A published post appears in the shop from its date on, within five minutes. A future date schedules it."
      facts={[
        { label: "Post", value: translated(post.title) },
        {
          label: "Languages",
          value: post.content.de?.trim()
            ? "English and German"
            : "English only",
        },
      ]}
      confirmLabel={
        when === "date" && scheduled
          ? "Schedule"
          : post.status === "published"
            ? "Save the date"
            : "Publish now"
      }
      canConfirm={when === "now" || instant !== null}
      onConfirm={async () => {
        try {
          const saved = await publish.mutateAsync(
            when === "now"
              ? { publishedAt: new Date().toISOString() }
              : { publishedAt: instant as string },
          );
          notify.success(
            saved.visibility === "scheduled"
              ? `Scheduled for ${formatDateTime(saved.publishedAt)}`
              : "Post published",
            saved.visibility === "scheduled"
              ? "The shop shows it from then on."
              : "The shop shows it within five minutes.",
          );
        } catch (error) {
          if (!hasErrorCode(error, "BLOG_POST_INCOMPLETE")) throw error;
          onRefused();
        }
      }}
    >
      <RadioGroup
        value={when}
        onValueChange={(value) => setWhen(value as "now" | "date")}
        aria-label="Date of the article"
      >
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <RadioItem value="now" className="mt-0.5" />
          <span>
            <span className="font-medium">Now</span>
            <span className="block text-13 text-ink-muted">
              The article is dated this moment.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <RadioItem value="date" className="mt-0.5" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="font-medium">On a date</span>
            <span className="block text-13 text-ink-muted">
              German time. A future date schedules the post; a past date
              publishes it at once with that date.
            </span>
            <Input
              type="datetime-local"
              aria-label="Date and time of the article"
              value={date}
              disabled={when !== "date"}
              onChange={(event) => setDate(event.target.value)}
              className="tabular"
            />
          </span>
        </label>
      </RadioGroup>
    </ConfirmDialog>
  );
}

/** The status of the post and the buttons that change it. */
function Publishing({
  post,
  dirty,
  onRefused,
}: {
  post: BlogPost;
  dirty: boolean;
  onRefused: () => void;
}) {
  const unpublish = useUnpublishBlogPost(post.id);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const blocked = dirty
    ? "Save your changes first."
    : !post.content.en?.trim()
      ? "The English text is needed to publish."
      : null;
  return (
    <Card aria-label="Publishing">
      <CardHeader
        title="Publishing"
        actions={<StatusBadge kind="blogPost" value={post.visibility} />}
      />
      <CardBody className="flex flex-col gap-3">
        <p className="text-13 text-ink-muted">{visibilityText(post)}</p>
        <div className="flex flex-wrap gap-2">
          {post.status === "published" ? (
            <>
              <ActionButton
                permission="content.manage"
                size="sm"
                icon={<CalendarClock />}
                blocked={blocked}
                onClick={() => setPublishing(true)}
              >
                Change the date
              </ActionButton>
              <ActionButton
                permission="content.manage"
                size="sm"
                variant="danger-outline"
                icon={<Undo2 />}
                blocked={dirty ? "Save your changes first." : null}
                onClick={() => setUnpublishing(true)}
              >
                Unpublish
              </ActionButton>
            </>
          ) : (
            <ActionButton
              permission="content.manage"
              variant="primary"
              size="sm"
              icon={<Send />}
              blocked={blocked}
              onClick={() => setPublishing(true)}
            >
              Publish
            </ActionButton>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-13">
          <div>
            <dt className="text-ink-subtle">Author</dt>
            <dd className="text-ink">{post.authorName}</dd>
          </div>
          <div>
            <dt className="text-ink-subtle">Reading time</dt>
            <dd className="text-ink">
              {post.readingMinutes > 0
                ? plural(post.readingMinutes, "minute")
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-subtle">Created</dt>
            <dd className="text-ink">
              <DateTime value={post.createdAt} short />
            </dd>
          </div>
          <div>
            <dt className="text-ink-subtle">Last change</dt>
            <dd className="text-ink">
              <DateTime value={post.updatedAt} short />
            </dd>
          </div>
        </dl>
      </CardBody>
      {publishing ? (
        <PublishDialog
          post={post}
          open={publishing}
          onOpenChange={setPublishing}
          onRefused={() => {
            setPublishing(false);
            onRefused();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={unpublishing}
        onOpenChange={setUnpublishing}
        title="Take this post offline?"
        description="It becomes a draft again. The text, the pictures and the date are kept; the shop stops showing it within five minutes."
        confirmLabel="Unpublish"
        cancelLabel="Keep it online"
        tone="danger"
        onConfirm={async () => {
          await unpublish.mutateAsync();
          notify.success("Post taken offline", "It is a draft again.");
        }}
      />
    </Card>
  );
}

/**
 * The form of a post (23), for a new one and an existing one: the texts in
 * two language tabs, with the Markdown editor and its preview; the
 * publishing, the organisation, the SEO fields and the pictures in the
 * side column. Only what changed is saved.
 */
export function PostForm({
  post,
  categories,
  onCreate,
  onCancel,
  readSize,
}: {
  /** Set when an existing post is changed. */
  post?: BlogPost;
  categories: BlogCategory[];
  onCreate?: (input: BlogPostInput) => Promise<unknown>;
  onCancel?: () => void;
  /** How the size of a picture is read; tests have no decoder. */
  readSize?: SizeReader;
}) {
  const admin = useAdmin();
  const manage = useCan()("content.manage");
  const update = useUpdateBlogPost(post?.id ?? "");
  const form = useZodForm(postSchema, {
    defaultValues: postDefaults(post, admin.name),
  });
  const [tab, setTab] = useState<Locale>("en");
  const [refused, setRefused] = useState<string | null>(null);
  // One inserter per language, filled in by the editors once they are mounted.
  const [inserters] = useState<
    Record<Locale, MutableRefObject<Inserter | null>>
  >(() => ({ en: { current: null }, de: { current: null } }));
  const dirty = form.formState.isDirty;

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: PostFormOutput) => {
      setRefused(null);
      try {
        if (post) {
          const patch = toPostPatch(values, post);
          if (Object.keys(patch).length === 0) {
            form.reset(form.getValues());
            notify.info("Nothing changed");
            return;
          }
          const saved = await update.mutateAsync(patch);
          form.reset(postDefaults(saved));
          notify.success(
            "Post saved",
            saved.visibility === "published"
              ? "The shop shows the change within five minutes."
              : undefined,
          );
        } else {
          await onCreate?.(toPostInput(values));
        }
      } catch (error) {
        // A taken address belongs to the slug field of the language that was typed.
        if (hasErrorCode(error, "BLOG_POST_SLUG_TAKEN")) {
          // The slugs that were typed here: for an existing post, the ones
          // that differ from what it has.
          const typed = LANGUAGES.filter(
            (locale) =>
              values.slug[locale] !== "" &&
              values.slug[locale] !== post?.slug[locale],
          );
          const first = typed[0] ?? "en";
          for (const locale of typed.length > 0 ? typed : ["en" as const]) {
            form.setError(
              path("slug", locale),
              { type: "server", message: errorMessage(error) },
              { shouldFocus: locale === first },
            );
          }
          setTab(first);
          return;
        }
        if (hasErrorCode(error, "BLOG_CATEGORY_NOT_FOUND")) {
          form.setError("categoryId", {
            type: "server",
            message: errorMessage(error),
          });
          return;
        }
        throw error;
      }
    },
    {
      aliases: { "seo.title": "seoTitle", "seo.description": "seoDescription" },
    },
  );

  /** A problem in a language is shown where that language is written. */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const valid = await form.trigger();
    if (!valid) {
      const wrong = (locale: Locale) =>
        [
          "title",
          "slug",
          "summary",
          "content",
          "seoTitle",
          "seoDescription",
        ].some(
          (field) =>
            form.getFieldState(path(field, locale)).error !== undefined,
        );
      if (wrong("en")) setTab("en");
      else if (wrong("de")) setTab("de");
      return;
    }
    await onSubmit();
  }

  function insert(markdown: string): void {
    inserters[tab].current?.(markdown);
  }

  const readOnly = !manage;
  const sidebar: ReactNode = (
    <div className="flex flex-col gap-5">
      {post ? (
        <Publishing
          post={post}
          dirty={dirty}
          onRefused={() => {
            setTab("en");
            setRefused(
              "The post needs its English text before it is published. Write it, save the post and publish again.",
            );
            form.setError(path("content", "en"), {
              type: "server",
              message: "The English text is needed to publish.",
            });
          }}
        />
      ) : (
        <Alert tone="info" title="Save the post first">
          A new post starts as a draft. Once it is saved, it can be published or
          scheduled, and given its featured picture and pictures for the text.
        </Alert>
      )}

      <Card aria-label="Organisation">
        <CardHeader title="Organisation" />
        <CardBody className="flex flex-col gap-4">
          <SelectField
            form={form}
            name="categoryId"
            label="Category"
            hint="One category of the blog, or none."
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {translated(category.name)}
              </option>
            ))}
          </SelectField>
          <TagListField
            form={form}
            name="tags"
            label="Tags"
            noun="tag"
            max={BLOG_RULES.maxTags}
            placeholder="recipes, lentils"
            normalize={normalizeTag}
            accepts={(entry) => entry.length <= BLOG_RULES.tagMaxLength}
            hint="Lower-case words, the same in both languages. Enter or a comma adds one."
            disabled={readOnly}
          />
          <TextField
            form={form}
            name="authorName"
            label="Author"
            maxLength={BLOG_RULES.authorMaxLength}
            hint="Printed under the title."
          />
        </CardBody>
      </Card>

      <Card aria-label="Search engines">
        <CardHeader
          title="Search engines"
          description="The shop falls back to the title and the summary."
        />
        <CardBody className="flex flex-col gap-4">
          <BilingualField
            form={form}
            name="seoTitle"
            label="SEO title"
            maxLength={BLOG_RULES.seoTitleMaxLength}
          />
          <BilingualField
            form={form}
            name="seoDescription"
            label="SEO description"
            multiline
            rows={2}
            maxLength={BLOG_RULES.seoDescriptionMaxLength}
          />
        </CardBody>
      </Card>

      {post ? (
        <>
          <FeaturedPicture
            post={post}
            disabled={readOnly}
            readSize={readSize}
          />
          <TextPictures
            post={post}
            disabled={readOnly}
            onInsert={insert}
            readSize={readSize}
          />
        </>
      ) : null}
    </div>
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex flex-col"
    >
      <UnsavedGuard when={dirty} />
      <div className={cn(gutter, "flex flex-col gap-5 pb-6")}>
        {refused ? (
          <Alert tone="danger" title="This post cannot be published yet">
            {refused}
          </Alert>
        ) : null}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <fieldset disabled={readOnly} className="min-w-0">
            <legend className="sr-only">Text</legend>
            <Card aria-label="Text">
              <CardBody>
                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as Locale)}
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
                          name={path("title", locale)}
                          label={`Title, ${LOCALE_LABEL[locale]}`}
                          required={locale === "en"}
                          optional={locale === "de"}
                          maxLength={BLOG_RULES.titleMaxLength}
                          autoComplete="off"
                        />
                        <TextField
                          form={form}
                          name={path("slug", locale)}
                          label={`Address (slug), ${LOCALE_LABEL[locale]}`}
                          optional
                          placeholder={
                            post ? undefined : "Generated from the title"
                          }
                          maxLength={BLOG_RULES.slugMaxLength}
                          autoComplete="off"
                          className="font-mono text-13"
                          hint={
                            post
                              ? "Part of the article's address. Changing it breaks links to the old address."
                              : "Left empty, the API makes it from the title. Lower-case letters, digits and hyphens."
                          }
                        />
                        <TextareaField
                          form={form}
                          name={path("summary", locale)}
                          label={`Summary, ${LOCALE_LABEL[locale]}`}
                          optional
                          rows={3}
                          maxLength={BLOG_RULES.summaryMaxLength}
                          hint="A few lines for the list, the search engines and the social preview."
                        />
                        <MarkdownEditor
                          form={form}
                          name={path("content", locale)}
                          label={`Text, ${LOCALE_LABEL[locale]}`}
                          lang={locale}
                          required={locale === "en"}
                          optional={locale === "de"}
                          insertRef={inserters[locale]}
                          disabled={readOnly}
                          hint="Markdown: # for headings, **bold**, lists with -, [links](https://…), pictures with ![description](address). HTML is not shown. English is needed to publish; German can follow."
                        />
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardBody>
            </Card>
          </fieldset>
          <fieldset disabled={readOnly} className="min-w-0">
            <legend className="sr-only">
              Publishing, organisation and pictures
            </legend>
            {sidebar}
          </fieldset>
        </div>
        <FormError state={state} />
      </div>

      <div
        className={cn(
          gutter,
          "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-surface/95 py-3 backdrop-blur-sm",
        )}
      >
        <p className="text-13 text-ink-muted" aria-live="polite">
          {readOnly
            ? "Your role reads the blog; an admin with the Content permission changes it."
            : dirty
              ? "Changes are not saved yet."
              : post
                ? `Saved ${formatDateTime(post.updatedAt)}.`
                : "A new post is saved as a draft."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onCancel ? (
            <Button
              variant="ghost"
              size="lg"
              onClick={onCancel}
              disabled={pending}
            >
              Cancel
            </Button>
          ) : null}
          <ActionButton
            type="submit"
            permission="content.manage"
            variant="primary"
            size="lg"
            loading={pending}
            disabled={post ? !dirty : false}
          >
            {post ? "Save changes" : "Create post"}
          </ActionButton>
        </div>
      </div>
    </form>
  );
}
