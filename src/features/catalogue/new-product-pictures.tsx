"use client";

import { ImageIcon, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/surface";
import { IMAGE_LIMITS, IMAGE_RULES } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";
import { ImageDrop, UploadProgress } from "./image-drop";
import {
  IMAGE_RULES_TEXT,
  checkImageFiles,
  formatBytes,
  type SizeReader,
} from "./image-rules";

/**
 * How many pictures go with a new wholesale product: they travel in one
 * request right after the product is created, and the API takes 10 per
 * request (8). The rest is added on the product's page.
 */
export const NEW_PRODUCT_MAX_PICTURES = IMAGE_RULES.maxFilesPerRequest;

interface Refusal {
  title: string;
  detail: string | null;
  refused?: { name: string; problem: string }[];
}

/** The words of one chooser: a whole new product, or one of its pack sizes. */
interface Words {
  /** What holds the pictures, for the rules: "product", "pack size". */
  holder: string;
  /** How many the holder takes in the end (`IMAGE_LIMITS`). */
  limit: number;
  /** How many can be chosen here. */
  max: number;
  /** The name of the list of chosen pictures. */
  list: string;
  /** The name of the file field. */
  input: string;
  /** Nothing fits any more: said when more are chosen. */
  full: string;
  /** Nothing fits any more: said in place of the drop area. */
  note: string;
  /** `room` more fit, and `chosen` were chosen. */
  over: (room: number, chosen: number) => string;
}

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size;

/**
 * The pictures chosen for something that does not exist yet. The API takes
 * pictures only for a record with an id, so they are kept here, checked
 * against its rules at once, and uploaded by the page right after the
 * product is created.
 */
function ChosenPictures({
  files,
  onChange,
  sending,
  disabled,
  readSize,
  words,
  compact,
  hint,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  sending: { fraction: number } | null;
  disabled: boolean;
  readSize?: SizeReader;
  words: Words;
  /** Smaller tiles, for a chooser inside a row. */
  compact: boolean;
  /** Said under the drop area while nothing is chosen. */
  hint?: string;
}) {
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const busy = checking || sending !== null || disabled;
  const room = words.max - files.length;

  // A preview per file, for as long as the file is chosen.
  const previews = useMemo(
    () =>
      files.map((file) => ({
        file,
        url:
          typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(file)
            : null,
      })),
    [files],
  );
  useEffect(
    () => () => {
      for (const preview of previews) {
        if (preview.url) URL.revokeObjectURL(preview.url);
      }
    },
    [previews],
  );

  async function add(added: File[]): Promise<void> {
    if (busy) return;
    setRefusal(null);
    setChecking(true);
    let check;
    try {
      check = await checkImageFiles(added, {
        existing: files.length,
        limit: words.limit,
        holder: words.holder,
        readSize,
      });
    } finally {
      setChecking(false);
    }
    // Chosen twice: once is enough.
    const fresh = check.accepted.filter(
      (file) => !files.some((chosen) => sameFile(chosen, file)),
    );
    let blocked = check.blocked;
    if (!blocked && fresh.length > room) {
      blocked = room === 0 ? words.full : words.over(room, fresh.length);
    }
    if (check.refused.length > 0) {
      setRefusal({
        title:
          check.refused.length === 1
            ? "One file cannot be uploaded"
            : `${check.refused.length} files cannot be uploaded`,
        detail:
          blocked ??
          (fresh.length > 0
            ? `${plural(fresh.length, "other picture")} ${fresh.length === 1 ? "was" : "were"} added.`
            : null),
        refused: check.refused,
      });
    } else if (blocked) {
      setRefusal({ title: "These pictures cannot be added", detail: blocked });
    }
    if (!blocked && fresh.length > 0) onChange([...files, ...fresh]);
  }

  return (
    <>
      {files.length > 0 ? (
        <ul
          aria-label={words.list}
          className={cn(
            "grid gap-3",
            compact
              ? "grid-cols-3 xs:grid-cols-4 md:grid-cols-6"
              : "grid-cols-2 xs:grid-cols-3 md:grid-cols-5",
          )}
        >
          {previews.map((preview, index) => (
            <li
              key={`${preview.file.name}-${preview.file.size}`}
              className="flex min-w-0 flex-col gap-1"
            >
              <div className="relative aspect-square overflow-hidden rounded-md border border-line bg-sunken">
                {preview.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local file, not yet uploaded
                  <img
                    src={preview.url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-full items-center justify-center text-ink-subtle"
                  >
                    <ImageIcon className="size-6" />
                  </span>
                )}
                {index === 0 ? (
                  <Badge
                    tone="neutral"
                    dot={false}
                    className="absolute top-1 left-1 h-5 gap-1 px-1.5 shadow-card"
                  >
                    <Star aria-hidden="true" className="size-3 fill-current" />
                    Main
                  </Badge>
                ) : null}
                <Button
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`Remove ${preview.file.name}`}
                  onClick={() =>
                    onChange(files.filter((_, at) => at !== index))
                  }
                  className="absolute right-1 bottom-1 size-6 border-line bg-surface/95 text-ink-muted hover:bg-surface hover:text-ink"
                >
                  <X />
                </Button>
              </div>
              <p
                className="truncate text-xs text-ink-muted"
                title={preview.file.name}
              >
                {preview.file.name} · {formatBytes(preview.file.size)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {sending ? (
        <UploadProgress
          fraction={sending.fraction}
          label={
            sending.fraction < 1
              ? `Uploading ${plural(files.length, "picture")}`
              : "Uploaded. The API converts the pictures to WebP"
          }
        />
      ) : null}

      {refusal ? (
        <Alert
          tone="danger"
          title={refusal.title}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setRefusal(null)}>
              Dismiss
            </Button>
          }
        >
          {refusal.refused ? (
            <ul className="list-disc pl-4">
              {refusal.refused.map((entry) => (
                <li key={entry.name}>
                  <span className="font-medium text-ink">{entry.name}</span>:{" "}
                  {entry.problem}
                </li>
              ))}
            </ul>
          ) : null}
          {refusal.detail ? <p>{refusal.detail}</p> : null}
        </Alert>
      ) : null}

      {room > 0 ? (
        <ImageDrop
          onFiles={(added) => void add(added)}
          inputLabel={words.input}
          disabled={busy}
          compact={compact || files.length > 0}
          hint={`${IMAGE_RULES_TEXT} ${files.length > 0 ? `Room for ${plural(room, "more")}.` : (hint ?? "")}`.trim()}
        >
          Drop pictures here, or
        </ImageDrop>
      ) : (
        <p className="text-13 text-ink-muted">{words.note}</p>
      )}
    </>
  );
}

const PRODUCT_WORDS: Words = {
  holder: "product",
  limit: IMAGE_LIMITS.wholesaleProduct,
  max: NEW_PRODUCT_MAX_PICTURES,
  list: "Pictures chosen for the new product",
  input: "Choose pictures to upload",
  full: `${NEW_PRODUCT_MAX_PICTURES} pictures go with a new product at most. More can be added on its page.`,
  note: `${NEW_PRODUCT_MAX_PICTURES} pictures chosen, the most that go with a new product. More can be added on its page.`,
  over: (room, chosen) =>
    `There is room for ${plural(room, "more picture")} with the new product, and you chose ${chosen}. More can be added on its page.`,
};

/**
 * The pictures chosen for a wholesale product that does not exist yet: a
 * card of the form. A wholesale product holds its pictures itself (25).
 */
export function NewProductPictures({
  files,
  onChange,
  sending,
  disabled = false,
  readSize,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  /** The upload after the creation, while it runs. */
  sending: { fraction: number } | null;
  disabled?: boolean;
  /** How the size of a file is read; tests have no decoder. */
  readSize?: SizeReader;
}) {
  return (
    <Card id="pictures" aria-label="Pictures" className="scroll-mt-20">
      <CardHeader
        title="Pictures"
        description={`Up to ${NEW_PRODUCT_MAX_PICTURES} go with the product: they are uploaded right after it is created. The first one is the main picture; more, and their order, on the product's page.`}
      />
      <CardBody className="flex flex-col gap-4">
        <ChosenPictures
          files={files}
          onChange={onChange}
          sending={sending}
          disabled={disabled}
          readSize={readSize}
          words={PRODUCT_WORDS}
          compact={false}
        />
      </CardBody>
    </Card>
  );
}

/**
 * The pictures chosen for one pack size of a retail product that does not
 * exist yet (8, doc/VARIANT_IMAGES.md): a part of the row of the pack size.
 * They are uploaded to the pack size right after the product is created.
 */
export function NewRowPictures({
  files,
  onChange,
  label,
  disabled = false,
  readSize,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  /** The pack as typed, "5 kg"; empty while nothing is typed. */
  label: string;
  disabled?: boolean;
  readSize?: SizeReader;
}) {
  const max = IMAGE_LIMITS.variant;
  const name = label || "the new pack size";
  const words: Words = {
    holder: "pack size",
    limit: max,
    max,
    list: `Pictures chosen for ${name}`,
    input: `Choose pictures for ${name}`,
    full: `A pack size holds ${max} pictures at most.`,
    note: `${max} pictures chosen, the most a pack size holds.`,
    over: (room, chosen) =>
      `There is room for ${plural(room, "more picture")} for this pack size, and you chose ${chosen}. A pack size holds ${max} at most.`,
  };
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <p className="flex items-baseline gap-2 text-sm font-semibold text-ink">
        Pictures
        <span className="text-13 font-normal text-ink-muted tabular">
          {files.length} of {max}
        </span>
      </p>
      <ChosenPictures
        files={files}
        onChange={onChange}
        sending={null}
        disabled={disabled}
        readSize={readSize}
        words={words}
        compact
        hint="Optional: without a picture the shop shows the placeholder. Uploaded right after the product is created; the first one is the main picture."
      />
    </div>
  );
}
