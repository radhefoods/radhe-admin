"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/menu";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { Cents, Id, IsoDateTime } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import {
  formatDateTime,
  formatRelative,
  formatShortDateTime,
} from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { shortId } from "@/lib/format/names";
import { useNow } from "@/lib/hooks/use-now";

/** An amount of the API (integer cents), printed with tabular figures. */
export function Money({
  cents,
  className,
  muted = false,
}: {
  cents: Cents | null | undefined;
  className?: string;
  /** A zero that says "nothing" is shown quietly. */
  muted?: boolean;
}) {
  if (cents === null || cents === undefined) {
    return <span className="text-ink-subtle">—</span>;
  }
  return (
    <span
      className={cn(
        "whitespace-nowrap tabular",
        muted && cents === 0 && "text-ink-subtle",
        className,
      )}
    >
      {formatMoney(cents)}
    </span>
  );
}

/**
 * A moment in German time. Lists show it short ("Today, 10:05"); the full
 * date and how long ago it was are in the tooltip.
 */
export function DateTime({
  value,
  short = false,
  className,
}: {
  value: IsoDateTime | null | undefined;
  short?: boolean;
  className?: string;
}) {
  const now = useNow();
  if (!value) return <span className="text-ink-subtle">—</span>;
  const full = formatDateTime(value);
  return (
    <Tooltip content={`${full} German time · ${formatRelative(value, now)}`}>
      <time
        dateTime={value}
        className={cn("whitespace-nowrap tabular", className)}
      >
        {short ? formatShortDateTime(value, now) : full}
      </time>
    </Tooltip>
  );
}

/**
 * The names of the admins by id. Records of the API carry an admin's id
 * only; the names come from the team list, which needs its own permission.
 */
export function useAdminNames(): (id: Id | null | undefined) => string {
  const { can, admin } = useAuth();
  const { data } = useQuery({
    queryKey: queryKeys.adminUsers.list(),
    queryFn: ({ signal }) => api.adminUsers.list(signal),
    enabled: can("admin_users.read"),
    staleTime: 5 * 60_000,
  });
  return (id) => {
    if (!id) return "—";
    if (id === admin?.id) return admin.name;
    const found = data?.items.find((entry) => entry.id === id);
    return found?.name ?? `Admin ${shortId(id)}`;
  };
}

/** Who did something: "Nisha Patel", or "Admin …a1b2c3" without the permission. */
export function AdminName({ id }: { id: Id | null | undefined }) {
  return <>{useAdminNames()(id)}</>;
}

/** Copies a value (an order number, a secret) and says so. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  /** What is copied, for screen readers: "Copy the order number". */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          // The clipboard is blocked: the value can be selected by hand.
        }
      }}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-subtle hover:bg-sunken hover:text-ink",
        className,
      )}
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5 text-success-fg" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}

/** A product or category picture from the API's ready-made sizes. */
export function Thumb({
  src,
  alt = "",
  size = 40,
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-md border border-line bg-sunken",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- the API serves ready-made sizes
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : null}
    </span>
  );
}

/** Two lines in a table cell: the main value and something quieter under it. */
export function TwoLine({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-ink">{primary}</span>
      {secondary ? (
        <span className="truncate text-13 text-ink-subtle">{secondary}</span>
      ) : null}
    </span>
  );
}
