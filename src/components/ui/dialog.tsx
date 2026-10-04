"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass =
  "fixed inset-0 z-50 bg-scrim data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out";

const sizes = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
} as const;

export interface DialogContentProps extends ComponentProps<
  typeof DialogPrimitive.Content
> {
  size?: keyof typeof sizes;
  /** Hides the close button (a dialog that must be answered). */
  hideClose?: boolean;
}

/**
 * A dialog in the middle of the screen; on a phone it rises from the bottom
 * edge, where the thumb is.
 */
export function DialogContent({
  className,
  children,
  size = "md",
  hideClose = false,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex max-h-[calc(100dvh-1rem)] w-full flex-col bg-surface shadow-float outline-none",
          "inset-x-0 bottom-0 rounded-t-2xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[calc(100dvh-4rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          "data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute top-3.5 right-3.5 flex size-8 items-center justify-center rounded-md text-ink-subtle hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 px-5 pt-5 pr-14 sm:px-6", className)}
    >
      <DialogPrimitive.Title className="font-display text-2xl leading-tight text-ink">
        {title}
      </DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="text-sm text-ink-muted">
          {description}
        </DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="sr-only">
          {typeof title === "string" ? title : "Dialog"}
        </DialogPrimitive.Description>
      )}
    </div>
  );
}

/** The part of a dialog that scrolls when its content is long. */
export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 sm:px-6",
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-line px-5 pt-3.5 pb-safe sm:flex-row sm:justify-end sm:px-6 sm:pb-4",
        className,
      )}
      {...props}
    />
  );
}

// --- A panel from the right edge, for looking at one record ------------------

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  side?: "left" | "right";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-full max-w-[min(100vw,32rem)] flex-col bg-surface shadow-float outline-none",
          side === "right"
            ? "right-0 data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in"
            : "left-0 data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
