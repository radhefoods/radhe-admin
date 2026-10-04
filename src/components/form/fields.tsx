"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Controller,
  get,
  useWatch,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, Switch } from "@/components/ui/controls";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Field, useControlProps } from "./form";

type AnyForm<T extends FieldValues> = UseFormReturn<T, unknown, FieldValues>;

function messageOf<T extends FieldValues>(
  form: AnyForm<T>,
  name: string,
): string | null {
  const error = get(form.formState.errors, name) as
    { message?: unknown } | undefined;
  return typeof error?.message === "string" ? error.message : null;
}

interface BoundProps<T extends FieldValues> {
  form: AnyForm<T>;
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  optional?: boolean;
  fieldClassName?: string;
}

function Wired({
  children,
}: {
  children: (props: ReturnType<typeof useControlProps>) => ReactNode;
}) {
  return <>{children(useControlProps())}</>;
}

/** A euro amount. The form holds what was typed; the schema makes cents of it. */
export function MoneyField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  optional,
  fieldClassName,
  ...input
}: BoundProps<T> & Omit<ComponentProps<"input">, "name" | "form" | "type">) {
  return (
    <Field
      label={label}
      hint={hint}
      required={required}
      optional={optional}
      error={messageOf(form, name)}
      className={fieldClassName}
    >
      <Wired>
        {(control) => (
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
            >
              €
            </span>
            <Input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="pl-7 tabular"
              {...control}
              {...input}
              {...form.register(name)}
            />
          </div>
        )}
      </Wired>
    </Field>
  );
}

/** A number with a unit after it (`%`, `days`, `kg`). */
export function UnitField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  optional,
  fieldClassName,
  unit,
  decimal = false,
  ...input
}: BoundProps<T> &
  Omit<ComponentProps<"input">, "name" | "form" | "type"> & {
    unit?: string;
    decimal?: boolean;
  }) {
  return (
    <Field
      label={label}
      hint={hint}
      required={required}
      optional={optional}
      error={messageOf(form, name)}
      className={fieldClassName}
    >
      <Wired>
        {(control) => (
          <div className="relative">
            <Input
              inputMode={decimal ? "decimal" : "numeric"}
              autoComplete="off"
              className={cn("tabular", unit && "pr-14")}
              {...control}
              {...input}
              {...form.register(name)}
            />
            {unit ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-13 text-ink-subtle"
              >
                {unit}
              </span>
            ) : null}
          </div>
        )}
      </Wired>
    </Field>
  );
}

/**
 * A date and time, typed and read as German time whatever the device is
 * set to (the business thinks in Europe/Berlin).
 */
export function BerlinDateTimeField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  optional,
  fieldClassName,
  ...input
}: BoundProps<T> & Omit<ComponentProps<"input">, "name" | "form" | "type">) {
  return (
    <Field
      label={label}
      hint={hint ?? "German time."}
      required={required}
      optional={optional}
      error={messageOf(form, name)}
      className={fieldClassName}
    >
      <Wired>
        {(control) => (
          <Input
            type="datetime-local"
            className="tabular"
            {...control}
            {...input}
            {...form.register(name)}
          />
        )}
      </Wired>
    </Field>
  );
}

export function DayField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  optional,
  fieldClassName,
  ...input
}: BoundProps<T> & Omit<ComponentProps<"input">, "name" | "form" | "type">) {
  return (
    <Field
      label={label}
      hint={hint}
      required={required}
      optional={optional}
      error={messageOf(form, name)}
      className={fieldClassName}
    >
      <Wired>
        {(control) => (
          <Input
            type="date"
            className="tabular"
            {...control}
            {...input}
            {...form.register(name)}
          />
        )}
      </Wired>
    </Field>
  );
}

/** A switch with its label and an explanation next to it. */
export function SwitchField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  disabled,
  className,
}: {
  form: AnyForm<T>;
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Switch
            id={id}
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            disabled={disabled}
            aria-describedby={hint ? `${id}-hint` : undefined}
            className="mt-0.5"
          />
        )}
      />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-13 text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CheckboxField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  disabled,
  className,
}: {
  form: AnyForm<T>;
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Checkbox
            id={id}
            checked={Boolean(field.value)}
            onCheckedChange={(checked) => field.onChange(checked === true)}
            onBlur={field.onBlur}
            ref={field.ref}
            disabled={disabled}
            aria-describedby={hint ? `${id}-hint` : undefined}
            className="mt-0.5"
          />
        )}
      />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-13 text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// --- Content in both languages ----------------------------------------------

const LANGUAGES = [
  { key: "en", tag: "EN", name: "English" },
  { key: "de", tag: "DE", name: "German" },
] as const;

/**
 * A field that exists in English and German, side by side. English is the
 * fallback of the shop, so it is the required one; a language that is
 * still empty while the other is filled is marked.
 */
export function BilingualField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  requiredEn = false,
  multiline = false,
  rows = 3,
  maxLength,
  mono = false,
  className,
}: {
  form: AnyForm<T>;
  /** The object with `en` and `de`. */
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  requiredEn?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  /** A fixed-width face, for Markdown. */
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  const value = useWatch({ control: form.control, name }) as
    { en?: string; de?: string } | undefined;
  const filled = {
    en: Boolean(value?.en?.trim()),
    de: Boolean(value?.de?.trim()),
  };
  const missing = LANGUAGES.filter(
    (language) => !filled[language.key] && (filled.en || filled.de),
  );

  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="float-left text-13 font-medium text-ink">
          {label}
          {requiredEn ? (
            <span aria-hidden="true" className="ml-0.5 text-danger-fg">
              *
            </span>
          ) : null}
        </legend>
        {missing.map((language) => (
          <Badge key={language.key} tone="attention">
            {language.name} is missing
          </Badge>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {LANGUAGES.map((language) => {
          const path = `${name}.${language.key}` as FieldPath<T>;
          const error = messageOf(form, path);
          const controlId = `${id}-${language.key}`;
          const shared = {
            id: controlId,
            lang: language.key,
            maxLength,
            "aria-invalid": error ? (true as const) : undefined,
            "aria-describedby": error
              ? `${controlId}-error`
              : hint
                ? `${id}-hint`
                : undefined,
            "aria-required":
              requiredEn && language.key === "en" ? (true as const) : undefined,
            ...form.register(path),
          };
          return (
            <div key={language.key} className="flex min-w-0 flex-col gap-1">
              <div className="relative">
                <label
                  htmlFor={controlId}
                  className="absolute top-2 left-2.5 z-[1] rounded-xs bg-sunken px-1 text-2xs font-semibold tracking-wide text-ink-muted"
                >
                  {language.tag}{" "}
                  <span className="sr-only">{language.name}</span>
                </label>
                {multiline ? (
                  <Textarea
                    rows={rows}
                    className={cn("pt-2 pl-11", mono && "font-mono text-13")}
                    {...shared}
                  />
                ) : (
                  <Input className="pl-11" {...shared} />
                )}
              </div>
              {error ? (
                <p id={`${controlId}-error`} className="text-13 text-danger-fg">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-13 text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}

// --- Unsaved changes ---------------------------------------------------------

/**
 * Stops the admin from losing a half-filled form: closing the tab asks,
 * and so does a link inside the panel.
 */
export function UnsavedGuard({ when }: { when: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!when) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [when]);

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title="Leave without saving?"
      description="The changes on this page are not saved yet. They are lost when you leave."
      confirmLabel="Leave the page"
      cancelLabel="Stay"
      tone="danger"
      onConfirm={() => {
        if (pending) router.push(pending as Route);
      }}
    />
  );
}
