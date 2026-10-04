import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * The state of WhatsApp (documentation, section 19): the function is built
 * and waits for its credentials. The panel never hides it; it says whether
 * it is on, and what happens to WhatsApp messages while it is off.
 */
export function WhatsappState({
  enabled,
  children,
  className,
}: {
  /** `undefined` while the API has not said yet. */
  enabled: boolean | undefined;
  /** What it means on this page; a default explains the log. */
  children?: ReactNode;
  className?: string;
}) {
  if (enabled === undefined) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-13",
        className,
      )}
    >
      <Badge tone={enabled ? "success" : "neutral"} className="mt-px">
        {enabled ? "WhatsApp is on" : "WhatsApp is not set up"}
      </Badge>
      <p className="min-w-0 flex-1 basis-64 text-ink-muted">
        {children ??
          (enabled
            ? "Customers who opted in get the dispatch, payment and news messages by WhatsApp as well as by email."
            : "Emails go out as usual. Messages for customers who opted in to WhatsApp are stored as skipped until WhatsApp is configured in the API; they can be sent again then.")}
      </p>
    </div>
  );
}
