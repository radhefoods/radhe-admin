"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Copy, Star } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { describeError } from "@/lib/api/error-text";
import { hasErrorCode, isSessionError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import {
  IMAGE_LIMITS,
  type AdminImage,
  type Id,
  type ProductDetail,
  type ProductVariant,
} from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format/names";
import { useCopyImages } from "./queries";

/** One request of a copy: the pack size the pictures come from, and which. */
export interface CopyStep {
  fromVariantId: Id;
  imageIds: Id[];
}

/**
 * The requests that copy the ticked pictures (8): one per pack size they
 * come from. A picture the pack size shows already (the same `url`) is
 * left out, and a file ticked under two pack sizes is copied once.
 */
export function copySteps(
  others: readonly Pick<ProductVariant, "id" | "images">[],
  shown: ReadonlySet<string>,
  ticked: ReadonlySet<Id>,
): CopyStep[] {
  const taken = new Set(shown);
  const steps: CopyStep[] = [];
  for (const other of others) {
    const imageIds: Id[] = [];
    for (const image of other.images) {
      if (!ticked.has(image.id) || taken.has(image.url)) continue;
      taken.add(image.url);
      imageIds.push(image.id);
    }
    if (imageIds.length > 0) steps.push({ fromVariantId: other.id, imageIds });
  }
  return steps;
}

function Thumb({
  image,
  name,
  checked,
  here,
  disabled,
  onChange,
}: {
  image: AdminImage;
  /** "picture 2 of 1 kg". */
  name: string;
  checked: boolean;
  /** The pack size shows this picture already. */
  here: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <label
        className={cn(
          "relative block aspect-square overflow-hidden rounded-md border border-line bg-sunken",
          here || disabled ? "cursor-not-allowed" : "cursor-pointer",
          checked && !here && "ring-2 ring-accent",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
        <img
          src={image.sizes.small.url}
          alt={image.alt?.en?.trim() || ""}
          width={image.sizes.small.width}
          height={image.sizes.small.height}
          loading="lazy"
          decoding="async"
          className={cn("size-full object-cover", here && "opacity-60")}
        />
        <Checkbox
          checked={checked || here}
          disabled={here || disabled}
          onCheckedChange={(next) => onChange(next === true)}
          aria-label={here ? `${name}, shown here already` : `Copy ${name}`}
          className="absolute top-1 left-1 bg-surface"
        />
        {image.isPrimary ? (
          <Badge
            tone="neutral"
            dot={false}
            className="absolute right-1 bottom-1 h-5 gap-1 px-1.5 shadow-card"
          >
            <Star aria-hidden="true" className="size-3 fill-current" />
            Main
          </Badge>
        ) : null}
      </label>
      {here ? (
        <span className="text-xs text-ink-subtle">Shown here already</span>
      ) : null}
    </li>
  );
}

/**
 * "Copy from another pack size" (8, doc/VARIANT_IMAGES.md): the other pack
 * sizes of the product with their pictures as thumbnails to tick. The
 * pictures appear on this pack size too; no file is stored twice, and each
 * pack size keeps its own order, main picture and descriptions.
 */
export function CopyPictures({
  product,
  variant,
}: {
  product: ProductDetail;
  /** The pack size that takes the pictures. */
  variant: ProductVariant;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Copy pictures from another pack size to ${variant.packSize.label}`}
      >
        <Copy />
        Copy from another pack size
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          {open ? (
            <CopyForm
              product={product}
              variant={variant}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CopyForm({
  product,
  variant,
  onClose,
}: {
  product: ProductDetail;
  variant: ProductVariant;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const copy = useCopyImages(product.id, variant.id);
  const [ticked, setTicked] = useState<ReadonlySet<Id>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const label = variant.packSize.label;
  const others = product.variants.filter((entry) => entry.id !== variant.id);
  const shown = new Set(variant.images.map((image) => image.url));
  const room = Math.max(0, IMAGE_LIMITS.variant - variant.images.length);
  const steps = copySteps(others, shown, ticked);
  const count = steps.reduce((sum, step) => sum + step.imageIds.length, 0);
  const anything = others.some((entry) => entry.images.length > 0);
  const tooMany = count > room;

  function tick(ids: Id[], on: boolean): void {
    setTicked((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function run(): Promise<void> {
    setPending(true);
    setError(null);
    let copied = 0;
    try {
      for (const step of steps) {
        await copy.mutateAsync(step);
        copied += step.imageIds.length;
      }
      notify.success(
        `${plural(copied, "picture")} copied to ${label}`,
        "They are at the end of its pictures. No file was stored twice.",
      );
      onClose();
    } catch (caught) {
      if (isSessionError(caught)) return;
      setError(caught);
      // What the dialog shows is no longer what the API has: look again.
      if (
        hasErrorCode(
          caught,
          "IMAGE_NOT_FOUND",
          "IMAGE_ORDER_INVALID",
          "IMAGE_LIMIT_REACHED",
          "PRODUCT_VARIANT_NOT_FOUND",
          "PRODUCT_NOT_FOUND",
        )
      ) {
        setTicked(new Set());
        void client.invalidateQueries({
          queryKey: queryKeys.products.detail(product.id),
        });
      }
    } finally {
      setPending(false);
    }
  }

  const notice = error ? describeError(error) : null;

  return (
    <>
      <DialogHeader
        title={`Copy pictures to ${label}`}
        description="Pictures of the other pack sizes can be shown here too. No file is stored twice, and each pack size keeps its own order, main picture and descriptions: deleting or replacing a picture here later leaves the other pack size as it is."
      />
      <DialogBody>
        {anything ? (
          others.map((other) => {
            const free = other.images.filter((image) => !shown.has(image.url));
            const all =
              free.length > 0 && free.every((image) => ticked.has(image.id));
            return (
              <section
                key={other.id}
                aria-label={`Pictures of ${other.packSize.label}`}
                className="glass-inset flex flex-col gap-2.5 rounded-lg p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {other.packSize.label}
                    <span className="ml-2 text-13 font-normal text-ink-muted tabular">
                      {other.sku} · {plural(other.images.length, "picture")}
                    </span>
                  </p>
                  {free.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        tick(
                          free.map((image) => image.id),
                          !all,
                        )
                      }
                    >
                      {all ? "Untick all" : "Tick all"}
                    </Button>
                  ) : null}
                </div>
                {other.images.length > 0 ? (
                  <ul className="grid grid-cols-3 gap-2.5 xs:grid-cols-4 sm:grid-cols-6">
                    {other.images.map((image, index) => (
                      <Thumb
                        key={image.id}
                        image={image}
                        name={`picture ${index + 1} of ${other.packSize.label}`}
                        checked={ticked.has(image.id)}
                        here={shown.has(image.url)}
                        disabled={pending}
                        onChange={(on) => tick([image.id], on)}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-13 text-ink-muted">No pictures.</p>
                )}
              </section>
            );
          })
        ) : (
          <p className="text-sm text-ink-muted">
            No other pack size of this product has a picture yet. Upload
            pictures to one of them first; they can then be copied here.
          </p>
        )}
        {anything ? (
          <p
            aria-live="polite"
            className={cn(
              "text-13",
              tooMany ? "font-medium text-danger-fg" : "text-ink-muted",
            )}
          >
            {room === 0
              ? `${label} holds ${IMAGE_LIMITS.variant} pictures already, the most it can. Delete one there first.`
              : tooMany
                ? `There is room for ${plural(room, "more picture")} on ${label}, and ${count} are ticked.`
                : `${label} has ${plural(variant.images.length, "picture")}; there is room for ${room} more.`}
          </p>
        ) : null}
        {notice ? (
          <Alert tone="danger" title={notice.message}>
            {hasErrorCode(
              error,
              "IMAGE_NOT_FOUND",
              "IMAGE_ORDER_INVALID",
              "IMAGE_LIMIT_REACHED",
            )
              ? "The pictures changed in the meantime. The dialog shows them as they are now: tick again."
              : null}
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>
          {anything ? "Cancel" : "Close"}
        </Button>
        {anything ? (
          <Button
            variant="primary"
            size="lg"
            loading={pending}
            disabled={count === 0 || tooMany}
            onClick={() => void run()}
          >
            {count === 0 ? "Copy" : `Copy ${plural(count, "picture")}`}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}
