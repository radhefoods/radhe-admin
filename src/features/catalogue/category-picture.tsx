"use client";

import { ImageOff, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { isSessionError } from "@/lib/api/errors";
import type { AdminImage } from "@/lib/api/types";
import { formatDate } from "@/lib/format/dates";
import { ImageDrop, UploadProgress } from "./image-drop";
import {
  IMAGE_RULES_TEXT,
  formatBytes,
  imageProblem,
  uploadFailure,
  type SizeReader,
} from "./image-rules";

/**
 * The picture of a category, inside its form (documentation, 7): one
 * picture per category. For a category that exists, a chosen file goes to
 * the API at once (`PUT …/image`) and the delete asks first. For a new
 * category the API takes no picture yet, so the file is kept here and the
 * form uploads it right after the category is created.
 */
/** A record with one picture, as the API has it now, and the calls that change it. */
export interface PictureSubject {
  /** What the record is called: "Rice". */
  name: string;
  image: AdminImage | null;
  put: (input: {
    file: File;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  remove: () => Promise<unknown>;
}

export function CategoryPicture({
  subject: category,
  file,
  onFile,
  disabled = false,
  readSize,
}: {
  /** Set when an existing record is changed. */
  subject?: PictureSubject;
  /** For a new record: the file chosen for it, if any. */
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
  /** How the size of a file is read; tests have no decoder. */
  readSize?: SizeReader;
}) {
  const [fraction, setFraction] = useState<number | null>(null);
  const [failure, setFailure] = useState<{
    title: string;
    detail: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const image = category?.image ?? null;
  const busy = disabled || fraction !== null;

  // A preview of the chosen file, for as long as it is chosen.
  const preview = useMemo(
    () =>
      file && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null,
    [file],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function take(chosen: File): Promise<void> {
    setFailure(null);
    const problem = await imageProblem(chosen, readSize);
    if (problem) {
      setFailure({
        title: "This file cannot be used",
        detail: `${chosen.name}: ${problem}${image ? " The picture stays as it is." : ""}`,
      });
      return;
    }
    if (!category) {
      onFile(chosen);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setFraction(0);
    try {
      await category.put({
        file: chosen,
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
    <div className="flex flex-col gap-3">
      {image ? (
        <div className="flex gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
          <img
            src={image.sizes.medium.url}
            alt={image.alt?.en ?? ""}
            className="aspect-square w-28 shrink-0 rounded-lg border border-line bg-sunken object-cover"
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
            {!disabled ? (
              <div className="col-span-2">
                <Button
                  size="sm"
                  variant="danger-outline"
                  icon={<Trash2 />}
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                >
                  Delete the picture
                </Button>
              </div>
            ) : null}
          </dl>
        </div>
      ) : file ? (
        <div className="flex items-center gap-4">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
            <img
              src={preview}
              alt=""
              className="aspect-square w-28 shrink-0 rounded-lg border border-line bg-sunken object-cover"
            />
          ) : (
            <span className="flex aspect-square w-28 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken text-ink-subtle">
              <ImageOff aria-hidden="true" className="size-5" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1 text-13">
            <span className="truncate font-medium text-ink">{file.name}</span>
            <span className="text-ink-subtle tabular">
              {formatBytes(file.size)} · uploaded when the category is created
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<X />}
              className="self-start"
              disabled={busy}
              onClick={() => onFile(null)}
              aria-label={`Remove the chosen picture ${file.name}`}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-13 text-ink-muted">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-subtle"
          >
            <ImageOff className="size-4.5" />
          </span>
          <p>
            {category
              ? `${category.name} has no picture yet.`
              : "No picture yet. The site shows the category without one."}
          </p>
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
            <Button size="sm" variant="ghost" onClick={() => setFailure(null)}>
              Dismiss
            </Button>
          }
        >
          {failure.detail}
        </Alert>
      ) : null}

      {!disabled ? (
        <ImageDrop
          multiple={false}
          compact
          onFiles={(files) => {
            const [chosen] = files;
            if (chosen) void take(chosen);
          }}
          inputLabel={
            image || file ? "Choose the new picture" : "Choose the picture"
          }
          disabled={busy}
          hint={`${IMAGE_RULES_TEXT} The API converts it to WebP in three sizes; the original file is not kept.`}
        >
          {image || file
            ? "Drop the new picture here, or"
            : "Drop a picture here, or"}
        </ImageDrop>
      ) : null}

      {category ? (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete the picture of ${category.name}?`}
          description="The picture is removed for good; the file is not kept. The site shows the category without a picture."
          confirmLabel="Delete the picture"
          cancelLabel="Keep it"
          tone="danger"
          onConfirm={async () => {
            await category.remove();
            notify.success("Picture deleted");
          }}
        />
      ) : null}
    </div>
  );
}
