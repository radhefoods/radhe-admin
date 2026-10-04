"use client";

import { useState, type ReactNode } from "react";
import { Field, useControlProps } from "@/components/form/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/surface";
import { notify } from "@/components/ui/toast";
import type {
  Customer,
  CustomerOrdering,
  OrderingAction,
} from "@/lib/api/types";
import { formatDeadline } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { personName, plural } from "@/lib/format/names";
import { useDecideOrdering } from "./queries";
import { ReasonField } from "@/components/form/reason-field";
import {
  ALLOW_DAYS,
  DECISION_REASON_MAX,
  allowedUntil,
  decisionProblems,
  parseAllowDays,
  toOrderingDecision,
} from "./schemas";

function DaysInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-36">
      <Input
        {...useControlProps()}
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pr-14 tabular"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-13 text-ink-subtle"
      >
        days
      </span>
    </div>
  );
}

/**
 * One confirmation for the three decisions about a customer's ordering:
 * block it, allow it for some days although a payment is overdue, or clear
 * the decision. Each needs a reason, which the API records with the admin.
 */
export function OrderingDecisionDialog({
  customer,
  ordering,
  action,
  onOpenChange,
}: {
  customer: Customer;
  ordering: CustomerOrdering["ordering"];
  /** The decision to take; `null` closes the dialog. */
  action: OrderingAction | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const decide = useDecideOrdering(customer.id);

  if (!action) return null;

  const name = personName(customer);
  const values = { action, reason, allowDays: days };
  const problems = decisionProblems(values);
  const validDays = parseAllowDays(days);
  const overdue = ordering.overdue;
  const overdueAmount = overdue.reduce(
    (sum, entry) => sum + entry.amountDue,
    0,
  );
  const overdueText =
    overdue.length > 0
      ? `${plural(overdue.length, "payment")}, ${formatMoney(overdueAmount)}`
      : "Nothing";
  const accountBlocked = customer.status === "blocked";

  let title: string;
  let description: ReactNode;
  let facts: { label: ReactNode; value: ReactNode; strong?: boolean }[];
  let confirmLabel: string;
  let done: string;

  if (action === "block") {
    title = `Block ordering for ${name}?`;
    description =
      "The customer can place no new order until the decision is cleared. The account stays usable: browsing, the cart and paying still work.";
    facts = [
      { label: "Account", value: customer.email },
      { label: "Overdue now", value: overdueText },
    ];
    confirmLabel = "Block ordering";
    done = `Ordering is blocked for ${name}`;
  } else if (action === "allow") {
    title =
      overdue.length > 0
        ? `Let ${name} order although a payment is overdue?`
        : `Allow ${name} to order for a while?`;
    description =
      "For the days you set, an overdue payment does not stop a new order. Afterwards the normal rule applies again: no new order while a payment is overdue.";
    facts = [
      { label: "Overdue now", value: overdueText },
      {
        label: "May order until",
        value:
          validDays !== null ? (
            <span className="text-gold">
              {formatDeadline(allowedUntil(validDays))} German time
            </span>
          ) : (
            "—"
          ),
        strong: true,
      },
    ];
    confirmLabel =
      validDays !== null
        ? `Allow for ${plural(validDays, "day")}`
        : "Allow ordering";
    done =
      validDays !== null
        ? `${name} may order for ${plural(validDays, "day")}`
        : `${name} may order`;
  } else {
    const blocked = ordering.override?.mode === "blocked";
    title = `Clear the ordering decision for ${name}?`;
    description = blocked
      ? `The block on ordering ends.${
          overdue.length > 0
            ? " A payment is overdue, so the customer still cannot order until it is paid, or until you allow it for a while."
            : ""
        }`
      : `The allowance ends now.${
          overdue.length > 0
            ? " A payment is overdue, so the customer cannot order until it is paid."
            : ""
        }`;
    facts = [
      {
        label: "Decision in force",
        value: blocked
          ? "Ordering blocked"
          : ordering.override?.until
            ? `Allowed until ${formatDeadline(ordering.override.until)}`
            : "Allowed to order",
      },
      { label: "Overdue now", value: overdueText },
    ];
    confirmLabel = "Clear the decision";
    done = `The ordering decision for ${name} is cleared`;
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          setDays("7");
        }
        onOpenChange(open);
      }}
      title={title}
      description={description}
      facts={facts}
      tone={action === "block" ? "danger" : "primary"}
      confirmLabel={confirmLabel}
      canConfirm={Object.keys(problems).length === 0}
      onConfirm={async () => {
        await decide.mutateAsync(toOrderingDecision(values));
        notify.success(done);
      }}
    >
      {accountBlocked && action !== "clear" ? (
        <Alert tone="warning" title="The account is blocked">
          Whatever is decided here, the customer cannot sign in or order until
          the account is unblocked.
        </Alert>
      ) : null}

      {action === "allow" ? (
        <Field
          label="Allow for"
          required
          error={problems.allowDays}
          hint={
            problems.allowDays
              ? undefined
              : `${ALLOW_DAYS.min} to ${ALLOW_DAYS.max} days, counted from now.`
          }
        >
          <DaysInput value={days} onChange={setDays} />
        </Field>
      ) : null}

      <ReasonField
        label="Reason"
        required
        value={reason}
        onChange={setReason}
        maxLength={DECISION_REASON_MAX}
        hint={
          action === "allow"
            ? "Kept in the history of decisions with your name. Example: promised to pay on Friday."
            : "Kept in the history of decisions with your name."
        }
      />
    </ConfirmDialog>
  );
}
