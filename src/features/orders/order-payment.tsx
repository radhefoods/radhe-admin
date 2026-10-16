"use client";

import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActionButton } from "@/components/domain/permission";
import { StatusBadge } from "@/components/domain/status-badge";
import { CopyButton, DateTime, Money } from "@/components/domain/values";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Select } from "@/components/ui/input";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Fact,
} from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import {
  MANUAL_REFUND_WAYS,
  REFUND_REASONS,
  type ManualRefundWay,
  type OrderDetail,
  type OrderPayment,
  type PaymentType,
  type RefundMethod,
  type RefundReason,
  type Refundable,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { formatDeadline } from "@/lib/format/dates";
import { formatMoney, parseEuros, centsToInput } from "@/lib/format/money";
import { plural } from "@/lib/format/names";
import { routes } from "@/lib/routes";
import { humanize } from "@/lib/status";
import { Labelled, NoteField } from "./order-dialogs";
import { useOrderPayment, type OrderActions } from "./queries";

/** How the customer paid on the Stripe page (11.1). */
export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  card: "Card",
  paypal: "PayPal",
};

// --- The refund dialog ------------------------------------------------------

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
        message: "Stripe cannot refund this order.",
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

/**
 * Decides a refund (11): through Stripe, or by hand. The amount the
 * cancellation or the credit notes call for is restated and prefilled;
 * nothing goes back without the admin confirming it here.
 */
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
        ...(refundable.suggested > 0
          ? [
              {
                label: "Waits for a refund",
                value: formatMoney(refundable.suggested),
                strong: true,
              },
            ]
          : []),
        {
          label: "Can be refunded",
          value: formatMoney(refundable.maximum),
          strong: refundable.suggested <= 0,
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
            : refund.status === "completed"
              ? "Stripe confirmed it; the customer is told."
              : refund.status === "failed"
                ? "Stripe could not refund it. Withdraw it and refund by hand."
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
              ? order.status === "cancelled"
                ? "Everything that was paid for the cancelled order."
                : "What the credit notes took off the bill."
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
            : "Through Stripe is not possible for this order: it was not paid through Stripe, or Stripe is not connected."
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
 * The payment of an order (11.1): paid at checkout through Stripe, so the
 * card only reads what happened and offers the one decision that is the
 * admin's, a refund. Money waits for it after a cancellation or a credit
 * note (`needsRefund`).
 */
export function OrderPaymentCard({
  order,
  actions,
}: {
  order: OrderDetail;
  actions: OrderActions;
}) {
  const can = useCan();
  const [refunding, setRefunding] = useState(false);
  const payment = order.payment;
  const details = useOrderPayment(order.id).data;
  const refundable = details?.refundable;
  const pending = order.status === "pending_payment";
  const pageOpen = payment.checkout !== null;

  return (
    <Card id="payment">
      <CardHeader
        title="Payment"
        description={
          pending
            ? "Paid at checkout on a Stripe page. The payment confirms the order; nothing is recorded by hand."
            : payment.invoice
              ? "Paid at checkout through Stripe. The invoice was issued the moment the money was captured."
              : "Nothing was paid for this order."
        }
        actions={
          refundable && refundable.maximum > 0 ? (
            <ActionButton
              permission="payments.manage"
              variant={payment.needsRefund ? "primary" : "secondary"}
              onClick={() => setRefunding(true)}
            >
              Refund
            </ActionButton>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Fact label="Status">
            <StatusBadge kind="payment" value={payment.status} />
          </Fact>
          <Fact label={payment.paidAt ? "Paid" : "To pay"}>
            {payment.paidAt ? (
              <span className="flex flex-col">
                <Money cents={payment.paidAmount} className="font-medium" />
                <span className="text-13 text-ink-muted">
                  {payment.method ? PAYMENT_TYPE_LABEL[payment.method] : "—"}{" "}
                  through Stripe · <DateTime value={payment.paidAt} short />
                </span>
              </span>
            ) : (
              <Money
                cents={payment.amount}
                className="font-display text-2xl leading-tight"
              />
            )}
          </Fact>
          <Fact label="Credited">
            <Money cents={payment.creditedAmount} muted />
          </Fact>
          <Fact label="Refunded">
            <Money cents={payment.refundedAmount} muted />
          </Fact>
          <Fact label="Invoice">
            {payment.invoice && payment.invoiceId ? (
              <Link
                href={routes.invoice(payment.invoiceId)}
                className="font-medium text-accent-text hover:underline"
              >
                {payment.invoice.number}
              </Link>
            ) : (
              <span className="text-ink-subtle">Issued when paid</span>
            )}
          </Fact>
          <Fact label="Receipt">
            {payment.receiptUrl ? (
              <a
                href={payment.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
              >
                Stripe receipt
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ) : (
              <span className="text-ink-subtle">—</span>
            )}
          </Fact>
          <Fact label="Attempts">
            {plural(payment.attempts, "payment page")}
          </Fact>
          <Fact label="Last failure">
            {payment.lastFailure ? (
              <span className="text-danger-fg">{payment.lastFailure}</span>
            ) : (
              <span className="text-ink-subtle">None</span>
            )}
          </Fact>
        </dl>

        {payment.paymentIntentId ? (
          <p className="text-13 text-ink-muted">
            Stripe payment{" "}
            <span className="font-mono text-xs">{payment.paymentIntentId}</span>
            {payment.chargeId ? (
              <>
                , charge{" "}
                <span className="font-mono text-xs">{payment.chargeId}</span>
              </>
            ) : null}
            {payment.authorizedAt ? (
              <>
                , approved <DateTime value={payment.authorizedAt} short />
              </>
            ) : null}
            .
          </p>
        ) : null}

        {pending ? (
          <Alert
            tone={pageOpen ? "time" : "info"}
            title={
              pageOpen
                ? `The payment page is open until ${formatDeadline(payment.checkout!.expiresAt)}`
                : payment.status === "failed"
                  ? "The last attempt did not go through"
                  : "The customer has not paid yet"
            }
            actions={
              pageOpen ? (
                <span className="flex items-center gap-1">
                  <a
                    href={payment.checkout!.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-13 font-medium text-accent-text hover:underline"
                  >
                    Open the payment page
                    <ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                  <CopyButton
                    value={payment.checkout!.url}
                    label="Copy the link to the payment page"
                  />
                </span>
              ) : null
            }
          >
            {pageOpen
              ? "The customer pays on Stripe's page; the payment confirms the order. The link can be sent to a customer who lost the page."
              : payment.canPayOnline
                ? "The customer can open a new payment page from the order page in the shop. Nothing is reserved meanwhile."
                : "The page expired. The shop gives the order up once the grace time has passed; nothing was charged."}
          </Alert>
        ) : null}

        {payment.needsRefund && refundable ? (
          <Alert
            tone="time"
            title={`${formatMoney(refundable.suggested > 0 ? refundable.suggested : refundable.maximum)} waits for a refund`}
            actions={
              <ActionButton
                permission="payments.manage"
                size="sm"
                onClick={() => setRefunding(true)}
              >
                Decide the refund
              </ActionButton>
            }
          >
            {order.status === "cancelled"
              ? "The order was cancelled after it was paid. Refunding is your decision: through Stripe, or by hand."
              : "A credit note lowered the bill after it was paid. Refunding is your decision: through Stripe, or by hand."}
          </Alert>
        ) : payment.needsRefund && !can("payments.read") ? (
          <Alert tone="time" title="Money waits for a refund">
            Deciding it needs the permission “Payments: manage”.
          </Alert>
        ) : null}

        {details ? <Documents data={details} /> : null}
        {!can("payments.read") ? (
          <p className="text-13 text-ink-subtle">
            Documents and refunds need the permission “Payments: read”.
          </p>
        ) : null}
      </CardBody>

      {refundable ? (
        <RefundDialog
          order={order}
          refundable={refundable}
          open={refunding}
          actions={actions}
          onOpenChange={setRefunding}
        />
      ) : null}
    </Card>
  );
}
