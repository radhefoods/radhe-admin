"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { AdminName, DateTime, Money } from "@/components/domain/values";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Fact,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import { useDefaultDeadlineDays } from "@/features/cargos/queries";
import { hasErrorCode } from "@/lib/api/errors";
import {
  MANUAL_REFUND_WAYS,
  REFUND_REASONS,
  type ManualRefundWay,
  type OrderDetail,
  type OrderPayment,
  type PaymentBlockActive,
  type RefundMethod,
  type RefundReason,
  type Refundable,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/cn";
import {
  berlinToDate,
  formatDeadline,
  paymentDeadline,
  toLocalInput,
} from "@/lib/format/dates";
import { formatMoney, parseEuros, centsToInput } from "@/lib/format/money";
import { personName, plural } from "@/lib/format/names";
import { useNow } from "@/lib/hooks/use-now";
import { routes } from "@/lib/routes";
import { humanize } from "@/lib/status";
import { Labelled, NoteField } from "./order-dialogs";
import { useOrderPayment, type OrderActions } from "./queries";

const METHOD: Record<string, string> = {
  stripe: "Online (Stripe)",
  cash: "Cash",
  credit: "Settled by credit notes",
};

// --- Dialogs ----------------------------------------------------------------

/** Issues the invoice and sends the payment request for one order. */
function ActivateDialog({
  order,
  open,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const fallback = useDefaultDeadlineDays();
  const [days, setDays] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const text = days ?? String(fallback);
  const deadlineDays = /^\d{1,2}$/.test(text.trim())
    ? Number(text)
    : Number.NaN;
  const valid = deadlineDays >= 1 && deadlineDays <= 60;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setDays(null);
          setNote("");
          actions.activatePayment.reset();
        }
        onOpenChange(value);
      }}
      title={`Activate payment for ${order.orderNumber}?`}
      description="The invoice is issued from the final bill and emailed to the customer as a PDF with the payment link. A reminder follows every day until the order is paid."
      facts={[
        { label: "Customer", value: personName(order.customer) },
        {
          label: "Amount due",
          value: formatMoney(order.finalTotal),
          strong: true,
        },
        {
          label: "Pay by",
          value: valid ? (
            <span className="text-gold">
              {formatDeadline(paymentDeadline(deadlineDays))} German time
            </span>
          ) : (
            "—"
          ),
        },
      ]}
      confirmLabel="Activate and send the invoice"
      canConfirm={valid}
      errorHelp={(error) =>
        hasErrorCode(error, "COMPANY_DETAILS_MISSING") ? (
          <Link href={routes.settingsCompany}>
            Complete the company settings
          </Link>
        ) : null
      }
      onConfirm={async () => {
        await actions.activatePayment.mutateAsync({
          deadlineDays,
          note: note.trim() || undefined,
        });
        notify.success(`Payment activated for ${order.orderNumber}`);
      }}
    >
      <Labelled
        label="Days to pay"
        error={valid ? null : "Between 1 and 60 days."}
        hint="The deadline is the end of that day in Germany."
      >
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            value={text}
            onChange={(event) => setDays(event.target.value)}
            aria-invalid={valid ? undefined : true}
            className="w-28 tabular"
          />
        )}
      </Labelled>
      <NoteField value={note} onChange={setNote} />
    </ConfirmDialog>
  );
}

/** Records the cash the driver collected: always the full amount due. */
function CashDialog({
  order,
  payment,
  open,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  payment: PaymentBlockActive;
  open: boolean;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const [when, setWhen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const now = useNow();
  const collected = when === null ? null : berlinToDate(when);
  const valid =
    when === null ||
    (collected !== null && collected.getTime() <= now.getTime() + 60_000);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setWhen(null);
          setNote("");
        }
        onOpenChange(value);
      }}
      title={`Record cash for ${order.orderNumber}?`}
      description="The order is marked as paid in cash and the customer gets a receipt by email. Partial payments are not offered: the amount is the full amount due."
      facts={[
        { label: "Customer", value: personName(order.customer) },
        { label: "Invoice", value: payment.invoice.number },
        {
          label: "Cash received",
          value: formatMoney(payment.amountDue),
          strong: true,
        },
      ]}
      confirmLabel={`Record ${formatMoney(payment.amountDue)} in cash`}
      canConfirm={valid}
      onConfirm={async () => {
        await actions.recordCash.mutateAsync({
          amount: payment.amountDue,
          collectedAt: collected ? collected.toISOString() : undefined,
          note: note.trim() || undefined,
        });
        notify.success(`${formatMoney(payment.amountDue)} recorded as cash`);
      }}
    >
      <Labelled
        label="Collected at"
        optional
        hint="German time. Leave empty for now."
        error={valid ? null : "This time lies in the future."}
      >
        {(id) => (
          <Input
            id={id}
            type="datetime-local"
            value={when ?? ""}
            max={toLocalInput(new Date())}
            onChange={(event) => setWhen(event.target.value || null)}
            className="tabular"
          />
        )}
      </Labelled>
      <NoteField value={note} onChange={setNote} label="Note" />
    </ConfirmDialog>
  );
}

