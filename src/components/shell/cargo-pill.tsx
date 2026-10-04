"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toneClass } from "@/components/ui/badge";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format/dates";
import { useNow } from "@/lib/hooks/use-now";
import { routes } from "@/lib/routes";

export function useCargoOverview() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.cargos.overview(),
    queryFn: ({ signal }) => api.cargos.overview(signal),
    enabled: can("cargos.read"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * The state of ordering, always in view: which cargo takes orders and how
 * long until its deadline. Time is gold.
 */
export function CargoPill({ className }: { className?: string }) {
  const can = useCan();
  const { data, dataUpdatedAt } = useCargoOverview();
  const now = useNow();
  if (!can("cargos.read") || !data) return null;

  // The API's clock decides: a wrong device clock cannot move the deadline.
  const skew = Date.parse(data.serverTime) - dataUpdatedAt;
  const serverNow = now.getTime() + (Number.isFinite(skew) ? skew : 0);

  const frame = cn(
    "flex h-[34px] min-w-0 items-center gap-2 rounded-full border border-line bg-surface px-3 text-13 font-medium whitespace-nowrap text-ink transition-colors hover:border-line-strong hover:bg-sunken",
    className,
  );

  if (data.current) {
    const closesIn = Date.parse(data.current.orderCloseAt) - serverNow;
    const late = closesIn <= 0 || data.current.attention === "closing_due";
    return (
      <Link href={routes.cargo(data.current.id)} className={frame}>
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            toneClass.success.dot,
            "animate-pulse-dot shadow-[0_0_0_2px_var(--success-bg)]",
          )}
        />
        <span className="truncate">
          {data.current.code}
          <span className="hidden text-ink-muted sm:inline">
            {" "}
            taking orders
          </span>
        </span>
        <span aria-hidden="true" className="text-line-strong">
          |
        </span>
        <span className="font-semibold text-gold tabular">
          {late ? (
            "deadline passed"
          ) : (
            <>
              <span className="max-sm:sr-only">closes in </span>
              {formatDuration(closesIn)}
            </>
          )}
        </span>
      </Link>
    );
  }

  if (data.next) {
    const opensIn = Date.parse(data.next.orderOpenAt) - serverNow;
    return (
      <Link href={routes.cargo(data.next.id)} className={frame}>
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", toneClass.neutral.dot)}
        />
        <span className="truncate text-ink-muted">Ordering closed</span>
        <span aria-hidden="true" className="text-line-strong">
          |
        </span>
        <span className="font-semibold text-gold tabular">
          {opensIn <= 0
            ? `${data.next.code} is due to open`
            : `${data.next.code} opens in ${formatDuration(opensIn)}`}
        </span>
      </Link>
    );
  }

  return (
    <Link href={routes.cargos} className={frame}>
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", toneClass.danger.dot)}
      />
      <span className="truncate">No cargo takes orders</span>
    </Link>
  );
}
