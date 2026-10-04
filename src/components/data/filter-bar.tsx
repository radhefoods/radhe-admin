"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks/use-debounced";

/** The row above a list: search first, then the filters the API offers. */
export function FilterBar({
  children,
  onClear,
  active,
  className,
}: {
  children: ReactNode;
  /** Shown when at least one filter is set. */
  onClear?: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      role="search"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {children}
      {active && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="h-8 rounded-md px-2 text-13 font-medium text-ink-muted hover:bg-sunken hover:text-ink"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

/**
 * One filter as a chip. Not set, it names what can be filtered; set, it
 * shows the choice and can be cleared with its own button.
 */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T | undefined;
  options: readonly FilterOption<T>[];
  onChange: (value: T | undefined) => void;
  className?: string;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <div
      className={cn(
        "flex h-8 items-center rounded-md border text-13 font-medium",
        current
          ? "border-transparent bg-accent-soft text-accent-text"
          : "border-line bg-surface text-ink-muted hover:border-line-strong",
        className,
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex h-full items-center gap-1.5 rounded-md pl-2.5",
            current ? "pr-1.5" : "pr-2",
          )}
        >
          <span>{label}</span>
          {current ? (
            <span className="font-semibold">{current.label}</span>
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
            >
              {option.label}
              {option.value === value ? (
                <Check className="ml-auto text-accent-text" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {current ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          aria-label={`Remove the filter ${label}`}
          className="mr-1 flex size-5 items-center justify-center rounded-sm hover:bg-planned-bg"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A search field that writes its value a moment after the typing stops.
 * A text shorter than what the API accepts is not sent.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  minLength = 0,
  hint,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** For screen readers; the placeholder is not a label. */
  label: string;
  placeholder: string;
  minLength?: number;
  /** What is searched, under the field while typing too little. */
  hint?: string;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  const debounced = useDebounced(text, 300);

  // The address changed from elsewhere (back button, "clear all").
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the address
    setText(value);
  }, [value]);

  useEffect(() => {
    const next = debounced.trim();
    if (next === value) return;
    if (next !== "" && next.length < minLength) return;
    onChange(next);
    // Only the settled text triggers a search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const tooShort = text.trim() !== "" && text.trim().length < minLength;

  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-2 left-2.5 size-4 text-ink-subtle"
      />
      <input
        id={id}
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={tooShort && hint ? `${id}-hint` : undefined}
        className="h-8 w-full rounded-md border border-line bg-surface pr-8 pl-8 text-13 text-ink placeholder:text-ink-subtle hover:border-line-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 [&::-webkit-search-cancel-button]:hidden"
      />
      {text ? (
        <button
          type="button"
          onClick={() => {
            setText("");
            onChange("");
          }}
          aria-label="Clear the search"
          className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-sm text-ink-subtle hover:bg-sunken hover:text-ink"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      {tooShort && hint ? (
        <p id={`${id}-hint`} className="absolute mt-1 text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
