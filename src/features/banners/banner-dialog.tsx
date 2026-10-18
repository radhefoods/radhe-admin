"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import {
  BerlinDateTimeField,
  BilingualField,
  SwitchField,
} from "@/components/form/fields";
import {
  FormError,
  TextField,
  useSubmit,
  useZodForm,
} from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import { BANNER_RULES, type Banner, type Id } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDate } from "@/lib/format/dates";
import { ImageDrop, UploadProgress } from "@/features/catalogue/image-drop";
import {
  IMAGE_ACCEPT,
  formatBytes,
  type SizeReader,
} from "@/features/catalogue/image-rules";
import {
  BANNER_RULES_TEXT,
  bannerProblem,
  bannerUploadFailure,
  type BannerUploadFailure,
} from "./banner-rules";
import {
  bannerDefaults,
  bannerErrorField,
  bannerSchema,
  toBannerPatch,
  type BannerFormValues,
} from "./banner-schema";
import {
  useCreateBanner,
  useReplaceBannerImage,
  useUpdateBanner,
} from "./queries";

/** What the dialog is open for: a new banner (its picture first), or one to change. */
export type BannerEdit = { mode: "new" } | { mode: "edit"; id: Id };

/** What a banner is called in the interface: its name, or its place. */
export function bannerLabel(banner: Banner, index: number): string {
  return banner.name?.trim() || `Banner ${index + 1}`;
}

/** The picture of a banner, as wide as the dialog, in the ratio it has. */
function Preview({ banner }: { banner: Banner }) {
  const { large, medium } = banner.image.sizes;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes
    <img
      src={medium.url}
      alt={banner.image.alt?.en ?? ""}
      width={medium.width}
      height={medium.height}
      style={{ aspectRatio: `${large.width} / ${large.height}` }}
      className="w-full rounded-lg border border-line bg-sunken object-contain"
    />
  );
}

/** A file on its way to the API: the bar, and a way to stop it. */
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
            ? "Uploading the picture"
            : "Uploaded. The API converts the picture to WebP in three widths"
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
  failure: BannerUploadFailure;
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
    </Alert>
  );
}

/**
 * The first step of a new banner: its picture. The API creates the banner
 * from the file, switched off and last in the order; the form of the
 * created banner follows in the same dialog.
 */
