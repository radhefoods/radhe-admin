"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notify } from "@/components/ui/toast";
import type { Customer } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format/dates";
import { personName } from "@/lib/format/names";
import { useSetCustomerStatus } from "./queries";
import { ReasonField } from "@/components/form/reason-field";
import { BLOCK_REASON_MAX, toStatusInput } from "./schemas";

/**
 * Blocks or unblocks a customer's account. Blocking is the strongest thing
 * the panel can do to a customer, so the confirmation says exactly what it
 * does before it happens.
 */
export function CustomerStatusDialog({
  customer,
  open,
  onOpenChange,
}: {
  customer: Customer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const setStatus = useSetCustomerStatus(customer.id);
  const name = personName(customer);
  const blocking = customer.status === "active";

  function change(next: boolean) {
    if (!next) setReason("");
    onOpenChange(next);
  }

  if (blocking) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={change}
        title={`Block ${name}?`}
        description="Blocking signs the customer out everywhere and refuses sign-in and ordering, until the account is unblocked."
        facts={[{ label: "Account", value: customer.email }]}
        tone="danger"
        confirmLabel="Block the account"
        cancelLabel="Keep it active"
        onConfirm={async () => {
          await setStatus.mutateAsync(toStatusInput("blocked", reason));
          notify.success(
            `${name} is blocked`,
            "Signed out everywhere; sign-in and ordering are refused.",
          );
        }}
      >
        <ReasonField
          label="Reason"
          value={reason}
          onChange={setReason}
          maxLength={BLOCK_REASON_MAX}
          hint="Stored with the block and shown to the team on this page. The customer does not see it."
        />
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={change}
      title={`Unblock ${name}?`}
      description="The customer can sign in and order again."
      facts={[
        { label: "Account", value: customer.email },
        { label: "Blocked since", value: formatDateTime(customer.blockedAt) },
      ]}
      confirmLabel="Unblock the account"
      cancelLabel="Keep it blocked"
      onConfirm={async () => {
        await setStatus.mutateAsync(toStatusInput("active"));
        notify.success(
          `${name} is unblocked`,
          "The customer can sign in and order again.",
        );
      }}
    >
      {customer.blockedReason ? (
        <p className="text-13 text-ink-muted">
          Blocked because:{" "}
          <span className="text-ink">{customer.blockedReason}</span>
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