/** Lets the customer off what is owed. */
function WaiveDialog({
  order,
  payment,
  open,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  payment: PaymentBlockActive;
  open: boolean;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setReason("");
        onOpenChange(value);
      }}
      title={`Waive the payment of ${order.orderNumber}?`}
      description="The customer is let off what is owed. Reminders stop and the money is not collected. This cannot be taken back."
      tone="danger"
      facts={[
        { label: "Customer", value: personName(order.customer) },
        {
          label: "Not collected",
          value: formatMoney(payment.amountDue),
          strong: true,
        },
      ]}
      confirmLabel={`Waive ${formatMoney(payment.amountDue)}`}
      cancelLabel="Keep the payment"
      canConfirm={reason.trim().length > 0}
      onConfirm={async () => {
        await actions.waive.mutateAsync(reason.trim());
        notify.success(`Payment of ${order.orderNumber} waived`);
      }}
    >
      <Labelled label="Reason">
        {(id) => (
          <Textarea
            id={id}
            rows={2}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-0"
          />
        )}
      </Labelled>
    </ConfirmDialog>
  );
}

export interface RefundProblem {
  field: "amount" | "method" | "way";
  message: string;
}

/** What the refund form sends, or why it cannot be sent yet. */
export function readRefund(
  input: { amount: string; method: RefundMethod; way: ManualRefundWay | "" },
  refundable: Refundable,
): { cents: number | null; problem: RefundProblem | null } {
  const cents = parseEuros(input.amount);
  const amount = (message: string) => ({
    cents,
    problem: { field: "amount" as const, message },
  });
  if (cents === null) {
    return amount(
      input.amount.trim() === ""
        ? "Enter an amount."
        : "This is not an amount.",
    );
  }
  if (cents < 1) return amount("At least €0.01.");
  if (cents > refundable.maximum) {
    return amount(
      `At most ${formatMoney(refundable.maximum)} can be refunded.`,
    );
  }
  if (input.method === "stripe" && !refundable.stripePossible) {
    return {
      cents,
      problem: {
        field: "method",
        message: "This order was not paid through Stripe.",
      },
    };
  }
  if (input.method === "manual" && input.way === "") {
    return {
      cents,
      problem: { field: "way", message: "Choose how the money is sent." },
    };
  }
  return { cents, problem: null };
}

