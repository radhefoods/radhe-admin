"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import type { ImageSizes } from "@/lib/api/types";

export interface Picture {
  sizes: ImageSizes;
  /** The caption: "Photo 2 of 3". */
  title: string;
  alt?: string;
}

/**
 * A picture of the API at full size, in the page. The thumbnails stay
 * where they are; this opens the large size the API made, with a way out
 * to a tab for the original.
 */
export function PictureDialog({
  picture,
  onOpenChange,
}: {
  picture: Picture | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={picture !== null} onOpenChange={onOpenChange}>
      <DialogContent size="xl" aria-describedby={undefined}>
        {picture ? (
          <>
            <DialogHeader
              title={picture.title}
              description={`${picture.sizes.large.width} × ${picture.sizes.large.height} px`}
            />
            <DialogBody className="items-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes */}
              <img
                src={picture.sizes.large.url}
                alt={picture.alt ?? picture.title}
                width={picture.sizes.large.width}
                height={picture.sizes.large.height}
                className="max-h-[70dvh] w-auto max-w-full rounded-md border border-line bg-sunken object-contain"
              />
            </DialogBody>
            <DialogFooter>
              <Button asChild size="sm">
                <a
                  href={picture.sizes.large.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink aria-hidden="true" />
                  Open in a new tab
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
