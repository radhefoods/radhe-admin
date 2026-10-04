"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Timeline } from "@/components/domain/timeline";
import { DateTime, Money, useAdminNames } from "@/components/domain/values";
import { Badge } from "@/components/ui/badge";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import type {
  CargoAttention,
  CargoDetail,
  TranslatedOptional,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDayRange, formatDeadline } from "@/lib/format/dates";
import { missingLocales, plural } from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import { CARGO_STATUS, ORDER_STATUS } from "@/lib/status";
import { SegmentBar } from "./cargo-card";
import { useCurrentCargo } from "./cargo-frame";
import { CargoStepper } from "./cargo-stepper";
import {
  useCargoCheck,
  useCargoPaymentSummary,
  useOrderSummary,
} from "./queries";

const ATTENTION: Record<
  CargoAttention,
  { title: string; text: string; check: boolean }
> = {
  opening_due: {
    title: "The opening time has passed",
    text: "The automatic check opens the cargo within the hour. You can run it now.",
    check: true,
  },
  closing_due: {
    title: "The order deadline has passed",
    text: "Customers can no longer order: the deadline counts to the second. The automatic check closes the cargo within the hour, or you run it now.",
    check: true,
  },
  window_missed: {
    title: "The order window passed while the cargo was scheduled",
    text: "It never opened. Give it new times (Edit the cargo), or cancel it.",
    check: false,
  },
};

function Translated({ value }: { value: TranslatedOptional | null }) {
  if (!value?.en && !value?.de)
    return <span className="text-ink-subtle">Not set</span>;
  const missing = missingLocales(value);
  return (
    <span className="flex flex-col gap-1">
      {value.en ? (
        <span>
          <span className="mr-1.5 text-2xs font-semibold text-ink-subtle">
            EN
          </span>
          {value.en}
        </span>
      ) : null}
      {value.de ? (
        <span lang="de">
          <span className="mr-1.5 text-2xs font-semibold text-ink-subtle">
            DE
          </span>
          {value.de}
        </span>
      ) : null}
      {missing.map((locale) => (
        <Badge key={locale} tone="attention" className="self-start">
          {locale === "de" ? "German" : "English"} is missing
        </Badge>
      ))}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-display text-3xl leading-tight text-ink tabular">
        {children}
      </dd>
    </div>
  );
}

