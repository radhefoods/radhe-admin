import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold whitespace-nowrap select-none",
    "rounded-md border transition-[background-color,border-color,color,box-shadow,translate,scale,filter] duration-150 ease-out",
    "active:scale-[0.97] disabled:active:scale-100 aria-disabled:active:scale-100",
    "disabled:opacity-55 aria-disabled:opacity-55",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        // The one primary action of a screen.
        primary:
          "border-transparent bg-accent bg-grad-accent text-accent-fg shadow-glow hover:-translate-y-px hover:shadow-glow-strong active:translate-y-0 disabled:shadow-card disabled:hover:translate-y-0 aria-disabled:shadow-card aria-disabled:hover:translate-y-0",
        secondary:
          "border-line-strong bg-surface/70 text-ink shadow-card hover:border-ink-subtle hover:bg-surface",
        ghost:
          "border-transparent bg-transparent text-ink-muted hover:bg-ink/6 hover:text-ink",
        soft: "border-accent/15 bg-accent-soft text-accent-text hover:border-accent/30 hover:bg-planned-bg",
        danger:
          "border-transparent bg-danger-solid bg-grad-danger text-accent-fg shadow-glow-danger hover:-translate-y-px hover:brightness-110 active:translate-y-0 disabled:shadow-card disabled:hover:translate-y-0 disabled:hover:brightness-100",
        "danger-outline":
          "border-line-strong bg-surface/70 text-danger-fg shadow-card hover:border-danger-dot hover:bg-danger-bg",
        link: "h-auto border-transparent p-0 text-accent-text underline-offset-4 hover:underline active:scale-100",
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
