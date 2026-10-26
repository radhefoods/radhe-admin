"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  ImageOff,
  PencilLine,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { BilingualField } from "@/components/form/fields";
import { FormError, useSubmit, useZodForm } from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { hasErrorCode, isSessionError } from "@/lib/api/errors";
import {
  IMAGE_RULES,
  type AdminImage,
  type TranslatedOptional,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format/dates";
import { plural, translated } from "@/lib/format/names";
import { translatedDefaults } from "@/lib/validation";
import { moveItem } from "./category-tree";
import { ImageDrop, UploadProgress } from "./image-drop";
import {
  IMAGE_ACCEPT,
  IMAGE_RULES_TEXT,
  checkImageFiles,
  formatBytes,
  imageProblem,
  remainingImages,
  uploadFailure,
  type SizeReader,
} from "./image-rules";
import {
  retailImages,
  usePatchImage,
  useRemoveImage,
  useReorderImages,
  useReplaceImage,
  useUploadImages,
  type ImageOwner,
  type ImageTarget,
} from "./queries";
import { DragHandle, SortableList, useSortableEntry } from "./sortable";

interface Failure {
  title: string;
  detail?: string | null;
  /** The files that break a rule, each with its reason. */
  refused?: { name: string; problem: string }[];
  /** The files that are fine and can go without the refused ones. */
  rest?: File[];
}

// --- The description of a picture ---------------------------------------------

const altSchema = z.object({
  alt: z.object({
    en: z.string().trim().max(300, "At most 300 characters."),
    de: z.string().trim().max(300, "At most 300 characters."),
  }),
});

/** What is missing of a description, in words. */
function altState(alt: TranslatedOptional | null | undefined): {
  en: boolean;
  de: boolean;
  text: string;
} {
  const en = Boolean(alt?.en?.trim());
  const de = Boolean(alt?.de?.trim());
  const text =
    en && de
      ? "described in English and German"
      : en
        ? "the German description is missing"
        : de
          ? "the English description is missing"
          : "no description yet";
  return { en, de, text };
}

/** `EN` `DE missing`: which languages of a description are there. */
export function AltMarks({
  alt,
}: {
  alt: TranslatedOptional | null | undefined;
}) {
  const state = altState(alt);
  if (!state.en && !state.de) {
    return (
      <Badge tone="attention" dot={false} className="h-5 px-1.5 text-2xs">
        No description
      </Badge>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {(["en", "de"] as const).map((locale) =>
        state[locale] ? (
          <Badge
            key={locale}
            tone="neutral"
            dot={false}
            className="h-5 px-1.5 text-2xs"
          >
            {locale.toUpperCase()}
          </Badge>
        ) : (
          <Badge
            key={locale}
            tone="attention"
            dot={false}
            className="h-5 px-1.5 text-2xs"
          >
            {locale.toUpperCase()} missing
          </Badge>
        ),
      )}
    </span>
  );
}

/** The description (alt text) of one picture, in both languages. */
export function ImageAltDialog({
  image,
  title,
  onOpenChange,
  onSave,
}: {
  /** `null` closes the dialog. */
  image: AdminImage | null;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSave: (alt: TranslatedOptional) => Promise<unknown>;
}) {
  return (
    <Dialog open={image !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {image ? (
          <AltForm
            key={image.id}
            image={image}
            title={title}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AltForm({
  image,
  title,
  onSave,
  onClose,
}: {
  image: AdminImage;
  title: string;
  onSave: (alt: TranslatedOptional) => Promise<unknown>;
  onClose: () => void;
}) {
  const form = useZodForm(altSchema, {
    defaultValues: { alt: translatedDefaults(image.alt) },
  });
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    // Both languages are named: an empty one is cleared.
    await onSave({ en: values.alt.en || null, de: values.alt.de || null });
    notify.success("Description saved");
    onClose();
  });
  return (
    <form
      onSubmit={(event) => {
        // The dialog is rendered inside other forms' trees: its submit stays its own.
        event.stopPropagation();
        void onSubmit(event);
      }}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader
        title={title}
        description="The description is read out by screen readers and shown when the picture cannot load. Say what is on it, in each language."
      />
      <DialogBody>
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
          <img
            src={image.sizes.medium.url}
            alt=""
            className="aspect-square w-full shrink-0 rounded-lg border border-line bg-sunken object-contain sm:w-44"
          />
          <dl className="grid flex-1 grid-cols-2 content-start gap-x-4 gap-y-2 text-13">
            <div>
              <dt className="text-ink-subtle">Largest size</dt>
              <dd className="text-ink tabular">
                {image.sizes.large.width} × {image.sizes.large.height} px
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Stored as</dt>
              <dd className="text-ink tabular">
                WebP, {formatBytes(image.bytes)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Uploaded</dt>
              <dd className="text-ink tabular">
                {formatDate(image.uploadedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Main picture</dt>
              <dd className="text-ink">{image.isPrimary ? "Yes" : "No"}</dd>
            </div>
          </dl>
        </div>
        <BilingualField
          form={form}
          name="alt"
          label="Description (alt text)"
          multiline
          rows={2}
          maxLength={300}
          hint="At most 300 characters each."
        />
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Save description
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- One picture of the grid ---------------------------------------------------

function Tile({
  image,
  index,
  count,
  name,
  manage,
  busy,
  progress,
  onDescribe,
  onMove,
  onMakeMain,
  onReplace,
  onDelete,
}: {
  image: AdminImage;
  index: number;
  count: number;
  /** What the picture is called: "Picture 2". */
  name: string;
  manage: boolean;
  /** Something is on its way for the whole grid: no second change meanwhile. */
  busy: boolean;
  /** 0 to 1 while a new file for this picture travels. */
  progress: number | null;
  onDescribe: () => void;
  onMove: (to: number) => void;
  onMakeMain: () => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const { setNode, style, dragging, setHandle, handleProps, pointerProps } =
    useSortableEntry(image.id);
  const alt = altState(image.alt);
  const movable = manage && count > 1;
  return (
    <li
      ref={setNode}
      style={style}
      className={cn("relative flex min-w-0 flex-col gap-1", dragging && "z-20")}
    >
      <div className="relative">
        <div
          {...(movable ? pointerProps : undefined)}
          onClick={manage ? onDescribe : undefined}
          className={cn(
            "relative aspect-square overflow-hidden rounded-md border border-line bg-sunken",
            movable
              ? "cursor-grab active:cursor-grabbing"
              : manage && "cursor-pointer",
            dragging && "shadow-float ring-2 ring-accent",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
          <img
            src={image.sizes.small.url}
            alt={image.alt?.en?.trim() || name}
            width={image.sizes.small.width}
            height={image.sizes.small.height}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-cover"
          />
          {image.isPrimary ? (
            <Badge
              tone="neutral"
              dot={false}
              className="absolute top-1 left-1 h-5 gap-1 px-1.5 shadow-card"
            >
              <Star aria-hidden="true" className="size-3 fill-current" />
              Main
            </Badge>
          ) : null}
          {progress !== null ? (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface/85 text-13 font-medium text-ink"
            >
              <Spinner />
              <span className="tabular">
                {progress < 1
                  ? `${Math.round(progress * 100)} %`
                  : "Converting"}
              </span>
            </div>
          ) : null}
        </div>
        {movable ? (
          <DragHandle
            setHandle={setHandle}
            handleProps={handleProps}
            label={`Move ${name}, place ${index + 1} of ${count}`}
            className="absolute top-1 right-1 size-6 border border-line bg-surface/95 text-ink-muted shadow-card hover:bg-surface"
          />
        ) : null}
        {manage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                disabled={busy}
                aria-label={`Actions for ${name}`}
                className="absolute right-1 bottom-1 size-6 border-line bg-surface/95 text-ink-muted hover:bg-surface hover:text-ink"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {image.isPrimary ? null : (
                <DropdownMenuItem onSelect={onMakeMain}>
                  <Star />
                  Make it the main picture
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onDescribe}>
                <PencilLine />
                Describe (alt text)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onReplace}>
                <RefreshCw />
                Replace the file
              </DropdownMenuItem>
              {count > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() => onMove(index - 1)}
                  >
                    <ArrowLeft />
                    Move earlier
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === count - 1}
                    onSelect={() => onMove(index + 1)}
                  >
                    <ArrowRight />
                    Move later
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem danger onSelect={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {manage ? (
        <button
          type="button"
          onClick={onDescribe}
          aria-label={`Describe ${name}: ${alt.text}`}
          className="flex min-h-6 items-center self-start rounded-sm hover:bg-sunken"
        >
          <AltMarks alt={image.alt} />
        </button>
      ) : (
        <span
          className="flex min-h-6 items-center"
          title={image.alt?.en ?? undefined}
        >
          <AltMarks alt={image.alt} />
        </span>
      )}
    </li>
  );
}

// --- The pictures of a product ---------------------------------------------------

/**
 * The pictures of a product, retail or wholesale: upload (dropped or
 * chosen, several at once), order, main picture, descriptions, a new file
 * for a picture, deletion. Files are checked against the rules of the API
 * before anything is sent.
 */
export function ImageManager<P extends ImageOwner>({
  product,
  target: given,
  readSize,
}: {
  product: P;
  /** The endpoints and the query of the record; the retail product by default. */
  target?: ImageTarget<P>;
  /** How the size of a file is read; tests have no decoder. */
  readSize?: SizeReader;
}) {
  const target =
    given ?? (retailImages(product.id) as unknown as ImageTarget<P>);
  const manage = useCan()(target.permission);
  const client = useQueryClient();
  const upload = useUploadImages(target);
  const replace = useReplaceImage(target);
  const patch = usePatchImage(target);
  const remove = useRemoveImage(target);
  const reorder = useReorderImages(target);

  const [sending, setSending] = useState<{
    count: number;
    fraction: number;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [replacing, setReplacing] = useState<{
    imageId: string;
    fraction: number;
  } | null>(null);
  const [describing, setDescribing] = useState<AdminImage | null>(null);
  const [deleting, setDeleting] = useState<AdminImage | null>(null);
  const abort = useRef<AbortController | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const images = product.images;
  const ids = images.map((image) => image.id);
  const room = remainingImages(images.length);
  const productName = translated(product.name);
  const nameOf = (id: string) => `picture ${ids.indexOf(id) + 1}`;
  const busy = sending !== null || replacing !== null || checking;

  function reload(): void {
    void client.invalidateQueries({ queryKey: target.detailKey });
  }

  async function send(files: File[]): Promise<void> {
    const controller = new AbortController();
    abort.current = controller;
    setFailure(null);
    setSending({ count: files.length, fraction: 0 });
    try {
      await upload.mutateAsync({
        files,
        signal: controller.signal,
        onProgress: (fraction) => setSending({ count: files.length, fraction }),
      });
      notify.success(
        files.length === 1 ? "Picture added" : `${files.length} pictures added`,
        images.length === 0 ? "The first one is the main picture." : undefined,
      );
    } catch (error) {
      if (isSessionError(error)) return;
      setFailure(uploadFailure(error, files.length));
      // The product is not what the panel thought: look again.
      if (hasErrorCode(error, "IMAGE_LIMIT_REACHED", target.notFound)) reload();
    } finally {
      abort.current = null;
      setSending(null);
    }
  }

  async function add(files: File[]): Promise<void> {
    if (busy) return;
    setFailure(null);
    setChecking(true);
    let check;
    try {
      check = await checkImageFiles(files, {
        existing: images.length,
        readSize,
      });
    } finally {
      setChecking(false);
    }
    if (check.refused.length > 0) {
      const rest = check.blocked ? [] : check.accepted;
      setFailure({
        title:
          check.refused.length === 1
            ? "One file cannot be uploaded"
            : `${check.refused.length} files cannot be uploaded`,
        detail:
          check.blocked ??
          (rest.length > 0
            ? "Nothing was uploaded yet. The API takes an upload as a whole or not at all, so the panel sends only files that pass."
            : "Nothing was uploaded."),
        refused: check.refused,
        rest,
      });
      return;
    }
    if (check.blocked) {
      setFailure({
        title: "These pictures cannot be uploaded",
        detail: check.blocked,
      });
      return;
    }
    await send(check.accepted);
  }

  async function replaceFile(imageId: string, file: File): Promise<void> {
    setFailure(null);
    const problem = await imageProblem(file, readSize);
    if (problem) {
      setFailure({
        title: "This file cannot replace the picture",
        detail: "The picture stays as it is.",
        refused: [{ name: file.name, problem }],
      });
      return;
    }
    setReplacing({ imageId, fraction: 0 });
    try {
      await replace.mutateAsync({
        imageId,
        file,
        onProgress: (fraction) => setReplacing({ imageId, fraction }),
      });
      notify.success(
        "Picture replaced",
        "Its place, description and main-picture setting are kept.",
      );
    } catch (error) {
      if (isSessionError(error)) return;
      const notice = uploadFailure(error, 1);
      setFailure({
        title: notice.title,
        detail: notice.detail ?? "The picture stays as it is.",
      });
      if (hasErrorCode(error, "IMAGE_NOT_FOUND")) reload();
    } finally {
      setReplacing(null);
    }
  }

  async function makeMain(image: AdminImage): Promise<void> {
    try {
      await patch.mutateAsync({ imageId: image.id, isPrimary: true });
      notify.success("Main picture changed");
    } catch (error) {
      notify.error(error);
      if (hasErrorCode(error, "IMAGE_NOT_FOUND")) reload();
    }
  }

  return (
    <Card id="pictures" aria-label="Pictures" className="scroll-mt-20">
      <CardHeader
        title="Pictures"
        description={
          images.length === 0
            ? "None yet"
            : `${images.length} of ${IMAGE_RULES.maxImagesPerProduct}. The order here is the order on ${target.site}.`
        }
      />
      <CardBody className="flex flex-col gap-4">
        {images.length > 0 ? (
          <SortableList
            ids={ids}
            labelOf={nameOf}
            layout="grid"
            disabled={!manage || busy}
            onReorder={(ordered) => reorder.mutate(ordered)}
          >
            <ul
              aria-label={`Pictures of ${productName}`}
              className="grid grid-cols-2 gap-3 xs:grid-cols-3 md:grid-cols-5 xl:grid-cols-3"
            >
              {images.map((image, index) => (
                <Tile
                  key={image.id}
                  image={image}
                  index={index}
                  count={images.length}
                  name={`picture ${index + 1}`}
                  manage={manage}
                  busy={busy}
                  progress={
                    replacing?.imageId === image.id ? replacing.fraction : null
                  }
                  onDescribe={() => setDescribing(image)}
                  onMove={(to) => reorder.mutate(moveItem(ids, index, to))}
                  onMakeMain={() => void makeMain(image)}
                  onReplace={() => {
                    replaceTarget.current = image.id;
                    replaceInput.current?.click();
                  }}
                  onDelete={() => setDeleting(image)}
                />
              ))}
            </ul>
          </SortableList>
        ) : (
          <div className="flex items-center gap-3 text-13 text-ink-muted">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-subtle"
            >
              <ImageOff className="size-4.5" />
            </span>
            <p>
              {target.site === "the shop" ? "The shop" : "The wholesale site"}{" "}
              shows the product without a picture. The first picture you upload
              becomes the main picture.
            </p>
          </div>
        )}

        {sending ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <UploadProgress
              fraction={sending.fraction}
              label={
                sending.fraction < 1
                  ? `Uploading ${plural(sending.count, "picture")}`
                  : "Uploaded. The API converts the pictures to WebP"
              }
            />
            {sending.fraction < 1 ? (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => abort.current?.abort()}
              >
                Stop the upload
              </Button>
            ) : null}
          </div>
        ) : null}

        {failure ? (
          <Alert
            tone="danger"
            title={failure.title}
            actions={
              <>
                {failure.rest && failure.rest.length > 0 ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      const rest = failure.rest ?? [];
                      void send(rest);
                    }}
                  >
                    Upload the other {plural(failure.rest.length, "picture")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFailure(null)}
                >
                  Dismiss
                </Button>
              </>
            }
          >
            {failure.refused && failure.refused.length > 0 ? (
              <ul className="mb-1 flex flex-col gap-0.5">
                {failure.refused.map((entry, index) => (
                  <li key={`${entry.name}-${index}`} className="break-words">
                    <span className="font-medium text-ink">{entry.name}</span>:{" "}
                    {entry.problem}
                  </li>
                ))}
              </ul>
            ) : null}
            {failure.detail}
          </Alert>
        ) : null}

        {manage ? (
          room > 0 ? (
            <ImageDrop
              onFiles={(files) => void add(files)}
              inputLabel="Choose pictures to upload"
              disabled={busy}
              hint={
                <>
                  {IMAGE_RULES_TEXT} Up to{" "}
                  {Math.min(room, IMAGE_RULES.maxFilesPerRequest)} at once; if
                  the API refuses one file of an upload, it stores none of them.
                </>
              }
            >
              {checking ? "Checking the files…" : "Drop pictures here, or"}
            </ImageDrop>
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-13 text-ink-muted">
              The product holds {IMAGE_RULES.maxImagesPerProduct} pictures, the
              most it can. Delete one to add another.
            </p>
          )
        ) : null}

        <input
          ref={replaceInput}
          type="file"
          accept={IMAGE_ACCEPT}
          aria-label="Choose the new file for the picture"
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            const imageId = replaceTarget.current;
            replaceTarget.current = null;
            if (file && imageId) void replaceFile(imageId, file);
          }}
        />
      </CardBody>

      <ImageAltDialog
        image={describing}
        title={
          describing
            ? `Describe ${nameOf(describing.id)}`
            : "Describe the picture"
        }
        onOpenChange={(open) => {
          if (!open) setDescribing(null);
        }}
        onSave={(alt) =>
          patch.mutateAsync({ imageId: describing?.id ?? "", alt })
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={
          deleting ? `Delete ${nameOf(deleting.id)}?` : "Delete the picture?"
        }
        description={
          deleting?.isPrimary && images.length > 1
            ? "The picture is removed from the product for good; the file is not kept. It is the main picture: the first remaining one takes its place."
            : "The picture is removed from the product for good; the file is not kept."
        }
        facts={[
          { label: "Product", value: productName },
          {
            label: "Pictures afterwards",
            value: Math.max(0, images.length - 1),
          },
        ]}
        confirmLabel="Delete the picture"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          notify.success("Picture deleted");
        }}
      >
        {deleting ? (
          // eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes
          <img
            src={deleting.sizes.small.url}
            alt=""
            className="size-24 self-center rounded-md border border-line bg-sunken object-cover"
          />
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
