import { Check, X } from "lucide-react";
import type { CargoStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { CARGO_STATUS } from "@/lib/status";
import { CARGO_PATH } from "@/lib/status/transitions";

/**
 * The way of a cargo, from draft to delivered. Steps behind it are done,
 * the eye of the peacock feather marks where it is now.
 */
export function CargoStepper({
  status,
  compact = false,
  className,
}: {
  status: CargoStatus;
  /** Without labels under the steps that are not the current one. */
  compact?: boolean;
  className?: string;
}) {
  if (status === "cancelled") {
    return (
      <p
        className={cn(
          "flex items-center gap-2 text-13 font-medium text-ink-muted",
          className,
        )}
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
          <X aria-hidden="true" className="size-3" />
        </span>
        This cargo was cancelled.
      </p>
    );
  }

  const position = CARGO_PATH.indexOf(status as (typeof CARGO_PATH)[number]);
  const last = CARGO_PATH.length - 1;
  const finished = position === last;

  return (
    <ol
      aria-label={`Lifecycle: ${CARGO_STATUS[status].label}, step ${position + 1} of ${CARGO_PATH.length}`}
      className={cn("grid", className)}
      style={{
        gridTemplateColumns: `repeat(${CARGO_PATH.length}, minmax(0, 1fr))`,
      }}
    >
      {CARGO_PATH.map((step, index) => {
        const done = index < position || finished;
        const current = index === position && !finished;
        return (
          <li
            key={step}
            aria-current={index === position ? "step" : undefined}
            className="relative flex flex-col items-center gap-1.5"
          >
            {/* The line to the step before. */}
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-[9px] right-1/2 left-[-50%] h-0.5",
                  index <= position ? "bg-success-dot" : "bg-line",
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-[1] flex size-5 items-center justify-center rounded-full",
                done && "bg-success-dot text-surface",
                current &&
                  "size-[22px] -translate-y-px ring-4 ring-gold-soft feather-eye",
                !done && !current && "border-2 border-line-strong bg-surface",
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
            <span
              className={cn(
                "px-0.5 text-center text-2xs leading-tight",
                current || (finished && index === last)
                  ? "font-semibold text-ink"
                  : done
                    ? "text-ink-muted"
                    : "text-ink-subtle",
                compact && index !== position && "sr-only sm:not-sr-only",
              )}
            >
              {CARGO_STATUS[step].label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
