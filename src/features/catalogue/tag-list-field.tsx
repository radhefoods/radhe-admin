"use client";

import { X } from "lucide-react";
import {
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Controller,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { Field, fieldMessage, useControlProps } from "@/components/form/form";
import { cn } from "@/lib/cn";

/**
 * A list of short texts (tags, search words) typed one after the other:
 * Enter or a comma adds what was typed, Backspace in the empty field takes
 * the last entry away, and every entry has its own remove button.
 */
export function TagListField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  max,
  noun,
  placeholder,
  normalize = (text) => text.trim(),
  accepts = () => true,
  disabled = false,
}: {
  form: UseFormReturn<T, unknown, FieldValues>;
  /** A field that holds `string[]`. */
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  /** How many entries the API takes. */
  max: number;
  /** What one entry is called: "tag". */
  noun: string;
  placeholder?: string;
  /** Makes of the typed text what the API accepts (`Gluten Free` to `gluten-free`). */
  normalize?: (text: string) => string;
  /** An entry that does not pass is not added. */
  accepts?: (entry: string) => boolean;
  disabled?: boolean;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => {
        const entries = Array.isArray(field.value)
          ? (field.value as string[])
          : [];
        return (
          <Field
            label={label}
            hint={hint}
            error={fieldMessage(form, name)}
            aside={
              <span className="text-xs text-ink-subtle tabular">
                {entries.length} of {max}
              </span>
            }
          >
            <Entries
              entries={entries}
              max={max}
              noun={noun}
              placeholder={placeholder}
              normalize={normalize}
              accepts={accepts}
              disabled={disabled}
              onChange={(next) => field.onChange(next)}
              onBlur={field.onBlur}
              inputRef={field.ref}
            />
          </Field>
        );
      }}
    />
  );
}

function Entries({
  entries,
  max,
  noun,
  placeholder,
  normalize,
  accepts,
  disabled,
  onChange,
  onBlur,
  inputRef,
}: {
  entries: string[];
  max: number;
  noun: string;
  placeholder?: string;
  normalize: (text: string) => string;
  accepts: (entry: string) => boolean;
  disabled: boolean;
  onChange: (entries: string[]) => void;
  onBlur: () => void;
  inputRef: (node: HTMLInputElement | null) => void;
}) {
  const control = useControlProps();
  const [text, setText] = useState("");
  const full = entries.length >= max;

  function add(raw: string): void {
    const next = [...entries];
    for (const part of raw.split(/[,;\n]+/)) {
      const entry = normalize(part);
      if (!entry || !accepts(entry) || next.length >= max) continue;
      if (
        next.some((existing) => existing.toLowerCase() === entry.toLowerCase())
      )
        continue;
      next.push(entry);
    }
    if (next.length !== entries.length) onChange(next);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      // Enter adds the entry; it never sends the form from here.
      event.preventDefault();
      if (text.trim()) add(text);
    } else if (event.key === "Backspace" && text === "" && entries.length > 0) {
      onChange(entries.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>): void {
    const pasted = event.clipboardData.getData("text");
    if (!/[,;\n]/.test(pasted)) return;
    event.preventDefault();
    add(`${text}${pasted}`);
  }

  return (
    <div
      className={cn(
        "flex min-h-[34px] w-full flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-1.5 py-1 shadow-card transition-[border-color]",
        "focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent hover:border-ink-subtle",
        control["aria-invalid"] && "border-danger-dot",
        disabled && "bg-sunken",
      )}
    >
      {entries.map((entry) => (
        <span
          key={entry}
          className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-sm bg-neutral-bg pr-0.5 pl-2 text-13 font-medium text-neutral-fg"
        >
          <span className="truncate">{entry}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onChange(entries.filter((existing) => existing !== entry))
            }
            aria-label={`Remove the ${noun} ${entry}`}
            className="flex size-5 shrink-0 items-center justify-center rounded-xs hover:bg-line-strong hover:text-ink disabled:hidden"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <input
        {...control}
        ref={inputRef}
        value={text}
        disabled={disabled || full}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => {
          if (text.trim()) add(text);
          onBlur();
        }}
        placeholder={
          full
            ? `${max} of ${max}: remove one to add another`
            : entries.length === 0
              ? placeholder
              : undefined
        }
        autoComplete="off"
        spellCheck={false}
        className="h-6 min-w-24 flex-1 bg-transparent px-1.5 text-sm text-ink outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed"
      />
    </div>
  );
}
