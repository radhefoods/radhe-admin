"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useId, useState } from "react";
import {
  ActionButton,
  RequirePermission,
} from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { Timeline } from "@/components/domain/timeline";
import { DateTime, Money, useAdminNames } from "@/components/domain/values";
import { PageBody, PageHeader, gutter } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { ScrollX } from "@/components/ui/scroll-x";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Fact,
  Skeleton,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { NoteField } from "@/features/orders/order-dialogs";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/error-text";
import { hasErrorCode } from "@/lib/api/errors";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type { Id, OrderReturn, ReturnApproveInput } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatMoney } from "@/lib/format/money";
import { personName, plural, translated } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { RETURN_STATUS, humanize } from "@/lib/status";
import { RETURN_TRANSITIONS } from "@/lib/status/transitions";

/**
 * What approving sends: the units per pack size when the admin changed any,
 * nothing when the requested quantities are accepted as asked.
 */
export function approvalInput(
  record: Pick<OrderReturn, "items">,
  quantities: Record<Id, number>,
  note: string,
  internalNote: string,
): {
  input: ReturnApproveInput;
  units: number;
  amount: number;
  changed: boolean;
} {
  const lines = record.items.map((item) => ({
    variantId: item.variantId,
    quantity: quantities[item.variantId] ?? item.quantity,
    unitPrice: item.unitPrice,
    requested: item.quantity,
  }));
  const changed = lines.some((line) => line.quantity !== line.requested);
  return {
    input: {
      ...(changed
        ? {
            items: lines.map(({ variantId, quantity }) => ({
              variantId,
              quantity,
            })),
          }
        : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
    },
    units: lines.reduce((sum, line) => sum + line.quantity, 0),
    amount: lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPrice,
      0,
    ),
    changed,
  };
}

type Decision = "approve" | "reject" | "complete" | null;

