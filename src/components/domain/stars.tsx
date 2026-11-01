import { Star } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A rating of 1 to 5 as stars, with the number for screen readers. The
 * filled stars carry the gold of the panel; the empty ones stay a hairline.
 */
export function Stars({
  value,
  label = "Rating",
  size = "sm",
  className,
}: {
  value: number;
  /** What the stars rate: "Rating", "Delivery". */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const stars = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span
      role="img"
      aria-label={`${label}: ${stars} of 5 stars`}
      className={cn("inline-flex items-center gap-px", className)}
    >
      {[1, 2, 3, 4, 5].map((step) => (
        <Star
          key={step}
          aria-hidden="true"
          className={cn(
            size === "md" ? "size-4.5" : "size-3.5",
            step <= stars
              ? "fill-current text-gold"
              : "fill-transparent text-line-strong",
          )}
        />
      ))}
    </span>
  );
}
