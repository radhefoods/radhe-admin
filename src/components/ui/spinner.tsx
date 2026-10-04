import { cn } from "@/lib/cn";

/** A turning ring. Decorative: the waiting element carries `aria-busy`. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-4 animate-spin", className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A centred spinner with a spoken label, for a region that is loading. */
export function LoadingBlock({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-40 items-center justify-center gap-2 text-ink-muted",
        className,
      )}
    >
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}
