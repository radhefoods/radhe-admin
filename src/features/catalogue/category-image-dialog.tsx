"use client";

import { ImageOff, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { BilingualField } from "@/components/form/fields";
import { FormError, useSubmit, useZodForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { isSessionError } from "@/lib/api/errors";
import type { AdminImage, Category } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDate } from "@/lib/format/dates";
import { translatedDefaults } from "@/lib/validation";
import { ImageDrop, UploadProgress } from "./image-drop";
import {
  IMAGE_RULES_TEXT,
  formatBytes,
  imageProblem,
  uploadFailure,
  type SizeReader,
} from "./image-rules";
import {
  usePatchCategoryImage,
  usePutCategoryImage,
  useRemoveCategoryImage,
} from "./queries";

const altSchema = z.object({
  alt: z.object({
    en: z.string().trim().max(300, "At most 300 characters."),
    de: z.string().trim().max(300, "At most 300 characters."),
  }),
});

function AltForm({
  category,
  image,
}: {
  category: Category;
  image: AdminImage;
}) {
  const patch = usePatchCategoryImage(category.id);
  const form = useZodForm(altSchema, {
    defaultValues: { alt: translatedDefaults(image.alt) },
  });
  const { onSubmit, state, pending } = useSubmit(form, async (values) => {
    // Both languages are named: an empty one is cleared.
    const saved = await patch.mutateAsync({
      en: values.alt.en || null,
      de: values.alt.de || null,
    });
    form.reset({ alt: translatedDefaults(saved.image?.alt) });
    notify.success("Description saved");
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
      <BilingualField
        form={form}
        name="alt"
        label="Description (alt text)"
        multiline
        rows={2}
        maxLength={300}
        hint="Read out by screen readers and shown when the picture cannot load. At most 300 characters each."
      />
      <FormError state={state} />
      <Button
        type="submit"
        className="self-start"
        loading={pending}
        disabled={!form.formState.isDirty}
      >
        Save description
      </Button>
    </form>
  );
}

function Content({
  category,
  readSize,
}: {
  category: Category;
  readSize?: SizeReader;
}) {
  const manage = useCan()("catalog.manage");
  const put = usePutCategoryImage(category.id);
  const remove = useRemoveCategoryImage(category.id);
  const [fraction, setFraction] = useState<number | null>(null);
  const [failure, setFailure] = useState<{
    title: string;
    detail: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const image = category.image;

  async function upload(file: File): Promise<void> {
    setFailure(null);
    const problem = await imageProblem(file, readSize);
    if (problem) {
      setFailure({
        title: "This file cannot be used",
        detail: `${file.name}: ${problem}${image ? " The picture stays as it is." : ""}`,
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
      notify.success(image ? "Picture replaced" : "Picture added");
    } catch (error) {
      if (isSessionError(error)) return;
      setFailure(uploadFailure(error, 1));
    } finally {
      abort.current = null;
      setFraction(null);
    }
  }

  return (
    <>
      <DialogHeader
        title={`Picture of ${category.name.en}`}
        description="One picture per category. The API converts it to WebP in three sizes; the original file is not kept."
      />
      <DialogBody>
        {image ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
            <img
              src={image.sizes.medium.url}
              alt={image.alt?.en ?? ""}
              className="aspect-square w-full shrink-0 rounded-lg border border-line bg-sunken object-cover sm:w-40"
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
            </dl>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-13 text-ink-muted">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-subtle"
            >
              <ImageOff className="size-4.5" />
            </span>
            <p>{category.name.en} has no picture yet.</p>
          </div>
        )}

        {fraction !== null ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <UploadProgress
              fraction={fraction}
              label={
                fraction < 1
                  ? "Uploading the picture"
                  : "Uploaded. The API converts the picture"
              }
            />
            {fraction < 1 ? (
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFailure(null)}
              >
                Dismiss
              </Button>
            }
          >
            {failure.detail}
          </Alert>
        ) : null}

        {manage ? (
          <ImageDrop
            multiple={false}
            compact
            onFiles={(files) => {
              const [file] = files;
              if (file) void upload(file);
            }}
            inputLabel={image ? "Choose the new picture" : "Choose the picture"}
            disabled={fraction !== null}
            hint={IMAGE_RULES_TEXT}
          >
            {image
              ? "Drop the new picture here, or"
              : "Drop a picture here, or"}
          </ImageDrop>
        ) : null}

        {image && manage ? (
          <AltForm key={image.id} category={category} image={image} />
        ) : null}
        {image && !manage ? (
          <dl className="grid gap-2 text-13 sm:grid-cols-2">
            <div>
              <dt className="text-ink-subtle">Description, English</dt>
              <dd className="text-ink">{image.alt?.en || "None"}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Description, German</dt>
              <dd className="text-ink" lang="de">
                {image.alt?.de || "None"}
              </dd>
            </div>
          </dl>
        ) : null}
      </DialogBody>
      <DialogFooter className="sm:justify-between">
        {image && manage ? (
          <Button
            variant="danger-outline"
            size="lg"
            icon={<Trash2 />}
            disabled={fraction !== null}
            onClick={() => setDeleting(true)}
          >
            Delete the picture
          </Button>
        ) : (
          <span />
        )}
        <DialogClose asChild>
          <Button size="lg">Done</Button>
        </DialogClose>
      </DialogFooter>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the picture of ${category.name.en}?`}
        description="The picture is removed for good; the file is not kept. The shop shows the category without a picture."
        confirmLabel="Delete the picture"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync();
          notify.success("Picture deleted");
        }}
      />
    </>
  );
}

/** The picture of a category: upload or replace, describe, delete. */
export function CategoryImageDialog({
  category,
  onClose,
  readSize,
}: {
  /** The category as the list has it now; `null` closes the dialog. */
  category: Category | null;
  onClose: () => void;
  readSize?: SizeReader;
}) {
  // The content stays while the dialog fades out.
  const [shown, setShown] = useState(category);
  if (category && category !== shown) setShown(category);
  return (
    <Dialog
      open={category !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        {shown ? <Content category={shown} readSize={readSize} /> : null}
      </DialogContent>
    </Dialog>
  );
}
