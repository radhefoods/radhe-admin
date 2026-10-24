"use client";

import { ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { CopyButton } from "@/components/domain/values";
import { BilingualField } from "@/components/form/fields";
import { FormError, useSubmit, useZodForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode, isSessionError } from "@/lib/api/errors";
import { BLOG_RULES, type AdminImage, type BlogPost } from "@/lib/api/types";
import { formatDate } from "@/lib/format/dates";
import { plural } from "@/lib/format/names";
import { zTranslatedOptional } from "@/lib/validation";
import { ImageDrop, UploadProgress } from "@/features/catalogue/image-drop";
import {
  IMAGE_ACCEPT,
  formatBytes,
  imageProblem,
  readImageSize,
  uploadFailure,
  type SizeReader,
  type UploadFailure,
} from "@/features/catalogue/image-rules";
import {
  usePatchFeaturedImage,
  usePutFeaturedImage,
  useRemoveFeaturedImage,
  useRemovePostImage,
  useUploadPostImages,
} from "./queries";

const { featured: FEATURED } = BLOG_RULES;
export const FEATURED_RULES_TEXT = `JPEG, PNG or WebP, up to 10 MB, at least ${FEATURED.minWidthPx} × ${FEATURED.minHeightPx} px; stored as WebP in widths 480, 1024 and 1920.`;

/** Why a file cannot be the featured picture, or `null`. */
export async function featuredProblem(
  file: File,
  readSize: SizeReader = readImageSize,
): Promise<string | null> {
  const general = await imageProblem(file, readSize);
  if (general) return general;
  const size = await readSize(file);
  if (size === "unknown" || size === null) return null;
  if (size.width < FEATURED.minWidthPx || size.height < FEATURED.minHeightPx) {
    return `${size.width} × ${size.height} px: the featured picture needs at least ${FEATURED.minWidthPx} × ${FEATURED.minHeightPx} px.`;
  }
  return null;
}

/** What to say when the API refuses the featured picture: its minimum is its own. */
function featuredFailure(error: unknown): UploadFailure {
  if (hasErrorCode(error, "IMAGE_DIMENSIONS_INVALID")) {
    const d = error.details;
    return {
      title: "The picture is too small for a featured picture",
      detail:
        d && typeof d.width === "number"
          ? `It has ${d.width} × ${d.height} px; it needs at least ${d.minimum ?? FEATURED.minWidthPx} × ${d.minimumHeight ?? FEATURED.minHeightPx} px. Nothing was stored.`
          : `It needs at least ${FEATURED.minWidthPx} × ${FEATURED.minHeightPx} px. Nothing was stored.`,
    };
  }
  return uploadFailure(error, 1);
}

function Sending({
  fraction,
  onStop,
}: {
  fraction: number;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <UploadProgress
        fraction={fraction}
        label={
          fraction < 1
            ? "Uploading"
            : "Uploaded. The API converts the picture to WebP"
        }
      />
      {fraction < 1 ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={onStop}
        >
          Stop the upload
        </Button>
      ) : null}
    </div>
  );
}