/** Decides a refund: through Stripe, or by hand. */
function RefundDialog({
  order,
  refundable,
  open,
  actions,
  onOpenChange,
}: {
  order: OrderDetail;
  refundable: Refundable;
  open: boolean;
  actions: OrderActions;
  onOpenChange: (open: boolean) => void;
}) {
  const suggested =
    refundable.suggested > 0 ? refundable.suggested : refundable.maximum;
  const [amount, setAmount] = useState<string | null>(null);
  const [reason, setReason] = useState<RefundReason | "">("");
  const [method, setMethod] = useState<RefundMethod | null>(null);
  const [way, setWay] = useState<ManualRefundWay | "">("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const amountText = amount ?? centsToInput(suggested);
  const currentMethod: RefundMethod =
    method ?? (refundable.stripePossible ? "stripe" : "manual");
  const read = readRefund(
    { amount: amountText, method: currentMethod, way },
    refundable,
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setAmount(null);
          setReason("");
          setMethod(null);
          setWay("");
          setReference("");
          setNote("");
        }
        onOpenChange(value);
      }}
      title={`Refund ${order.orderNumber}`}
      description={
        currentMethod === "stripe"
          ? "The money goes back to the card or PayPal account it came from. The refund completes when Stripe confirms; the customer is told then."
          : "You send the money yourself, then mark the refund as complete (Refunds). The customer is told when it is complete."
      }
      facts={[
        { label: "Paid", value: formatMoney(refundable.paidAmount) },
        ...(refundable.refundedAmount > 0
          ? [
              {
                label: "Refunded already",
                value: formatMoney(refundable.refundedAmount),
              },
            ]
          : []),
        ...(refundable.openAmount > 0
          ? [
              {
                label: "In open refunds",
                value: formatMoney(refundable.openAmount),
              },
            ]
          : []),
        {
          label: "Can be refunded",
          value: formatMoney(refundable.maximum),
          strong: true,
        },
      ]}
      confirmLabel={
        read.cents !== null && read.problem?.field !== "amount"
          ? `Refund ${formatMoney(read.cents)}`
          : "Refund"
      }
      canConfirm={read.problem === null && reason !== ""}
      onConfirm={async () => {
        if (read.cents === null || reason === "") return;
        const { refund } = await actions.createRefund.mutateAsync({
          amount: read.cents,
          reason,
          method: currentMethod,
          manual:
            currentMethod === "manual" && way !== ""
              ? { way, reference: reference.trim() || undefined }
              : undefined,
          note: note.trim() || undefined,
        });
        notify.success(
          `Refund ${refund.refundNumber} decided`,
          refund.status === "pending"
            ? "Send the money, then mark it as complete under Refunds."
            : "Stripe is working on it.",
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled
          label="Amount"
          error={read.problem?.field === "amount" ? read.problem.message : null}
          hint={
            refundable.suggested > 0
              ? `Credit notes left ${formatMoney(refundable.suggested)} over.`
              : undefined
          }
        >
          {(id) => (
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
              >
                €
              </span>
              <Input
                id={id}
                inputMode="decimal"
                value={amountText}
                onChange={(event) => setAmount(event.target.value)}
                className="pl-7 tabular"
              />
            </div>
          )}
        </Labelled>
        <Labelled label="Reason">
          {(id) => (
            <Select
              id={id}
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as RefundReason | "")
              }
            >
              <option value="">Choose a reason</option>
              {REFUND_REASONS.map((entry) => (
                <option key={entry} value={entry}>
                  {humanize(entry)}
                </option>
              ))}
            </Select>
          )}
        </Labelled>
      </div>
      <Labelled
        label="How"
        hint={
          refundable.stripePossible
            ? undefined
            : "Through Stripe is only possible for an order that was paid online."
        }
      >
        {(id) => (
          <Select
            id={id}
            value={currentMethod}
            onChange={(event) => setMethod(event.target.value as RefundMethod)}
          >
            {refundable.stripePossible ? (
              <option value="stripe">
                Through Stripe, back to the card or PayPal
              </option>
            ) : null}
            <option value="manual">By hand</option>
          </Select>
        )}
      </Labelled>
      {currentMethod === "manual" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Sent by">
            {(id) => (
              <Select
                id={id}
                value={way}
                onChange={(event) =>
                  setWay(event.target.value as ManualRefundWay | "")
                }
              >
                <option value="">Choose</option>
                {MANUAL_REFUND_WAYS.map((entry) => (
                  <option key={entry} value={entry}>
                    {humanize(entry)}
                  </option>
                ))}
              </Select>
            )}
          </Labelled>
          <Labelled
            label="Reference"
            optional
            hint="An IBAN or a transfer reference."
          >
            {(id) => (
              <Input
                id={id}
                value={reference}
                maxLength={200}
                onChange={(event) => setReference(event.target.value)}
              />
            )}
          </Labelled>
        </div>
      ) : null}
      <NoteField
        value={note}
        onChange={setNote}
        label="Internal note"
        maxLength={1000}
      />
    </ConfirmDialog>
  );
}

// --- The card ---------------------------------------------------------------

type DialogName = "activate" | "cash" | "waive" | "refund" | "remind" | null;

