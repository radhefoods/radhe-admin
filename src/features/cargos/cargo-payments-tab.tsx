"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Money } from "@/components/domain/values";
import { Button } from "@/components/ui/button";
import { ScrollX } from "@/components/ui/scroll-x";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
} from "@/components/ui/surface";
import { errorMessage } from "@/lib/api/error-text";
import { useCan } from "@/lib/auth/auth-provider";
import { plural } from "@/lib/format/names";
import { routes, withQuery } from "@/lib/routes";
import { ActivatePaymentsDialog } from "./activate-payments-dialog";
import { useCurrentCargo } from "./cargo-frame";
import { useCargoPaymentSummary } from "./queries";

function Figure({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line px-4 py-3.5">
      <dt className="text-13 text-ink-muted">{label}</dt>
      <dd className="font-display text-3xl leading-tight text-ink tabular">
        {children}
      </dd>
      {hint ? <p className="text-13 text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

export function CargoPaymentsTab() {
  const cargo = useCurrentCargo();
  const can = useCan();
  const summary = useCargoPaymentSummary(cargo?.id);
  const [activating, setActivating] = useState(false);
  if (!cargo) return null;
  const data = summary.data;

  return (
    <RequirePermission permission="payments.read">
      {summary.isError ? (
        <Alert
          tone="danger"
          title="The payments could not be loaded"
          actions={
            <Button onClick={() => void summary.refetch()}>Try again</Button>
          }
        >
          {errorMessage(summary.error)}
        </Alert>
      ) : !data ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : (
        <>
          {data.toActivate.orders > 0 ? (
            <Alert
              tone="time"
              title={`${plural(data.toActivate.orders, "delivered order")} without an invoice yet`}
              actions={
                <ActionButton
                  permission="payments.manage"
                  variant="primary"
                  onClick={() => setActivating(true)}
                >
                  Activate payment
                </ActionButton>
              }
            >
              Activating issues the invoices and sends each customer the payment
              request:{" "}
              <Money
                cents={data.toActivate.amount}
                className="font-semibold text-ink"
              />{" "}
              to collect.
            </Alert>
          ) : cargo.status !== "delivered" ? (
            <Alert tone="info" title="Payment begins after delivery">
              Orders are invoiced once they are delivered. A single order that
              is delivered already can be activated on its own page.
            </Alert>
          ) : null}

          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Figure
              label="Collected"
              hint={
                data.refunded > 0 ? (
                  <>
                    Refunded: <Money cents={data.refunded} />
                  </>
                ) : null
              }
            >
              <Money cents={data.collected} />
            </Figure>
            <Figure label="Open" hint={plural(data.open.orders, "order")}>
              <Money cents={data.open.amount} muted />
            </Figure>
            <Figure label="Overdue" hint={plural(data.overdue.orders, "order")}>
              <Money cents={data.overdue.amount} muted />
            </Figure>
            <Figure
              label="Not invoiced yet"
              hint={plural(data.toActivate.orders, "delivered order")}
            >
              <Money cents={data.toActivate.amount} muted />
            </Figure>
          </dl>

          <Card>
            <CardHeader
              title="By payment status"
              description="Cancelled orders are not counted. A row opens these orders in the order list."
            />
            <CardBody className="p-0 sm:p-0">
              {data.byStatus.length === 0 ? (
                <p className="px-5 py-6 text-13 text-ink-muted">
                  This cargo has no orders.
                </p>
              ) : (
                <ScrollX label={"Orders by payment status"}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-ink-muted">
                        <th
                          scope="col"
                          className="px-5 py-2 text-left font-semibold"
                        >
                          Status
                        </th>
                        <th
                          scope="col"
                          className="px-5 py-2 text-right font-semibold"
                        >
                          Orders
                        </th>
                        <th
                          scope="col"
                          className="px-5 py-2 text-right font-semibold"
                        >
                          Due
                        </th>
                        <th
                          scope="col"
                          className="px-5 py-2 text-right font-semibold"
                        >
                          Paid
                        </th>
                        <th
                          scope="col"
                          className="px-5 py-2 text-right font-semibold"
                        >
                          Refunded
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byStatus.map((entry) => (
                        <tr key={entry.status} className="border-t border-line">
                          <th
                            scope="row"
                            className="px-5 py-2.5 text-left font-normal"
                          >
                            {can("orders.read") ? (
                              <Link
                                href={withQuery(routes.orders, {
                                  cargoId: cargo.id,
                                  paymentStatus: entry.status,
                                })}
                                className="inline-flex rounded-full hover:opacity-80"
                              >
                                <StatusBadge
                                  kind="payment"
                                  value={entry.status}
                                />
                              </Link>
                            ) : (
                              <StatusBadge
                                kind="payment"
                                value={entry.status}
                              />
                            )}
                          </th>
                          <td className="px-5 py-2.5 text-right tabular">
                            {entry.orders}
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <Money cents={entry.amountDue} muted />
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <Money cents={entry.paid} muted />
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <Money cents={entry.refunded} muted />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollX>
              )}
            </CardBody>
          </Card>

          {data.waived.orders > 0 ? (
            <p className="text-13 text-ink-muted">
              {plural(data.waived.orders, "order")} of this cargo{" "}
              {data.waived.orders === 1 ? "was" : "were"} waived: the customer
              was let off what was owed.
            </p>
          ) : null}
        </>
      )}

      <ActivatePaymentsDialog
        cargo={cargo}
        open={activating}
        onOpenChange={setActivating}
      />
    </RequirePermission>
  );
}
