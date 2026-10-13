"use client";

import { AlertDialog as AlertPrimitive } from "radix-ui";
import { useId, useState, type ReactNode } from "react";
import { describeError } from "@/lib/api/error-text";
import { isSessionError } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Input } from "./input";
import { Alert, FactRows } from "./surface";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** What will happen, in a sentence or two. */
  description?: ReactNode;
  /** The real numbers of the action, restated before it runs. */
  facts?: { label: ReactNode; value: ReactNode; strong?: boolean }[];
  /** Extra inputs (a reason, a note) between the facts and the buttons. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for what destroys or cannot be undone. */
  tone?: "primary" | "danger";
  /**
   * The admin must type this text to enable the button: for the few
   * actions that would be costly by accident.
   */
  requireText?: string;
  /** `false` while the extra inputs are not valid. */
  canConfirm?: boolean;
  /**
   * Runs the action. The dialog waits, closes when it resolves, and stays
   * open with the error when it rejects.
   */
  onConfirm: () => Promise<unknown> | unknown;
  /** What helps with the error the action ended in (a link to where it is fixed). */
  errorHelp?: (error: unknown) => ReactNode;
}

/**
 * The confirmation of a destructive or money-moving action. It restates
 * what will happen with the real numbers, the keyboard focus starts on
 * "cancel", and Enter never confirms by accident.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  facts,
  children,
  confirmLabel,
  cancelLabel = "Not now",
  tone = "primary",
  requireText,
  canConfirm = true,
  onConfirm,
  errorHelp,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [typed, setTyped] = useState("");
  const typedId = useId();

  const typedMatches =
    !requireText || typed.trim().toUpperCase() === requireText.toUpperCase();

  function change(next: boolean) {
    if (pending) return;
    if (!next) {
      setError(null);
      setTyped("");
    }
    onOpenChange(next);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setTyped("");
      onOpenChange(false);
    } catch (caught) {
      if (!isSessionError(caught)) setError(caught);
    } finally {
      setPending(false);
    }
  }

  const notice = error ? describeError(error) : null;
  const help = error && errorHelp ? errorHelp(error) : null;

  return (
    <AlertPrimitive.Root open={open} onOpenChange={change}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <AlertPrimitive.Content
          className={cn(
            "fixed z-50 flex max-h-[calc(100dvh-1rem)] w-full flex-col gap-4 overflow-y-auto bg-surface p-5 shadow-float outline-none sm:p-6",
            "inset-x-0 bottom-0 rounded-t-2xl pb-safe sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-6",
            "data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
          )}
        >
          <div className="flex flex-col gap-1.5">
            <AlertPrimitive.Title className="font-display text-lg leading-snug text-ink">
              {title}
            </AlertPrimitive.Title>
            <AlertPrimitive.Description asChild>
              <div className="text-sm text-ink-muted">
                {description ?? "Check before you go on."}
              </div>
            </AlertPrimitive.Description>
          </div>

          {facts && facts.length > 0 ? <FactRows rows={facts} /> : null}
          {children}

          {requireText ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={typedId} className="text-13 text-ink-muted">
                Type{" "}
                <span className="font-semibold text-ink">{requireText}</span> to
                confirm
              </label>
              <Input
                id={typedId}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>
          ) : null}

          {notice ? (
            <Alert tone="danger" title={notice.message}>
              {help}
              {notice.technical || notice.requestId ? (
                <span className="block font-mono text-2xs break-all">
                  {notice.technical}
                  {notice.requestId ? ` · Request ${notice.requestId}` : ""}
                </span>
              ) : null}
            </Alert>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertPrimitive.Cancel asChild>
              <Button variant="ghost" size="lg" disabled={pending}>
                {cancelLabel}
              </Button>
            </AlertPrimitive.Cancel>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              size="lg"
              loading={pending}
              disabled={!canConfirm || !typedMatches}
              onClick={confirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}
