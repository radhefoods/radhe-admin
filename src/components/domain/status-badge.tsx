import { Badge } from "@/components/ui/badge";
import { statusMeta, type StatusKind } from "@/lib/status";

/**
 * The status of a record, as the API names it, made readable and in the
 * tone that means the same everywhere.
 */
export function StatusBadge({
  kind,
  value,
  className,
}: {
  kind: StatusKind;
  value: string;
  className?: string;
}) {
  const meta = statusMeta(kind, value);
  return (
    <Badge
      tone={meta.tone}
      live={kind === "cargo" && value === "taking_orders"}
      className={className}
    >
      {meta.label}
    </Badge>
  );
}
