"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api/client";
import { hasErrorCode } from "@/lib/api/errors";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type { Id } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDeadline, paymentDeadline } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { ExcludeOrders } from "./exclude-orders";
import { useCargoOrders } from "./queries";

/** How many orders the API activates per request (9.5). */
const BATCH = 100;

/**
 * Activates payment for the delivered orders of a cargo: each gets its
 * invoice and a payment request by email, with reminders every day until it
 * is paid. The API takes 100 orders per request, so the panel asks again
 * while orders remain.
 */
export function ActivatePaymentsDialog({
  cargo,
  open,
  onOpenChange,
}: {
  cargo: { id: Id; code: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const can = useCan();
  const daysId = useId();
  const [days, setDays] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<Id>>(new Set());
  const [done, setDone] = useState(0);

  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.settings.get(signal),
    enabled: open && can("settings.read"),
    staleTime: 5 * 60_000,
  }).data;
  const orders = useCargoOrders(cargo.id, open);

  // What the API will activate: delivered, no invoice yet, something to pay.
  const eligible = (orders.data?.orders ?? []).filter(
    (order) =>
      order.status === "delivered" &&
      order.paymentStatus === "not_enabled" &&
      order.finalTotal > 0,
  );
  const included = eligible.filter((order) => !excluded.has(order.id));
  const amount = included.reduce((sum, order) => sum + order.finalTotal, 0);

  const text = days ?? String(settings?.payments.defaultDeadlineDays ?? 5);
  const deadlineDays = /^\d{1,2}$/.test(text.trim())
    ? Number(text)
    : Number.NaN;
  const validDays = deadlineDays >= 1 && deadlineDays <= 60;

  const activate = useMutation({
    meta: { invalidates: invalidation.payment, silent: true },
    mutationFn: async () => {
      const activated: string[] = [];
      const failed: { orderNumber: string; message: string }[] = [];
      let remaining = included.length;
      // Repeat while orders remain; stop when a request activates nothing,
      // so a refusal of the API can never turn into an endless loop.
      for (let round = 0; remaining > 0 && round < 50; round += 1) {
        const result = await api.cargos.activatePayments(cargo.id, {
          deadlineDays,
          excludeOrderIds: [...excluded],
        });
        activated.push(...result.activated);
        failed.push(...result.failed);
        setDone(activated.length);
        remaining = result.remaining;
        if (result.activated.length === 0) break;
      }
      return { activated, failed, remaining };
    },
  });

  const loading = orders.isLoading;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setDays(null);
          setExcluded(new Set());
          setDone(0);
          activate.reset();
        }
        onOpenChange(value);
      }}
      title={`Activate payment for ${cargo.code}?`}
      description={
        loading
          ? "Counting the delivered orders…"
          : included.length === 0
            ? "No delivered order of this cargo waits for its invoice."
            : `${plural(included.length, "delivered order")} get${included.length === 1 ? "s" : ""} an invoice and a payment request by email. A reminder follows every day${
                settings
                  ? ` at ${String(settings.payments.reminderHour).padStart(2, "0")}:00`
                  : ""
              } until each one is paid.`
      }
      facts={
        loading
          ? []
          : [
              { label: "To collect", value: formatMoney(amount), strong: true },
              {
                label: "Orders",
                value: plural(included.length, "delivered order"),
              },
              {
                label: "Pay by",
                value: validDays ? (
                  <span className="text-gold">
                    {formatDeadline(paymentDeadline(deadlineDays))} German time
                  </span>
                ) : (
                  "—"
                ),
              },
              ...(excluded.size > 0
                ? [{ label: "Left out", value: plural(excluded.size, "order") }]
                : []),
            ]
      }
      confirmLabel={
        activate.isPending && included.length > BATCH
          ? `Activated ${done} of ${included.length}…`
          : `Activate and notify ${plural(included.length, "customer")}`
      }
      canConfirm={!loading && included.length > 0 && validDays}
      errorHelp={(error) =>
        hasErrorCode(error, "COMPANY_DETAILS_MISSING") ? (
          <Link href={routes.settingsCompany}>
            Complete the company settings
          </Link>
        ) : null
      }
      onConfirm={async () => {
        const result = await activate.mutateAsync();
        if (result.failed.length > 0) {
          notify.info(
            `Payment activated for ${plural(result.activated.length, "order")}, ${result.failed.length} refused`,
            result.failed
              .slice(0, 6)
              .map((entry) => `${entry.orderNumber}: ${entry.message}`)
              .join(" · "),
          );
        } else {
          notify.success(
            `Payment activated for ${plural(result.activated.length, "order")}`,
            `${formatMoney(amount)} to collect by ${formatDeadline(paymentDeadline(deadlineDays))}.`,
          );
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={daysId} className="text-13 font-medium text-ink">
          Days to pay
        </label>
        <div className="relative w-36">
          <Input
            id={daysId}
            inputMode="numeric"
            value={text}
            onChange={(event) => setDays(event.target.value)}
            aria-invalid={validDays ? undefined : true}
            aria-describedby={`${daysId}-hint`}
            className="pr-14 tabular"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-13 text-ink-subtle"
          >
            days
          </span>
        </div>
        <p
          id={`${daysId}-hint`}
          className={
            validDays ? "text-13 text-ink-subtle" : "text-13 text-danger-fg"
          }
        >
          {validDays
            ? "The deadline is the end of that day in Germany."
            : "Between 1 and 60 days."}
        </p>
      </div>

      <ExcludeOrders
        orders={eligible}
        excluded={excluded}
        onChange={setExcluded}
        action="invoiced"
      />

      {orders.data && !orders.data.complete ? (
        <Alert
          tone="warning"
          title="This cargo has more orders than the panel lists"
        >
          Orders beyond the first 2,000 are activated as well and cannot be left
          out here.
        </Alert>
      ) : null}
    </ConfirmDialog>
  );
}