function Decide({
  record,
  decision,
  onOpenChange,
}: {
  record: OrderReturn;
  decision: Decision;
  onOpenChange: (open: boolean) => void;
}) {
  const [quantities, setQuantities] = useState<Record<Id, string>>({});
  const [note, setNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  // Off by default: food that came back is not sold again unless the admin says so.
  const [restock, setRestock] = useState(false);
  const restockId = useId();
  const decide = useMutation({
    mutationFn: async (kind: Exclude<Decision, null>) => {
      if (kind === "approve") {
        return api.returns.approve(record.id, approval.input);
      }
      const body = {
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
      };
      return kind === "reject"
        ? api.returns.reject(record.id, body)
        : api.returns.complete(record.id, {
            ...body,
            ...(restock ? { restock: true } : {}),
          });
    },
    meta: { invalidates: invalidation.return, silent: true },
  });

  const parsed: Record<Id, number> = {};
  let valid = true;
  for (const item of record.items) {
    const text = quantities[item.variantId];
    if (text === undefined) continue;
    const value = /^\d{1,5}$/.test(text.trim()) ? Number(text) : Number.NaN;
    if (Number.isNaN(value) || value > item.quantity) valid = false;
    else parsed[item.variantId] = value;
  }
  const approval = approvalInput(record, parsed, note, internalNote);
  const approved = record.items.reduce(
    (sum, item) => sum + (item.approvedQuantity ?? 0) * item.unitPrice,
    0,
  );
  const approvedUnits = record.items.reduce(
    (sum, item) => sum + (item.approvedQuantity ?? 0),
    0,
  );
  if (!decision) return null;

  const reset = (open: boolean) => {
    if (!open) {
      setQuantities({});
      setNote("");
      setInternalNote("");
      setRestock(false);
    }
    onOpenChange(open);
  };
  const notes = (
    <>
      <NoteField
        value={note}
        onChange={setNote}
        label="Message to the customer"
        maxLength={1000}
      />
      <NoteField
        value={internalNote}
        onChange={setInternalNote}
        label="Internal note"
        maxLength={2000}
      />
    </>
  );

  if (decision === "approve") {
    return (
      <ConfirmDialog
        open
        onOpenChange={reset}
        title={`Approve ${record.returnNumber}?`}
        description="The customer is told that the return is accepted and what to do. Nothing changes on the order yet: the bill goes down when the goods are back and you complete the return."
        facts={[
          { label: "Units accepted", value: approval.units },
          { label: "Value", value: formatMoney(approval.amount), strong: true },
        ]}
        confirmLabel={
          approval.changed ? "Approve these quantities" : "Approve as requested"
        }
        canConfirm={valid && approval.units > 0}
        onConfirm={async () => {
          await decide.mutateAsync("approve");
          notify.success(`${record.returnNumber} approved`);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-13 font-medium text-ink">
            Units to accept
          </legend>
          {record.items.map((item) => {
            const text = quantities[item.variantId] ?? String(item.quantity);
            const value = Number(text);
            const wrong =
              !/^\d{1,5}$/.test(text.trim()) || value > item.quantity;
            return (
              <label
                key={item.variantId}
                className="flex items-center gap-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {translated(item.name)} {item.packSize.label}
                  <span className="block text-13 text-ink-subtle">
                    asked for {item.quantity},{" "}
                    {humanize(item.reason).toLowerCase()}
                  </span>
                </span>
                <Input
                  inputMode="numeric"
                  value={text}
                  aria-invalid={wrong ? true : undefined}
                  onChange={(event) =>
                    setQuantities({
                      ...quantities,
                      [item.variantId]: event.target.value,
                    })
                  }
                  className="w-20 text-right tabular"
                />
              </label>
            );
          })}
          {!valid ? (
            <p className="text-13 text-danger-fg">
              At most what the customer asked for; 0 declines a pack size.
            </p>
          ) : approval.units === 0 ? (
            <p className="text-13 text-danger-fg">
              Nothing would be accepted. Decline the return instead.
            </p>
          ) : null}
        </fieldset>
        {notes}
      </ConfirmDialog>
    );
  }

  if (decision === "reject") {
    return (
      <ConfirmDialog
        open
        onOpenChange={reset}
        title={`Decline ${record.returnNumber}?`}
        description="The customer is told that the return is not accepted. Give the reason in the message: it is what they read."
        tone="danger"
        facts={[
          {
            label: "Value asked back",
            value: formatMoney(record.requestedAmount),
            strong: true,
          },
        ]}
        confirmLabel="Decline the return"
        cancelLabel="Not now"
        onConfirm={async () => {
          await decide.mutateAsync("reject");
          notify.success(`${record.returnNumber} declined`);
        }}
      >
        {notes}
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={reset}
      title={`Are the goods of ${record.returnNumber} back?`}
      description="Completing books the accepted units as returned and lowers the final bill of the order. A credit note is issued and the customer is told. Paying the money back is a separate decision on the order."
      facts={[
        { label: "Units returned", value: approvedUnits },
        {
          label: "Credit for the goods",
          value: formatMoney(approved),
          strong: true,
        },
        {
          label: "Back on the shelf",
          value: restock ? plural(approvedUnits, "unit") : "No",
        },
      ]}
      confirmLabel={`Complete and credit ${formatMoney(approved)}`}
      onConfirm={async () => {
        const result = await decide.mutateAsync("complete");
        notify.success(
          `${record.returnNumber} completed`,
          `${formatMoney(result.return.creditAmount ?? approved)} credited on ${record.orderNumber}.${
            result.return.restockedAt ? " The units are back in stock." : ""
          }`,
        );
      }}
    >
      <p className="text-13 text-ink-muted">
        When nothing of the order is kept, the delivery fee is credited as well.
      </p>
      <div className="flex items-start gap-3 rounded-md border border-line px-3 py-2.5">
        <Switch
          id={restockId}
          checked={restock}
          onCheckedChange={setRestock}
          aria-describedby={`${restockId}-hint`}
          className="mt-0.5"
        />
        <div className="flex min-w-0 flex-col">
          <label htmlFor={restockId} className="text-sm font-medium text-ink">
            Put the units back on the shelf
          </label>
          <p id={`${restockId}-hint`} className="text-13 text-ink-muted">
            Off by default: food that came back is not sold again unless you say
            so. On: the accepted units are added to the stock of each pack size.
          </p>
        </div>
      </div>
      {notes}
    </ConfirmDialog>
  );
}

export function ReturnView() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const adminName = useAdminNames();
  const [decision, setDecision] = useState<Decision>(null);
  const query = useQuery({
    queryKey: queryKeys.returns.detail(id),
    queryFn: async ({ signal }) => (await api.returns.get(id, signal)).return,
  });
  const record = query.data;
  const order = useQuery({
    queryKey: queryKeys.orders.detail(record?.orderId ?? ""),
    queryFn: async ({ signal }) =>
      (await api.orders.get(record?.orderId ?? "", signal)).order,
    enabled: Boolean(record),
  }).data;
  const back = { href: routes.returns, label: "Returns" };

  if (query.isError) {
    return (
      <RequirePermission permission="orders.read">
        <PageHeader title="Return" back={back} />
        <div className={gutter}>
          {hasErrorCode(
            query.error,
            "RETURN_NOT_FOUND",
            "VALIDATION_FAILED",
          ) ? (
            <EmptyState icon={<Undo2 />} title="This return does not exist" />
          ) : (
            <Alert
              tone="danger"
              title="The return could not be loaded"
              actions={
                <Button onClick={() => void query.refetch()}>Try again</Button>
              }
            >
              {errorMessage(query.error)}
            </Alert>
          )}
        </div>
      </RequirePermission>
    );
  }
  if (!record) {
    return (
      <RequirePermission permission="orders.read">
        <PageHeader title={<Skeleton className="h-9 w-44" />} back={back} />
        <PageBody>
          <Skeleton className="h-64 rounded-lg" />
        </PageBody>
      </RequirePermission>
    );
  }

  const next = RETURN_TRANSITIONS[record.status];
  const refundable = record.status === "completed";

  return (
    <RequirePermission permission="orders.read">
      <PageHeader
        back={back}
        title={record.returnNumber}
        badges={<StatusBadge kind="return" value={record.status} />}
        description={
          <>
            Order{" "}
            <Link
              href={routes.order(record.orderId)}
              className="font-medium text-accent-text hover:underline"
            >
              {record.orderNumber}
            </Link>
            {order ? ` · ${personName(order.customer)}` : ""} · asked{" "}
            <DateTime value={record.requestedAt} />
          </>
        }
        actions={
          <>
            {next.includes("rejected") ? (
              <ActionButton
                permission="orders.manage"
                variant="danger-outline"
                onClick={() => setDecision("reject")}
              >
                Decline
              </ActionButton>
            ) : null}
            {next.includes("approved") ? (
              <ActionButton
                permission="orders.manage"
                variant="primary"
                onClick={() => setDecision("approve")}
              >
                Approve
              </ActionButton>
            ) : null}
            {next.includes("completed") ? (
              <ActionButton
                permission="orders.manage"
                variant="primary"
                onClick={() => setDecision("complete")}
              >
                The goods are back
              </ActionButton>
            ) : null}
          </>
        }
      />
      <PageBody>
        {record.status === "approved" ? (
          <Alert tone="time" title="Waiting for the goods">
            The return is approved. Complete it when the goods are back: only
            then the bill of the order goes down.
          </Alert>
        ) : null}
        {refundable ? (
          <Alert
            tone="info"
            title={`${formatMoney(record.creditAmount ?? 0)} was credited on ${record.orderNumber}`}
            actions={
              can("payments.read") ? (
                <Button asChild size="sm">
                  <Link href={`${routes.order(record.orderId)}#payment`}>
                    Open the payment of the order
                  </Link>
                </Button>
              ) : null
            }
          >
            {order?.payment.needsRefund
              ? "The customer is owed this amount; it waits for your refund decision on the order."
              : "The refund of this amount was decided on the order."}
          </Alert>
        ) : null}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader title="Products" />
              <ScrollX label={`Products of ${record.returnNumber}`}>
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Products of {record.returnNumber}
                  </caption>
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-muted">
                      <th
                        scope="col"
                        className="px-4 py-2 text-left font-semibold sm:px-5"
                      >
                        Product
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-left font-semibold"
                      >
                        Reason
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-semibold"
                      >
                        Asked
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-semibold"
                      >
                        Accepted
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-2 text-right font-semibold sm:px-5"
                      >
                        Unit price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.items.map((item) => (
                      <tr
                        key={item.variantId}
                        className="border-b border-line last:border-b-0"
                      >
                        <th
                          scope="row"
                          className="px-4 py-2.5 text-left font-normal sm:px-5"
                        >
                          {translated(item.name)}{" "}
                          <span className="text-ink-muted">
                            {item.packSize.label}
                          </span>
                          <span className="block text-13 text-ink-subtle">
                            {item.sku}
                          </span>
                        </th>
                        <td className="px-3 py-2.5">
                          {humanize(item.reason)}
                          {item.comment ? (
                            <span className="block text-13 text-ink-muted">
                              “{item.comment}”
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {item.quantity}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {item.approvedQuantity ?? (
                            <span className="text-ink-subtle">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right sm:px-5">
                          <Money cents={item.unitPrice} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollX>
              <CardBody className="border-t border-line">
                <dl className="grid gap-4 sm:grid-cols-3">
                  <Fact label="Asked back">
                    <Money cents={record.requestedAmount} />
                  </Fact>
                  <Fact label="Credited">
                    {record.creditAmount === null ? (
                      <span className="text-ink-subtle">
                        Not yet: on completion
                      </span>
                    ) : (
                      <Money
                        cents={record.creditAmount}
                        className="font-semibold"
                      />
                    )}
                  </Fact>
                  <Fact label="Units">
                    {plural(
                      record.items.reduce(
                        (sum, item) => sum + item.quantity,
                        0,
                      ),
                      "unit",
                    )}
                  </Fact>
                  {record.status === "completed" ? (
                    <Fact label="Restocked">
                      {record.restockedAt ? (
                        <DateTime value={record.restockedAt} />
                      ) : (
                        <span className="text-ink-subtle">
                          No: the units were not put back on the shelf
                        </span>
                      )}
                    </Fact>
                  ) : null}
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <dl className="grid gap-4">
                  <Fact label="The customer wrote">
                    {record.customerComment ? (
                      `“${record.customerComment}”`
                    ) : (
                      <span className="text-ink-subtle">Nothing</span>
                    )}
                  </Fact>
                  <Fact label="What the customer was told">
                    {record.decisionNote ? (
                      `“${record.decisionNote}”`
                    ) : (
                      <span className="text-ink-subtle">Nothing yet</span>
                    )}
                  </Fact>
                  <Fact label="Internal note (never shown to the customer)">
                    {record.internalNote ?? (
                      <span className="text-ink-subtle">None</span>
                    )}
                  </Fact>
                </dl>
              </CardBody>
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader title="History" />
              <CardBody>
                <Timeline
                  entries={[...record.statusHistory]
                    .reverse()
                    .map((entry, index) => ({
                      key: `${entry.at}-${index}`,
                      at: entry.at,
                      title: RETURN_STATUS[entry.to].label,
                      tone: RETURN_STATUS[entry.to].tone,
                      by:
                        entry.by === "admin"
                          ? adminName(entry.adminId)
                          : entry.by === "customer"
                            ? "The customer"
                            : "The system",
                      note: entry.note,
                    }))}
                />
              </CardBody>
            </Card>
            {order ? (
              <Card>
                <CardHeader title="The order" />
                <CardBody>
                  <dl className="grid gap-4">
                    <Fact label="Order">
                      <Link
                        href={routes.order(order.id)}
                        className="font-medium text-accent-text hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </Fact>
                    <Fact label="Status">
                      <span className="flex flex-wrap gap-1.5">
                        <StatusBadge kind="order" value={order.status} />
                        <StatusBadge
                          kind="payment"
                          value={order.paymentStatus}
                        />
                      </span>
                    </Fact>
                    <Fact label="Final bill">
                      <Money cents={order.finalTotal} />
                    </Fact>
                  </dl>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      </PageBody>
      <Decide
        record={record}
        decision={decision}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
      />
    </RequirePermission>
  );
}