function Numbers({ cargo }: { cargo: CargoDetail }) {
  const summary = useOrderSummary(cargo.id);
  const data = summary.data;
  return (
    <Card>
      <CardHeader
        title="Orders"
        description="Cancelled orders are not counted."
        actions={
          <Link
            href={routes.cargoOrders(cargo.id)}
            className="text-13 font-medium text-accent-text hover:underline"
          >
            Open the orders
          </Link>
        }
      />
      <CardBody className="flex flex-col gap-5">
        {data ? (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Orders">{data.orders.toLocaleString("en")}</Stat>
              <Stat label="Customers">
                {data.customers.toLocaleString("en")}
              </Stat>
              <Stat label="Units">{data.units.toLocaleString("en")}</Stat>
              <Stat label="Booked value">
                <Money cents={data.bookedValue} />
              </Stat>
            </dl>
            {data.orders > 0 ? (
              <SegmentBar
                label="Orders by status"
                segments={data.byStatus
                  .filter((entry) => entry.status !== "cancelled")
                  .map((entry) => ({
                    key: entry.status,
                    value: entry.orders,
                    tone: ORDER_STATUS[entry.status].tone,
                    label: ORDER_STATUS[entry.status].label,
                  }))}
              />
            ) : (
              <p className="text-13 text-ink-muted">
                No order yet.{" "}
                {cargo.status === "taking_orders"
                  ? "Orders arrive here as customers confirm them."
                  : "Orders can only be placed while the cargo takes orders."}
              </p>
            )}
            {data.cancelledOrders > 0 ? (
              <p className="text-13 text-ink-subtle">
                {plural(data.cancelledOrders, "order")} of this cargo{" "}
                {data.cancelledOrders === 1 ? "was" : "were"} cancelled.
              </p>
            ) : null}
          </>
        ) : summary.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <p className="text-13 text-ink-muted">
            Your role does not include the orders of a cargo.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function Payments({ cargo }: { cargo: CargoDetail }) {
  const { data } = useCargoPaymentSummary(cargo.id);
  if (!data) return null;
  const started = data.byStatus.some((entry) => entry.status !== "not_enabled");
  if (!started && data.toActivate.orders === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Payments"
        description="Payment begins after delivery, when it is activated."
        actions={
          <Link
            href={routes.cargoPayments(cargo.id)}
            className="text-13 font-medium text-accent-text hover:underline"
          >
            Open the payments
          </Link>
        }
      />
      <CardBody>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Collected">
            <Money cents={data.collected} />
          </Stat>
          <Stat label="Open">
            <Money cents={data.open.amount} muted />
          </Stat>
          <Stat label="Overdue">
            <Money cents={data.overdue.amount} muted />
          </Stat>
          <Stat label="To activate">
            <Money cents={data.toActivate.amount} muted />
          </Stat>
        </dl>
      </CardBody>
    </Card>
  );
}

export function CargoOverviewTab() {
  const cargo = useCurrentCargo();
  const can = useCan();
  const check = useCargoCheck();
  const adminName = useAdminNames();
  if (!cargo) return null;
  const attention = cargo.attention ? ATTENTION[cargo.attention] : null;

  return (
    <>
      {attention ? (
        <Alert
          tone={cargo.attention === "window_missed" ? "danger" : "time"}
          title={attention.title}
          actions={
            attention.check ? (
              <ActionButton
                permission="cargos.manage"
                size="sm"
                loading={check.isPending}
                onClick={() =>
                  check.mutate(undefined, {
                    onSuccess: () => notify.success("The check ran"),
                  })
                }
              >
                Run the check now
              </ActionButton>
            ) : null
          }
        >
          {attention.text}
        </Alert>
      ) : null}

      <Card>
        <CardBody className="py-5">
          <CargoStepper status={cargo.status} />
        </CardBody>
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          {can("orders.read") ? <Numbers cargo={cargo} /> : null}
          {can("payments.read") ? <Payments cargo={cargo} /> : null}

          <Card>
            <CardHeader title="What customers see" />
            <CardBody>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Fact label="Name for customers">
                  <Translated value={cargo.customerName} />
                </Fact>
                <Fact label="Message for customers">
                  <Translated value={cargo.customerMessage} />
                </Fact>
              </dl>
            </CardBody>
          </Card>

          {cargo.internalNotes ? (
            <Card>
              <CardHeader title="Internal notes" />
              <CardBody>
                <p className="text-sm whitespace-pre-line text-ink">
                  {cargo.internalNotes}
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Dates"
              description="All times are German time."
            />
            <CardBody>
              <dl className="grid gap-4">
                <Fact label="Ordering opens">
                  {formatDeadline(cargo.orderOpenAt)}
                </Fact>
                <Fact label="Order deadline">
                  <span className="font-medium text-gold">
                    {formatDeadline(cargo.orderCloseAt)}
                  </span>
                </Fact>
                <Fact label="Delivery window">
                  {formatDayRange(cargo.delivery.start, cargo.delivery.end)}
                </Fact>
                <Fact label="Accepting orders now">
                  {cargo.isAcceptingOrders ? (
                    <StatusBadge kind="cargo" value="taking_orders" />
                  ) : (
                    "No"
                  )}
                </Fact>
                {cargo.openedAt ? (
                  <Fact label="Opened">
                    <DateTime value={cargo.openedAt} />
                  </Fact>
                ) : null}
                {cargo.closedAt ? (
                  <Fact label="Closed">
                    <DateTime value={cargo.closedAt} />
                  </Fact>
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardBody>
              <Timeline
                entries={[...cargo.statusHistory]
                  .reverse()
                  .map((entry, index) => ({
                    key: `${entry.at}-${index}`,
                    at: entry.at,
                    title: CARGO_STATUS[entry.to].label,
                    tone: CARGO_STATUS[entry.to].tone,
                    by:
                      entry.source === "schedule"
                        ? "By the schedule"
                        : adminName(entry.by),
                    note: entry.note,
                  }))}
              />
            </CardBody>
          </Card>

          {can("orders.read") ? (
            <p className="text-13 text-ink-muted">
              <Link
                href={withQuery(routes.orders, { cargoId: cargo.id })}
                className="font-medium text-accent-text hover:underline"
              >
                The orders of {cargo.code} in the order list
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