function Failure({
  failure,
  onDismiss,
}: {
  failure: UploadFailure;
  onDismiss: () => void;
}) {
  return (
    <Alert
      tone="danger"
      title={failure.title}
      actions={
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      {failure.detail}
      {failure.refused ? (
        <ul className="mt-1 list-disc pl-4">
          {failure.refused.map((entry) => (
            <li key={entry.name}>
              {entry.name}: {entry.problem}
            </li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

const altSchema = z.object({ alt: zTranslatedOptional(300) });

/** The description of the featured picture, saved on its own (`PATCH …/featured-image`). */
function AltForm({ post, disabled }: { post: BlogPost; disabled: boolean }) {
  const patch = usePatchFeaturedImage(post.id);
  const image = post.featuredImage as AdminImage;
  const form = useZodForm(altSchema, {
    defaultValues: { alt: { en: image.alt.en ?? "", de: image.alt.de ?? "" } },
  });
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    const saved = await patch.mutateAsync({ alt: values.alt });
    form.reset({
      alt: {
        en: saved.featuredImage?.alt.en ?? "",
        de: saved.featuredImage?.alt.de ?? "",
      },
    });
    notify.success("Picture description saved");
  });
  return (
    <form
      onSubmit={(event) => {
        event.stopPropagation();
        void onSubmit(event);
      }}
      noValidate
      className="flex flex-col gap-3"
    >
      <fieldset disabled={disabled} className="flex flex-col gap-3">
        <BilingualField
          form={form}
          name="alt"
          label="Picture description (alt text)"
          maxLength={300}
          hint="Read out by screen readers and used when the picture cannot load. The shop falls back to the title."
        />
        <FormError state={state} />
        <Button
          type="submit"
          size="sm"
          className="self-start"
          loading={pending}
          disabled={!form.formState.isDirty}
        >
          Save description
        </Button>
      </fieldset>
    </form>
  );
}

/** The featured picture of a post: upload, replace, describe, remove. */
export function FeaturedPicture({
  post,
  disabled,
  readSize,
}: {
  post: BlogPost;
  disabled: boolean;
  readSize?: SizeReader;
}) {
  const put = usePutFeaturedImage(post.id);
  const remove = useRemoveFeaturedImage(post.id);
  const [fraction, setFraction] = useState<number | null>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [removing, setRemoving] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const image = post.featuredImage;
  const busy = disabled || fraction !== null;

  async function take(file: File): Promise<void> {
    setFailure(null);
    const problem = await featuredProblem(file, readSize);
    if (problem) {
      setFailure({
        title: "This file cannot be the featured picture",
        detail: `${file.name}: ${problem}${image ? " The picture stays as it is." : " Nothing was uploaded."}`,
      });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setFraction(0);
    try {
      await put.mutateAsync({
        file,
        onProgress: setFraction,
        signal: controller.signal,
      });
      notify.success(
        image ? "Featured picture replaced" : "Featured picture added",
      );
    } catch (error) {
      if (isSessionError(error)) return;
      setFailure(featuredFailure(error));
    } finally {
      abort.current = null;
      setFraction(null);
    }
  }

  return (
    <Card aria-label="Featured picture">
      <CardHeader
        title="Featured picture"
        description="Heads the article and its card in the list of the shop."
        actions={
          image && !disabled ? (
            <>
              <Button
                size="sm"
                icon={<RefreshCw />}
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                Replace
              </Button>
              <Button
                size="sm"
                variant="danger-outline"
                icon={<Trash2 />}
                disabled={busy}
                onClick={() => setRemoving(true)}
              >
                Remove
              </Button>
            </>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-3">
        {image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
            <img
              src={image.sizes.medium.url}
              alt={image.alt.en ?? ""}
              width={image.sizes.medium.width}
              height={image.sizes.medium.height}
              style={{
                aspectRatio: `${image.sizes.large.width} / ${image.sizes.large.height}`,
              }}
              className="w-full rounded-lg border border-line bg-sunken object-contain"
            />
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-13">
              <div className="flex gap-1.5">
                <dt className="text-ink-subtle">Largest width</dt>
                <dd className="text-ink tabular">
                  {image.sizes.large.width} × {image.sizes.large.height} px
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-subtle">Stored as</dt>
                <dd className="text-ink tabular">
                  WebP, {formatBytes(image.bytes)}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-subtle">Uploaded</dt>
                <dd className="text-ink tabular">
                  {formatDate(image.uploadedAt)}
                </dd>
              </div>
            </dl>
            <AltForm key={image.id} post={post} disabled={busy} />
          </>
        ) : (
          <ImageDrop
            multiple={false}
            disabled={busy}
            inputLabel="Choose the featured picture"
            hint={FEATURED_RULES_TEXT}
            onFiles={(files) => {
              const [chosen] = files;
              if (chosen) void take(chosen);
            }}
          >
            Drop the featured picture here, or
          </ImageDrop>
        )}
        {fraction !== null ? (
          <Sending fraction={fraction} onStop={() => abort.current?.abort()} />
        ) : null}
        {failure ? (
          <Failure failure={failure} onDismiss={() => setFailure(null)} />
        ) : null}
        <input
          ref={input}
          type="file"
          accept={IMAGE_ACCEPT}
          aria-label="Choose the new featured picture"
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void take(file);
          }}
        />
      </CardBody>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the featured picture?"
        description="The file is deleted; the article keeps its text. Its card in the shop shows no picture until a new one is uploaded."
        confirmLabel="Remove the picture"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync();
          notify.success("Featured picture removed");
        }}
      />
    </Card>
  );
}

/**
 * The pictures for the text of a post: uploaded here, then put into the
 * Markdown at the cursor, or their address copied for a size of choice.
 */
export function TextPictures({
  post,
  disabled,
  onInsert,
  readSize,
}: {
  post: BlogPost;
  disabled: boolean;
  /** Puts `![description](url)` into the text being written. */
  onInsert: (markdown: string) => void;
  readSize?: SizeReader;
}) {
  const upload = useUploadPostImages(post.id);
  const remove = useRemovePostImage(post.id);
  const [fraction, setFraction] = useState<number | null>(null);
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [removing, setRemoving] = useState<AdminImage | null>(null);
  const abort = useRef<AbortController | null>(null);
  const remaining = BLOG_RULES.maxImagesPerPost - post.images.length;
  const busy = disabled || fraction !== null;

  async function take(files: File[]): Promise<void> {
    setFailure(null);
    const refused: { name: string; problem: string }[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      const problem = await imageProblem(file, readSize);
      if (problem) refused.push({ name: file.name, problem });
      else accepted.push(file);
    }
    if (refused.length > 0) {
      setFailure({
        title: `${plural(refused.length, "file")} cannot be uploaded`,
        detail: "Nothing was uploaded: choose the files again without them.",
        refused,
      });
      return;
    }
    if (accepted.length > remaining) {
      setFailure({
        title: `There is room for ${plural(remaining, "more picture")}`,
        detail: `A post holds ${BLOG_RULES.maxImagesPerPost} pictures at most, and you chose ${accepted.length}. Nothing was uploaded.`,
      });
      return;
    }
    if (accepted.length > BLOG_RULES.maxImagesPerRequest) {
      setFailure({
        title: `At most ${BLOG_RULES.maxImagesPerRequest} pictures at once`,
        detail: `You chose ${accepted.length}. Add the rest in a second step. Nothing was uploaded.`,
      });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setFraction(0);
    try {
      await upload.mutateAsync({
        files: accepted,
        onProgress: setFraction,
        signal: controller.signal,
      });
      notify.success(
        `${plural(accepted.length, "picture")} uploaded`,
        "Put them into the text where they belong.",
      );
    } catch (error) {
      if (isSessionError(error)) return;
      const notice = uploadFailure(error, accepted.length);
      setFailure(
        hasErrorCode(error, "IMAGE_LIMIT_REACHED")
          ? {
              ...notice,
              title: `A post holds ${BLOG_RULES.maxImagesPerPost} pictures at most`,
            }
          : notice,
      );
    } finally {
      abort.current = null;
      setFraction(null);
    }
  }

  return (
    <Card aria-label="Pictures for the text">
      <CardHeader
        title="Pictures for the text"
        description={`${plural(post.images.length, "picture")} of ${BLOG_RULES.maxImagesPerPost}. Upload them here, then put each one into the text at the cursor.`}
      />
      <CardBody className="flex flex-col gap-3">
        {post.images.length > 0 ? (
          <ul aria-label="Pictures of the post" className="flex flex-col gap-2">
            {post.images.map((image) => (
              <li
                key={image.id}
                className="flex items-center gap-3 rounded-lg border border-line p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
                <img
                  src={image.sizes.small.url}
                  alt={image.alt.en ?? ""}
                  width={56}
                  height={56}
                  loading="lazy"
                  className="size-14 shrink-0 rounded-md border border-line bg-sunken object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-13 text-ink-muted tabular">
                    {image.sizes.large.width} × {image.sizes.large.height} px ·{" "}
                    {formatBytes(image.bytes)}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!disabled ? (
                      <Button
                        size="sm"
                        icon={<ImagePlus />}
                        onClick={() =>
                          onInsert(
                            `![${image.alt.en ?? ""}](${image.sizes.medium.url})`,
                          )
                        }
                      >
                        Insert into text
                      </Button>
                    ) : null}
                    <span className="inline-flex items-center gap-0.5 text-13 text-ink-muted">
                      Copy address
                      <CopyButton
                        value={image.sizes.medium.url}
                        label="Copy the address of the medium size"
                      />
                    </span>
                    {!disabled ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 />}
                        aria-label="Remove this picture"
                        disabled={busy}
                        onClick={() => setRemoving(image)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {!disabled && remaining > 0 ? (
          <ImageDrop
            multiple
            compact={post.images.length > 0}
            disabled={busy}
            inputLabel="Choose pictures for the text"
            hint={`JPEG, PNG or WebP, up to 10 MB, at least 200 px on each side; at most ${BLOG_RULES.maxImagesPerRequest} at once. Stored as WebP in widths 320, 800 and 1600.`}
            onFiles={(files) => void take(files)}
          >
            Drop pictures here, or
          </ImageDrop>
        ) : null}
        {fraction !== null ? (
          <Sending fraction={fraction} onStop={() => abort.current?.abort()} />
        ) : null}
        {failure ? (
          <Failure failure={failure} onDismiss={() => setFailure(null)} />
        ) : null}
      </CardBody>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this picture?"
        description="The file is deleted. Where the text still shows it, the picture is missing from the article: take it out of the Markdown too."
        confirmLabel="Remove the picture"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.id);
          } catch (error) {
            notify.error(error, errorMessage(error));
            throw error;
          }
          notify.success("Picture removed");
        }}
      />
    </Card>
  );
}