function NewBanner({
  onCreated,
  onClose,
  readSize,
}: {
  onCreated: (banner: Banner) => void;
  onClose: () => void;
  readSize?: SizeReader;
}) {
  const create = useCreateBanner();
  const [fraction, setFraction] = useState<number | null>(null);
  const [failure, setFailure] = useState<BannerUploadFailure | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = fraction !== null;

  async function take(file: File): Promise<void> {
    setFailure(null);
    const problem = await bannerProblem(file, readSize);
    if (problem) {
      setFailure({
        title: "This file cannot be a banner",
        detail: `${file.name}: ${problem} Nothing was uploaded.`,
      });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setFraction(0);
    try {
      const banner = await create.mutateAsync({
        file,
        onProgress: setFraction,
        signal: controller.signal,
      });
      notify.success(
        "Banner created",
        "It is switched off until you switch it on here.",
      );
      onCreated(banner);
    } catch (error) {
      if (isSessionError(error)) return;
      setFailure(bannerUploadFailure(error));
    } finally {
      abort.current = null;
      setFraction(null);
    }
  }

  return (
    <>
      <DialogHeader
        title="New banner"
        description="A banner is one finished picture with every text and offer already on it; the shop adds nothing. Upload the picture first: the name, link, period and switch come next."
      />
      <DialogBody>
        <ImageDrop
          multiple={false}
          onFiles={(files) => {
            const [chosen] = files;
            if (chosen) void take(chosen);
          }}
          inputLabel="Choose the banner picture"
          disabled={busy}
          hint={`${BANNER_RULES_TEXT} The API converts it to WebP in three widths; the original file is not kept.`}
        >
          Drop the banner picture here, or
        </ImageDrop>
        <p className="text-13 text-ink-muted">
          The same picture is shown on every screen, from phone to desktop, in
          the ratio you upload. Keep text and the main motif inside the middle
          70 % of the width and away from the top and bottom edges, in a font
          that is still legible at a third of the size.
        </p>
        {fraction !== null ? (
          <Sending fraction={fraction} onStop={() => abort.current?.abort()} />
        ) : null}
        {failure ? (
          <Failure failure={failure} onDismiss={() => setFailure(null)} />
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

/** The banner's picture with the facts of its stored form, and a new file for it. */
function Picture({
  banner,
  disabled,
  readSize,
}: {
  banner: Banner;
  disabled: boolean;
  readSize?: SizeReader;
}) {
  const replace = useReplaceBannerImage(banner.id);
  const [fraction, setFraction] = useState<number | null>(null);
  const [failure, setFailure] = useState<BannerUploadFailure | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { image } = banner;
  const busy = disabled || fraction !== null;

  async function take(file: File): Promise<void> {
    setFailure(null);
    const problem = await bannerProblem(file, readSize);
    if (problem) {
      setFailure({
        title: "This file cannot replace the picture",
        detail: `${file.name}: ${problem} The picture stays as it is.`,
      });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setFraction(0);
    try {
      await replace.mutateAsync({
        file,
        onProgress: setFraction,
        signal: controller.signal,
      });
      notify.success("Picture replaced", "Its description is kept.");
    } catch (error) {
      if (isSessionError(error)) return;
      setFailure(bannerUploadFailure(error));
    } finally {
      abort.current = null;
      setFraction(null);
    }
  }

  return (
    <section
      aria-label="Picture"
      className="flex flex-col gap-3 rounded-lg border border-line p-3.5"
    >
      <Preview banner={banner} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
            <dd className="text-ink tabular">{formatDate(image.uploadedAt)}</dd>
          </div>
        </dl>
        {!disabled ? (
          <Button
            size="sm"
            icon={<RefreshCw />}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Replace picture
          </Button>
        ) : null}
      </div>
      {!disabled ? (
        <p className="text-xs text-ink-subtle">{BANNER_RULES_TEXT}</p>
      ) : null}
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
        aria-label="Choose the new banner picture"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void take(file);
        }}
      />
    </section>
  );
}

function BannerForm({
  banner,
  onClose,
  onDirty,
  readSize,
}: {
  banner: Banner;
  onClose: () => void;
  /** Tells the dialog whether something was typed that is not saved yet. */
  onDirty: (dirty: boolean) => void;
  readSize?: SizeReader;
}) {
  const manage = useCan()("catalog.manage");
  const update = useUpdateBanner();
  const form = useZodForm(bannerSchema, {
    defaultValues: bannerDefaults(banner),
  });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const { onSubmit, state, pending } = useSubmit(
    form,
    async (values: BannerFormValues) => {
      const patch = toBannerPatch(values, banner);
      if (Object.keys(patch).length === 0) {
        notify.info("Nothing changed");
        onClose();
        return;
      }
      try {
        const saved = await update.mutateAsync({ id: banner.id, ...patch });
        notify.success(
          `${saved.name?.trim() || "Banner"} saved`,
          saved.status === "live"
            ? "It is in the shop."
            : saved.status === "scheduled"
              ? "It appears in the shop when its period starts."
              : saved.status === "expired"
                ? "Its period has ended: the shop does not show it."
                : "It is switched off: the shop does not show it.",
        );
        onClose();
      } catch (error) {
        // A documented refusal that belongs to one field is shown there.
        const field = bannerErrorField(error);
        if (!field) throw error;
        form.setError(
          field,
          { type: "server", message: errorMessage(error) },
          { shouldFocus: true },
        );
      }
    },
  );

  const active = form.watch("isActive");

  return (
    <form
      onSubmit={(event) => {
        event.stopPropagation();
        void onSubmit(event);
      }}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader
        title={banner.name?.trim() || "Banner"}
        description="Only what you change is saved. A new picture is uploaded at once; the shop follows within a minute."
      />
      <DialogBody>
        <Picture
          banner={banner}
          disabled={!manage || pending}
          readSize={readSize}
        />

        <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-4">
          <legend className="sr-only">Banner</legend>
          <TextField
            form={form}
            name="name"
            label="Name"
            optional
            maxLength={BANNER_RULES.nameMaxLength}
            hint="For this list only; the shop never shows it."
          />
          <TextField
            form={form}
            name="linkUrl"
            label="Link"
            optional
            inputMode="url"
            maxLength={BANNER_RULES.linkMaxLength}
            placeholder="/products/basmati-rice-1kg"
            hint="Where a click on the banner leads: a page of the shop as a path (/products/…, /categories/…), or an https:// address, which opens in a new tab. Empty: the banner has no link."
          />
          <SwitchField
            form={form}
            name="isActive"
            label={active ? "Switched on" : "Switched off"}
            disabled={!manage}
            hint="A switched-on banner is in the shop, inside its period if it has one. Switched off, it stays here for later."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <BerlinDateTimeField
              form={form}
              name="startsAt"
              label="Start"
              optional
              hint="German time. Empty: from now on."
            />
            <BerlinDateTimeField
              form={form}
              name="endsAt"
              label="End"
              optional
              hint="German time. Empty: no end. The end must come after the start."
            />
          </div>
          <BilingualField
            form={form}
            name="alt"
            label="Picture description (alt text)"
            multiline
            rows={2}
            maxLength={BANNER_RULES.altMaxLength}
            hint="Read out by screen readers and shown when the picture cannot load: say what the banner offers. At most 300 characters each."
          />
        </fieldset>
        <FormError state={state} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          {manage ? "Cancel" : "Close"}
        </Button>
        <ActionButton
          type="submit"
          permission="catalog.manage"
          variant="primary"
          size="lg"
          loading={pending}
        >
          Save changes
        </ActionButton>
      </DialogFooter>
    </form>
  );
}

/**
 * Creating and changing a banner in a dialog: a new one starts with its
 * picture and goes on with the form of the created banner; an existing
 * one opens with its form.
 */
export function BannerDialog({
  edit,
  banner,
  onClose,
  onCreated,
  readSize,
}: {
  /** `null` closes the dialog. */
  edit: BannerEdit | null;
  /** The banner being changed, as the list has it now. */
  banner: Banner | null;
  onClose: () => void;
  /** The created banner: the dialog goes on with its form. */
  onCreated: (banner: Banner) => void;
  /** How the size of a picture is read; tests have no decoder. */
  readSize?: SizeReader;
}) {
  // What was typed is not lost to a click next to the dialog.
  const dirty = useRef(false);
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  // The form stays while the dialog fades out.
  const [shown, setShown] = useState<{
    edit: BannerEdit;
    banner: Banner | null;
  } | null>(edit ? { edit, banner } : null);
  if (edit && (edit !== shown?.edit || banner !== shown.banner)) {
    setShown({ edit, banner });
  }

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
          if (dirty.current) event.preventDefault();
        }}
      >
        {shown?.edit.mode === "new" ? (
          <NewBanner
            onCreated={onCreated}
            onClose={onClose}
            readSize={readSize}
          />
        ) : shown?.banner ? (
          <BannerForm
            key={shown.banner.id}
            banner={shown.banner}
            onClose={onClose}
            onDirty={onDirty}
            readSize={readSize}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
