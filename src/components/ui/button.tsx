import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold whitespace-nowrap select-none",
    "rounded-md border transition-[background-color,border-color,color,box-shadow] duration-150",
    "disabled:opacity-55 aria-disabled:opacity-55",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        // The one primary action of a screen.
        primary:
          "border-accent bg-accent text-accent-fg shadow-card hover:border-accent-hover hover:bg-accent-hover",
        secondary:
          "border-line-strong bg-surface text-ink shadow-card hover:bg-sunken",
        ghost:
          "border-transparent bg-transparent text-ink-muted hover:bg-sunken hover:text-ink",
        soft: "border-transparent bg-accent-soft text-accent-text hover:bg-planned-bg",
        danger:
          "border-danger-solid bg-danger-solid text-accent-fg shadow-card hover:border-danger-solid-hover hover:bg-danger-solid-hover",
        "danger-outline":
          "border-line-strong bg-surface text-danger-fg shadow-card hover:border-danger-dot hover:bg-danger-bg",
        link: "h-auto border-transparent p-0 text-accent-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-13 [&_svg]:size-3.5",
        md: "h-[34px] px-3.5 text-sm [&_svg]:size-4",
        lg: "h-10 px-4 text-sm [&_svg]:size-4",
        // For the jobs of the road, pressed with a thumb.
        xl: "h-12 rounded-lg px-5 text-base [&_svg]:size-5",
        icon: "size-[34px] [&_svg]:size-4",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Renders the child (a link, for example) with the look of a button. */
  asChild?: boolean;
  /** A request is on its way: the button waits and cannot be pressed twice. */
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  icon,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}
