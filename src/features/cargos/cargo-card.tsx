"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/domain/status-badge";
import { Money } from "@/components/domain/values";
import { toneClass } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/surface";
import type { Cargo } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import {
  formatDayRange,
  formatDeadline,
  formatDuration,
} from "@/lib/format/dates";
import { plural } from "@/lib/format/names";
import { useNow } from "@/lib/hooks/use-now";
import { routes, withQuery } from "@/lib/routes";
import { CARGO_ATTENTION, ORDER_STATUS, type Tone } from "@/lib/status";
import { CargoActions } from "./cargo-actions";
import { CargoStepper } from "./cargo-stepper";
import { useCargoPaymentSummary, useOrderSummary } from "./queries";

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="truncate text-lg font-semibold text-ink tabular">
        {children}
      </dd>
    </div>
  );
}

/** Parts of a whole as one bar, each in the tone of its status. */
export function SegmentBar({
  segments,
  label,
}: {
  segments: { key: string; value: number; tone: Tone; label: string }[];
  /** What the bar shows, for screen readers. */
  label: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const shown = segments.filter((segment) => segment.value > 0);
  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`${label}: ${shown.map((segment) => `${segment.label} ${segment.value}`).join(", ") || "nothing yet"}`}
        className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-sunken"
      >
        {total > 0
          ? shown.map((segment) => (
              <span
                key={segment.key}
                className={cn("h-full min-w-1", toneClass[segment.tone].dot)}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ))
          : null}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-13 text-ink-muted">
        {shown.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                toneClass[segment.tone].dot,
              )}
            />
            <span className="tabular">{segment.value}</span>{" "}
            {segment.label.toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The gold line about time: when ordering opens or closes. */
function Deadline({ cargo }: { cargo: Cargo }) {
  const now = useNow();
  let text: string | null = null;
  if (cargo.status === "taking_orders") {
    const left = Date.parse(cargo.orderCloseAt) - now.getTime();
    text =
      left > 0
        ? `Ordering closes ${formatDeadline(cargo.orderCloseAt)}, in ${formatDuration(left)}.`
        : `The deadline passed ${formatDeadline(cargo.orderCloseAt)}. The cargo closes with the next automatic check.`;
  } else if (cargo.status === "scheduled") {
    const left = Date.parse(cargo.orderOpenAt) - now.getTime();
    text =
      left > 0
        ? `Opens by itself ${formatDeadline(cargo.orderOpenAt)}, in ${formatDuration(left)}.`
        : `Was due to open ${formatDeadline(cargo.orderOpenAt)}.`;
  }
  if (!text) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-gold-line bg-gold-soft px-3 py-2 text-13 font-medium text-gold">
      <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {text} Delivery{" "}
        {formatDayRange(cargo.delivery.start, cargo.delivery.end)}.
      </span>
    </p>
  );
}

/**
 * A cargo at a glance: where it is on its way, its numbers, and the one
 * next step. Used on the start page and above the list of cargos.
 */
export function CargoCard({
  cargo,
  className,
}: {
  cargo: Cargo;
  className?: string;
}) {
  const summary = useOrderSummary(cargo.id);
  const delivered = cargo.status === "delivered";
  const payments = useCargoPaymentSummary(
    delivered ? cargo.id : undefined,
  ).data;
  const numbers = summary.data;
  const collecting = delivered && payments;

  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-5",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-base font-bold text-ink">
          <Link
            href={routes.cargo(cargo.id)}
            className="rounded-sm hover:text-accent-text hover:underline"
          >
            {cargo.code}
          </Link>
        </h3>
        <p className="min-w-0 truncate text-ink-muted">{cargo.internalName}</p>
        <div className="ml-auto flex items-center gap-1.5">
          {cargo.attention ? (
            <StatusBadge kind="cargoAttention" value={cargo.attention} />
          ) : null}
          <StatusBadge kind="cargo" value={cargo.status} />
        </div>
      </header>

      <CargoStepper status={cargo.status} compact />

      {collecting ? (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Collected">
              <Money cents={payments.collected} />
            </Stat>
            <Stat label="Open">
              <Money cents={payments.open.amount} muted />
            </Stat>
            <Stat label="Overdue">
              <Money cents={payments.overdue.amount} muted />
            </Stat>
          </dl>
          <SegmentBar
            label="Payments of this cargo"
            segments={payments.byStatus.map((entry) => ({
              key: entry.status,
              value: entry.orders,
              tone:
                entry.status === "paid"
                  ? "success"
                  : entry.status === "overdue"
                    ? "danger"
                    : entry.status === "due"
                      ? "attention"
                      : "neutral",
              label:
                entry.status === "not_enabled" ? "Not invoiced" : entry.status,
            }))}
          />
        </>
      ) : numbers ? (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Orders">{numbers.orders.toLocaleString("en")}</Stat>
            <Stat label="Customers">
              {numbers.customers.toLocaleString("en")}
            </Stat>
            <Stat label="Units">{numbers.units.toLocaleString("en")}</Stat>
            <Stat label="Booked">
              <Money cents={numbers.bookedValue} />
            </Stat>
          </dl>
          {["orders_closed", "in_transit", "arrived", "delivering"].includes(
            cargo.status,
          ) ? (
            <SegmentBar
              label="Orders of this cargo"
              segments={numbers.byStatus
                .filter((entry) => entry.status !== "cancelled")
                .map((entry) => ({
                  key: entry.status,
                  value: entry.orders,
                  tone: ORDER_STATUS[entry.status].tone,
                  label: ORDER_STATUS[entry.status].label,
                }))}
            />
          ) : null}
        </>
      ) : summary.isLoading ? (
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-10" />
          ))}
        </div>
      ) : null}

      <Deadline cargo={cargo} />

      <footer className="mt-auto flex flex-wrap items-center gap-2">
        <p className="mr-auto text-13 text-ink-muted">
          {cargo.attention ? (
            CARGO_ATTENTION[cargo.attention].label
          ) : collecting && payments.toActivate.orders > 0 ? (
            <>
              {plural(payments.toActivate.orders, "delivered order")} without an
              invoice yet.
            </>
          ) : (
            <Link
              href={withQuery(routes.cargoOrders(cargo.id), {})}
              className="font-medium text-accent-text hover:underline"
            >
              {numbers ? plural(numbers.orders, "order") : "Orders"}
            </Link>
          )}
        </p>
        <CargoActions cargo={cargo} variant="card" />
      </footer>
    </article>
  );
}