function Documents({ data }: { data: OrderPayment }) {
  if (data.documents.length === 0 && data.refunds.length === 0) return null;
  return (
    <div className="grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
      {data.documents.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-muted">Documents</h3>
          <ul className="flex flex-col gap-1.5">
            {data.documents.map((document) => (
              <li key={document.id} className="flex items-center gap-2 text-sm">
                <FileText
                  aria-hidden="true"
                  className="size-4 shrink-0 text-ink-subtle"
                />
                <Link
                  href={routes.invoice(document.id)}
                  className="font-medium text-accent-text hover:underline"
                >
                  {document.number}
                </Link>
                <span className="text-13 text-ink-muted">
                  {document.type === "credit_note"
                    ? `Credit note, ${humanize(document.creditReason ?? "adjustment").toLowerCase()}`
                    : "Invoice"}
                </span>
                <Money
                  cents={
                    document.type === "credit_note"
                      ? -document.total
                      : document.total
                  }
                  className="ml-auto"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.refunds.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-muted">Refunds</h3>
          <ul className="flex flex-col gap-1.5">
            {data.refunds.map((refund) => (
              <li key={refund.id} className="flex items-center gap-2 text-sm">
                <Link
                  href={routes.refund(refund.id)}
                  className="font-medium text-accent-text hover:underline"
                >
                  {refund.refundNumber}
                </Link>
                <StatusBadge kind="refund" value={refund.status} />
                <Money cents={refund.amount} className="ml-auto" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The payment of an order: before activation what activating will do,
 * afterwards the invoice, what is owed, how it was paid, the reminders,
 * and every action the API allows right now (its `can…` flags decide).
 */
export function OrderPaymentCard({
  order,
  actions,
}: {
  order: OrderDetail;
  actions: OrderActions;
}) {
  const can = useCan();
  const [dialog, setDialog] = useState<DialogName>(null);
  const payment = order.payment;
  const active = payment.status !== "not_enabled" ? payment : null;
  const details = useOrderPayment(order.id, active !== null).data;
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  if (!active) {
    return (
      <Card id="payment">
        <CardHeader
          title="Payment"
          description="Nothing is collected when the customer orders. Payment begins after delivery, when it is activated."
          actions={
            <ActionButton
              permission="payments.manage"
              variant={payment.canActivate ? "primary" : "secondary"}
              blocked={
                payment.canActivate
                  ? null
                  : order.finalTotal <= 0
                    ? "The final bill is 0: there is nothing to invoice."
                    : "Payment can be activated once the order is delivered."
              }
              onClick={() => setDialog("activate")}
            >
              Activate payment
            </ActionButton>
          }
        />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Fact label="Payment status">
              <StatusBadge kind="payment" value="not_enabled" />
            </Fact>
            <Fact label="To invoice">
              <Money
                cents={order.finalTotal}
                className="text-lg font-semibold"
              />
            </Fact>
            <Fact label="Next step">
              {payment.canActivate
                ? "Activate payment: the invoice goes out."
                : "Deliver the order first."}
            </Fact>
          </dl>
        </CardBody>
        <ActivateDialog
          order={order}
          open={dialog === "activate"}
          actions={actions}
          onOpenChange={close}
        />
      </Card>
    );
  }

  const owing = active.status === "due" || active.status === "overdue";
  const refundable = details?.refundable;

  return (
    <Card id="payment">
      <CardHeader
        title="Payment"
        description={
          <>
            Invoice{" "}
            <Link
              href={routes.invoice(active.invoice.id)}
              className="font-medium text-accent-text hover:underline"
            >
              {active.invoice.number}
            </Link>
            , activated <DateTime value={active.activatedAt} />
            {active.activatedBy ? (
              <>
                {" "}
                by{" "}
                <AdminName
                  id={active.activatedBy}
                  admin={active.activatedByAdmin}
                />
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {active.canWaive ? (
              <ActionButton
                permission="payments.manage"
                variant="ghost"
                onClick={() => setDialog("waive")}
              >
                Waive
              </ActionButton>
            ) : null}
            {refundable && refundable.maximum > 0 ? (
              <ActionButton
                permission="payments.manage"
                onClick={() => setDialog("refund")}
              >
                Refund
              </ActionButton>
            ) : null}
            {active.canRecordCash ? (
              <ActionButton
                permission="payments.manage"
                variant="primary"
                onClick={() => setDialog("cash")}
              >
                Record cash
              </ActionButton>
            ) : null}
          </>
        }
      />
      <CardBody className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Fact label="Amount due">
            <Money
              cents={active.amountDue}
              className={cn(
                "font-display text-2xl leading-tight",
                active.amountDue === 0 && "text-ink-subtle",
              )}
            />
          </Fact>
          <Fact label="Status">
            <StatusBadge kind="payment" value={active.status} />
          </Fact>
          <Fact label="Pay by">
            <span
              className={cn(
                "font-medium",
                active.isOverdue ? "text-danger-fg" : owing ? "text-gold" : "",
              )}
            >
              {formatDeadline(active.deadline)}
            </span>
          </Fact>
          <Fact label={active.paidAt ? "Paid" : "Paid so far"}>
            {active.paidAt ? (
              <span className="flex flex-col">
                <Money cents={active.paidAmount} />
                <span className="text-13 text-ink-muted">
                  {METHOD[active.method ?? ""] ?? "—"} ·{" "}
                  <DateTime value={active.paidAt} short />
                </span>
              </span>
            ) : (
              <Money cents={active.paidAmount} muted />
            )}
          </Fact>
          <Fact label="Invoiced">
            <Money cents={active.invoicedAmount} />
          </Fact>
          <Fact label="Credited">
            <Money cents={active.creditedAmount} muted />
          </Fact>
          <Fact label="Refunded">
            <Money cents={active.refundedAmount} muted />
          </Fact>
          <Fact label="Online payment">
            {active.canPayOnline
              ? "The customer can pay with the link."
              : owing
                ? "Not set up: Stripe is not connected. Cash only."
                : "—"}
          </Fact>
        </dl>

        {active.cash ? (
          <p className="text-13 text-ink-muted">
            Cash collected <DateTime value={active.cash.collectedAt} />,
            recorded by{" "}
            <AdminName
              id={active.cash.recordedBy}
              admin={active.cash.recordedByAdmin}
            />
            {active.cash.note ? <>: “{active.cash.note}”</> : null}
          </p>
        ) : null}
        {active.stripe?.paymentIntentId ? (
          <p className="text-13 text-ink-muted">
            Paid by {active.stripe.paymentType ?? "card"} through Stripe (
            <span className="font-mono text-xs">
              {active.stripe.paymentIntentId}
            </span>
            )
            {active.stripe.receiptUrl ? (
              <>
                {" "}
                ·{" "}
                <a
                  href={active.stripe.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent-text hover:underline"
                >
                  Receipt
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {active.waivedReason ? (
          <Alert tone="info" title="This payment was waived">
            “{active.waivedReason}”
          </Alert>
        ) : null}
        {refundable && refundable.suggested > 0 ? (
          <Alert
            tone="time"
            title={`${formatMoney(refundable.suggested)} to give back`}
            actions={
              <ActionButton
                permission="payments.manage"
                size="sm"
                onClick={() => setDialog("refund")}
              >
                Refund {formatMoney(refundable.suggested)}
              </ActionButton>
            }
          >
            A credit note lowered the bill after it was paid. Refunding is your
            decision.
          </Alert>
        ) : null}

        {owing ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-sunken px-3.5 py-3 text-13">
            <p className="text-ink-muted">
              <span className="font-medium text-ink">
                {active.reminders.paused
                  ? "Reminders are paused."
                  : active.reminders.nextAt
                    ? `Next reminder ${formatDeadline(active.reminders.nextAt)}.`
                    : "No reminder is planned."}
              </span>{" "}
              {plural(active.reminders.sentCount, "reminder")} sent
              {active.reminders.lastSentAt ? (
                <>
                  , the last{" "}
                  <DateTime value={active.reminders.lastSentAt} short />
                </>
              ) : null}
              .
            </p>
            <div className="ml-auto flex flex-wrap gap-2">
              <ActionButton
                permission="payments.manage"
                size="sm"
                loading={actions.setRemindersPaused.isPending}
                onClick={() =>
                  actions.setRemindersPaused.mutate(!active.reminders.paused, {
                    onSuccess: () =>
                      notify.success(
                        active.reminders.paused
                          ? "Reminders resumed"
                          : "Reminders paused",
                      ),
                  })
                }
              >
                {active.reminders.paused
                  ? "Resume reminders"
                  : "Pause reminders"}
              </ActionButton>
              <ActionButton
                permission="payments.manage"
                size="sm"
                onClick={() => setDialog("remind")}
              >
                Remind now
              </ActionButton>
            </div>
          </div>
        ) : null}

        {details ? <Documents data={details} /> : null}
        {!can("payments.read") ? (
          <p className="text-13 text-ink-subtle">
            Documents and refunds need the permission “Payments: read”.
          </p>
        ) : null}
      </CardBody>

      <CashDialog
        order={order}
        payment={active}
        open={dialog === "cash"}
        actions={actions}
        onOpenChange={close}
      />
      <WaiveDialog
        order={order}
        payment={active}
        open={dialog === "waive"}
        actions={actions}
        onOpenChange={close}
      />
      {refundable ? (
        <RefundDialog
          order={order}
          refundable={refundable}
          open={dialog === "refund"}
          actions={actions}
          onOpenChange={close}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === "remind"}
        onOpenChange={close}
        title={`Send a reminder for ${order.orderNumber} now?`}
        description="The customer gets the payment reminder by email, and by WhatsApp when they asked for it. The daily reminders go on as planned."
        facts={[
          { label: "To", value: order.customer.email },
          {
            label: "Amount due",
            value: formatMoney(active.amountDue),
            strong: true,
          },
        ]}
        confirmLabel="Send the reminder"
        onConfirm={async () => {
          await actions.remindNow.mutateAsync();
          notify.success("Reminder sent");
        }}
      />
    </Card>
  );
}
