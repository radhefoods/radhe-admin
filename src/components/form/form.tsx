"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  get,
  useForm,
  type FieldPath,
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";
import { describeError } from "@/lib/api/error-text";
import { fieldProblems, isSessionError } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import { Input, PasswordInput, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/surface";

// --- A labelled field -------------------------------------------------------

interface FieldIds {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldIds | null>(null);

/** The ids a control inside a `Field` wires itself up with. */
export function useFieldIds(): FieldIds | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** A sentence under the label: what is expected, in what format. */
  hint?: ReactNode;
  error?: string | null;
  /** Marks the label; the control itself carries `required` where it applies. */
  required?: boolean;
  optional?: boolean;
  /** Something right of the label (a language tag, a counter). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
  /** When the control has its own id. */
  htmlFor?: string;
}

/**
 * A label, its control, a hint and the error of the field. The error is
 * tied to the control (`aria-describedby`), so a screen reader reads it
 * with the field.
 */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  aside,
  className,
  children,
  htmlFor,
}: FieldProps) {
  const generated = useId();
  const controlId = htmlFor ?? `${generated}-control`;
  const hintId = hint ? `${generated}-hint` : undefined;
  const errorId = error ? `${generated}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider
      value={{ controlId, describedBy, invalid: Boolean(error) }}
    >
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={controlId} className="text-13 font-medium text-ink">
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-0.5 text-danger-fg">
                *
              </span>
            ) : null}
            {optional ? (
              <span className="ml-1.5 font-normal text-ink-subtle">
                optional
              </span>
            ) : null}
          </label>
          {aside}
        </div>
        {children}
        {error ? (
          <p id={errorId} className="text-13 text-danger-fg">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-13 text-ink-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** The attributes that tie a control to its `Field`. */
export function useControlProps(): {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
} {
  const ids = useFieldIds();
  if (!ids) return {};
  return {
    id: ids.controlId,
    "aria-describedby": ids.describedBy,
    "aria-invalid": ids.invalid ? true : undefined,
  };
}

// --- react-hook-form with zod -----------------------------------------------

/**
 * A form whose rules are a zod schema that mirrors the API's validation.
 * Fields are checked when they are left, and again on every change once
 * they were wrong.
 */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  options?: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, "resolver">,
): UseFormReturn<z.input<S>, unknown, z.output<S>> {
  return useForm<z.input<S>, unknown, z.output<S>>({
    // The resolver's own generics do not follow a schema type parameter.
    resolver: zodResolver(schema) as unknown as Resolver<
      z.input<S>,
      unknown,
      z.output<S>
    >,
    mode: "onTouched",
    ...options,
  });
}

/**
 * Puts the field errors of a `VALIDATION_FAILED` answer at their fields
 * (`details[].field`). `aliases` maps a field of the API to the field of
 * the form when they are named differently. Returns the problems that
 * belong to no field of the form.
 */
export function applyFieldErrors<T extends FieldValues>(
  form: UseFormReturn<T, unknown, FieldValues>,
  error: unknown,
  aliases: Record<string, string> = {},
): Record<string, string[]> {
  const unplaced: Record<string, string[]> = {};
  const values = form.getValues();
  let focused = false;
  for (const [apiField, problems] of Object.entries(fieldProblems(error))) {
    const name = aliases[apiField] ?? apiField;
    const known =
      get(values, name) !== undefined ||
      form.getFieldState(name as FieldPath<T>).isTouched ||
      name in (form.control._fields as Record<string, unknown>);
    if (!known) {
      unplaced[apiField] = problems;
      continue;
    }
    form.setError(
      name as FieldPath<T>,
      { type: "server", message: sentence(problems) },
      { shouldFocus: !focused },
    );
    focused = true;
  }
  return unplaced;
}

function sentence(problems: string[]): string {
  const text = problems.join(". ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface SubmitState {
  /** The error to show above the buttons, if any. */
  error: unknown;
  /** Field problems of the API that have no field in this form. */
  unplaced: Record<string, string[]>;
}

/**
 * Runs the action of a form and sorts what the API refuses: field errors
 * go to their fields, everything else is returned for `FormError`.
 */
export function useSubmit<T extends FieldValues, O extends FieldValues>(
  form: UseFormReturn<T, unknown, O>,
  action: (values: O) => Promise<unknown>,
  options: { aliases?: Record<string, string> } = {},
) {
  const [state, setState] = useState<SubmitState | null>(null);
  const { aliases } = options;

  const submit = useCallback(
    async (values: O) => {
      setState(null);
      try {
        await action(values);
      } catch (error) {
        if (isSessionError(error)) return;
        const unplaced = applyFieldErrors(
          form as unknown as UseFormReturn<T, unknown, FieldValues>,
          error,
          aliases,
        );
        const everythingPlaced =
          Object.keys(fieldProblems(error)).length > 0 &&
          Object.keys(unplaced).length === 0;
        setState(everythingPlaced ? null : { error, unplaced });
      }
    },
    [action, aliases, form],
  );

  return {
    onSubmit: form.handleSubmit(submit),
    state,
    reset: () => setState(null),
    pending: form.formState.isSubmitting,
  };
}

/** What the API refused and no field could show. */
export function FormError({
  state,
  className,
}: {
  state: SubmitState | null;
  className?: string;
}) {
  if (!state) return null;
  const notice = describeError(state.error);
  const unplaced = Object.entries(state.unplaced);
  return (
    <Alert tone="danger" title={notice.message} className={className}>
      {unplaced.length > 0 ? (
        <ul className="list-disc pl-4">
          {unplaced.map(([field, problems]) => (
            <li key={field}>
              <span className="font-mono text-xs">{field}</span>:{" "}
              {problems.join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
      {notice.technical || notice.requestId ? (
        <span className="font-mono text-2xs break-all">
          {notice.technical}
          {notice.requestId ? ` · Request ${notice.requestId}` : ""}
        </span>
      ) : null}
    </Alert>
  );
}

// --- Fields bound to a form -------------------------------------------------

interface BoundProps<T extends FieldValues> {
  form: UseFormReturn<T, unknown, FieldValues>;
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  optional?: boolean;
  aside?: ReactNode;
  fieldClassName?: string;
}

function messageOf<T extends FieldValues>(
  form: UseFormReturn<T, unknown, FieldValues>,
  name: FieldPath<T>,
): string | null {
  const error = get(form.formState.errors, name) as
    { message?: unknown } | undefined;
  return typeof error?.message === "string" ? error.message : null;
}

function Bound({
  children,
}: {
  children: (props: ReturnType<typeof useControlProps>) => ReactNode;
}) {
  return <>{children(useControlProps())}</>;
}

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  optional,
  aside,
  fieldClassName,
  type,
  ...input
}: BoundProps<T> & Omit<ComponentProps<"input">, "name" | "form">) {
  return (
    <Field
      label={label}
      hint={hint}
      required={required}
      optional={optional}
      aside={aside}
      error={messageOf(form, name)}
      className={fieldClassName}
    >
      <Bound>
        {(control) =>
          type === "password" ? (
            <PasswordInput {...control} {...input} {...form.register(name)} />
          ) : (
            <Input
              type={type}
              {...control}
              {...input}
              {...form.register(name)}
            />
          )
        }
      </Bound>
    </Field>
  );
}

export function TextareaField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  optional,
  aside,
  fieldClassName,
  ...textarea
}: BoundProps<T> & Omit<ComponentProps<"textarea">, "name" | "form">) {
  return (
    <Field
      label={label}
      hint={hint}
      required={required}
      optional={optional}
      aside={aside}
      error={messageOf(form, name)}
      className={fieldClassName}
    >
      <Bound>
        {(control) => (
          <Textarea {...control} {...textarea} {...form.register(name)} />
        )}
      </Bound>
    </Field>
  );
}

export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  optional,
  aside,
  fieldClassName,
  children,
  ...select
}: BoundProps<T> & Omit<ComponentProps<"select">, "name" | "form">) {
  return (
    <Field
      label={label}
      hint={hint}
      required={required}
      optional={optional}
      aside={aside}
      error={messageOf(form, name)}
      className={fieldClassName}
    >
      <Bound>
        {(control) => (
          <Select {...control} {...select} {...form.register(name)}>
            {children}
          </Select>
        )}
      </Bound>
    </Field>
  );
}

export { messageOf as fieldMessage };
