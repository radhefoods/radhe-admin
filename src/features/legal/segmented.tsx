"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A choice between a few views of the same thing (a language, a layout),
 * as buttons in one frame. The chosen one is pressed.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** What is chosen, for screen readers: "Language". */
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-13 font-medium whitespace-nowrap transition-colors",
              pressed
                ? "bg-surface text-ink shadow-card"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
