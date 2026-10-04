"use client";

import type { FormEventHandler, ReactNode } from "react";
import { ActionButton } from "@/components/domain/permission";
import { FormError, type SubmitState } from "@/components/form/form";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";

/**
 * The fields of a form that only some admins may change: without the
 * permission they are locked, and still easy to read.
 */
export function LockableFields({
  locked,
  className,
  children,
}: {
  locked: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      disabled={locked}
      className={cn(
        "flex min-w-0 flex-col gap-5",
        "[&_input:disabled]:text-ink-muted [&_select:disabled]:text-ink-muted [&_textarea:disabled]:text-ink-muted",
        className,
      )}
    >
      {children}
    </fieldset>
  );
}

/**
 * One setting: its control with the short rule under it, and next to it
 * what the setting does. On a narrow screen the explanation moves below.
 */
export function SettingRow({
  explanation,
  children,
}: {
  explanation: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-8 gap-y-2 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      {children}
      <div className="text-13 text-ink-muted md:pt-[26px]">{explanation}</div>
    </div>
  );
}

/**
 * One group of the shop settings: its own form with its own save, because
 * the API replaces one group per request.
 */
export function SettingsFormCard({
  title,
  description,
  onSubmit,
  state,
  pending,
  dirty,
  saveLabel,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  state: SubmitState | null;
  pending: boolean;
  /** Something was changed and is not saved yet. */
  dirty: boolean;
  /** What the button does: "Save the company details". */
  saveLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const manage = useCan()("settings.manage");
  return (
    <Card className={className}>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader title={title} description={description} />
        <CardBody className="flex flex-col gap-5">
          <LockableFields locked={!manage}>{children}</LockableFields>
          <FormError state={state} />
        </CardBody>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-3 sm:px-5">
          <p className="text-13 text-ink-subtle" aria-live="polite">
            {!manage
              ? "Your role can read the settings, not change them."
              : dirty
                ? "Changes are not saved yet."
                : "No unsaved changes."}
          </p>
          <ActionButton
            permission="settings.manage"
            type="submit"
            variant="primary"
            loading={pending}
            disabled={!dirty}
          >
            {saveLabel}
          </ActionButton>
        </div>
      </form>
    </Card>
  );
}
