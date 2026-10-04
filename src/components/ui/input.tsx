"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export const controlClass = cn(
  "w-full rounded-md border border-line-strong bg-surface text-ink shadow-card",
  "placeholder:text-ink-subtle",
  "transition-[border-color,box-shadow] duration-150",
  "hover:border-ink-subtle",
  "focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0",
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-subtle disabled:hover:border-line-strong",
  // By the attribute: the `:read-only` selector also matches every <select>.
  "[&[readonly]]:bg-sunken",
  "aria-invalid:border-danger-dot aria-invalid:focus-visible:outline-danger-dot",
);

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type ?? "text"}
      className={cn(controlClass, "h-[34px] px-3 text-sm", className)}
      {...props}
    />
  );
}

/** An input with something before or after it inside the frame (`€`, `%`, an icon). */
export function InputGroup({
  before,
  after,
  className,
  inputClassName,
  ...props
}: ComponentProps<"input"> & {
  before?: ReactNode;
  after?: ReactNode;
  inputClassName?: string;
}) {
  return (
    <div className={cn("relative flex items-center", className)}>
      {before ? (
        <span className="pointer-events-none absolute left-3 flex items-center text-ink-subtle [&_svg]:size-4">
          {before}
        </span>
      ) : null}
      <Input
        className={cn(before && "pl-8", after && "pr-9", inputClassName)}
        {...props}
      />
      {after ? (
        <span className="absolute right-2 flex items-center text-ink-subtle [&_svg]:size-4">
          {after}
        </span>
      ) : null}
    </div>
  );
}

/** A password field whose text can be shown while typing. */
export function PasswordInput({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Hide the password" : "Show the password"}
        aria-pressed={visible}
        className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-ink-subtle hover:bg-sunken hover:text-ink"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        controlClass,
        "min-h-20 px-3 py-2 text-sm leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

/** The browser's own select: quick with a keyboard, right on a phone. */
export function Select({
  className,
  children,
  ...props
}: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          controlClass,
          "h-[34px] appearance-none py-0 pr-8 pl-3 text-sm",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-subtle"
      >
        <path
          d="M4 6l4 4 4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
