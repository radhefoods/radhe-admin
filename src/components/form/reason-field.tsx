"use client";

import type { ComponentProps, ReactNode } from "react";
import { Field, useControlProps } from "@/components/form/form";
import { Textarea } from "@/components/ui/input";

function Control(props: ComponentProps<typeof Textarea>) {
  return <Textarea {...useControlProps()} {...props} />;
}

/**
 * The reason or note of a confirmation: a labelled text with its limit in
 * view. For the extra inputs of a `ConfirmDialog`, which holds them as
 * plain state.
 */
export function ReasonField({
  label,
  value,
  onChange,
  maxLength,
  required = false,
  hint,
  error,
  rows = 3,
  placeholder,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** The API's limit; typing stops there. */
  maxLength: number;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Field
      label={label}
      required={required}
      optional={!required}
      hint={hint}
      error={error}
      aside={
        <span className="text-xs text-ink-subtle tabular">
          <span className="sr-only">Characters used: </span>
          {value.length.toLocaleString("en")} / {maxLength.toLocaleString("en")}
        </span>
      }
    >
      <Control
        rows={rows}
        value={value}
        maxLength={maxLength}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-0"
      />
    </Field>
  );
}
