import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/status";

/** One tone, one meaning (see src/lib/status). */
export const toneClass: Record<Tone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-neutral-bg text-neutral-fg", dot: "bg-neutral-dot" },
  planned: { badge: "bg-planned-bg text-planned-fg", dot: "bg-planned-dot" },
  moving: { badge: "bg-moving-bg text-moving-fg", dot: "bg-moving-dot" },
  attention: {
    badge: "bg-attention-bg text-attention-fg",
    dot: "bg-attention-dot",
  },
  success: { badge: "bg-success-bg text-success-fg", dot: "bg-success-dot" },
  danger: { badge: "bg-danger-bg text-danger-fg", dot: "bg-danger-dot" },
};

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: Tone;
  /** The dot carries the tone together with the word, never the colour alone. */
  dot?: boolean;
  /** A slow pulse on the dot: something is live. */
  live?: boolean;
}

export function Badge({
  tone = "neutral",
  dot = true,
  live = false,
  className,
  children,
  ...props
}: BadgeProps) {
  const classes = toneClass[tone];
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap",
        classes.badge,
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            classes.dot,
            live && "animate-pulse-dot shadow-[0_0_0_2px_var(--success-bg)]",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

/** A small round count next to a navigation entry or a tab. */
export function CountBadge({
  count,
  tone = "neutral",
  className,
}: {
  count: number;
  tone?: Tone;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular",
        toneClass[tone].badge,
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
