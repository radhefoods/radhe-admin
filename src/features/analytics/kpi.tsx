import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
  Alert,
  Skeleton,
} from "@/components/ui/surface";
import { describeError } from "@/lib/api/error-text";
import type { Kpi } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format/money";

/** A count with thousands separators. */
export const formatCount = (value: number) => value.toLocaleString("en");

/** `59.1 %` */
export const formatPercent = (value: number) =>
  `${value.toLocaleString("en")} %`;

/** Money on an axis: whole euros, `€1.8k` from ten thousand euros on. */
export function compactMoney(cents: number): string {
  const euros = cents / 100;
  if (Math.abs(euros) >= 10_000)
    return `€${(euros / 1000).toLocaleString("en", { maximumFractionDigits: 1 })}k`;
  return `€${Math.round(euros).toLocaleString("en")}`;
}

/**
 * The change against the previous period: an arrow and the percent. Green
 * when it is good news, red when it is bad; `invert` for figures where up
 * is bad (cancellations, refunds). Muted when there is nothing to compare.
 */
export function Change({
  kpi,
  invert = false,
  className,
}: {
  kpi: Kpi;
  invert?: boolean;
  className?: string;
}) {
  if (kpi.change === null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-ink-subtle",
          className,
        )}
      >
        <Minus aria-hidden="true" className="size-3.5" />
        <span className="sr-only">No comparison:</span>
        nothing before
      </span>
    );
  }
  const up = kpi.change > 0;
  const flat = kpi.change === 0;
  const good = flat ? null : invert ? !up : up;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium tabular",
        good === null
          ? "text-ink-subtle"
          : good
            ? "text-success-fg"
            : "text-danger-fg",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{up ? "Up" : flat ? "Unchanged" : "Down"}</span>
      {up ? "+" : ""}
      {kpi.change.toLocaleString("en")} %
    </span>
  );
}

export interface KpiTileProps {
  label: string;
  kpi: Kpi;
  format?: (value: number) => string;
  /** Up is bad news. */
  invert?: boolean;
  /** A smaller tile for the secondary figures. */
  compact?: boolean;
  /** Something under the value: "18 first-time, 26 returning". */
  detail?: ReactNode;
}

/** One figure of the period next to its change. */
export function KpiTile({
  label,
  kpi,
  format = formatCount,
  invert = false,
  compact = false,
  detail,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface",
        compact ? "px-3.5 py-2.5" : "px-4 py-3.5",
      )}
    >
      <p className="truncate text-13 font-medium text-ink-muted">{label}</p>
      <p
        className={cn(
          "font-display leading-none text-ink tabular",
          compact ? "text-xl" : "text-[1.65rem]",
        )}
      >
        {format(kpi.value)}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-13">
        <Change kpi={kpi} invert={invert} />
        <span className="text-ink-subtle">before: {format(kpi.previous)}</span>
      </p>
      {detail ? <p className="text-13 text-ink-muted">{detail}</p> : null}
    </div>
  );
}

/** A plain figure of the moment (the stock now), without a comparison. */
export function FigureTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: "attention" | "danger";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface px-3.5 py-2.5">
      <p className="truncate text-13 font-medium text-ink-muted">{label}</p>
      <p
        className={cn(
          "font-display text-xl leading-none tabular",
          tone === "danger"
            ? "text-danger-fg"
            : tone === "attention"
              ? "text-gold"
              : "text-ink",
        )}
      >
        {value}
      </p>
      {detail ? <p className="text-13 text-ink-subtle">{detail}</p> : null}
    </div>
  );
}

/**
 * One section of the tab: a card that loads on its own, shows the API's
 * error with a way to try again, and dims its figures while another period
 * loads.
 */
export function Section({
  title,
  description,
  actions,
  loading,
  refreshing = false,
  error,
  onRetry,
  skeleton,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  loading: boolean;
  refreshing?: boolean;
  error: unknown;
  onRetry: () => void;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card aria-label={title} aria-busy={loading || refreshing}>
      <CardHeader title={title} description={description} actions={actions} />
      <CardBody
        className={cn(
          "flex flex-col gap-4",
          refreshing && "opacity-60 transition-opacity",
        )}
      >
        {error && loading ? (
          <Alert
            tone="danger"
            title="This section could not be loaded"
            actions={<Button onClick={onRetry}>Try again</Button>}
          >
            {describeError(error).message}
          </Alert>
        ) : loading ? (
          (skeleton ?? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="w-1/2" />
            </div>
          ))
        ) : (
          children
        )}
      </CardBody>
    </Card>
  );
}

export { formatMoney };
