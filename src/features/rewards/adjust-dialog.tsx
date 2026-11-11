"use client";

import { useId, useState } from "react";
import { Field } from "@/components/form/form";
import { ReasonField } from "@/components/form/reason-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import {
  REWARD_ADJUSTMENT_REASONS,
  REWARDS_RULES,
  type Id,
  type RewardAccount,
  type RewardAdjustmentReason,
} from "@/lib/api/types";
import { useAdjustCoins } from "./queries";
import {
  REWARD_REASON_LABEL,
  balanceText,
  coinsText,
  signedCoins,
} from "./rules";

/** The note is for the team and the customer's history; the API keeps it with the row. */
const NOTE_MAX = 500;

const WAYS = [
  {
    value: "add",
    label: "Add coins",
    explanation:
      "Goodwill after a problem, or a correction in the customer's favour.",
  },
  {
    value: "take",
    label: "Take coins away",
    explanation:
      "A correction or misuse. The balance can go below zero and must then be earned off.",
  },
] as const;

/**
 * Coins by hand (30): a direction, a whole number, the reason the API
 * records, and a note. The dialog restates the balance before and after.
 */
export function AdjustDialog({
  customerId,
  account,
  name,
  open,
  onOpenChange,
}: {
  customerId: Id;
  account: RewardAccount;
  /** The customer's name, for the message. */
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const adjust = useAdjustCoins(customerId);
  const [way, setWay] = useState<"add" | "take">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<RewardAdjustmentReason>("goodwill");
  const [note, setNote] = useState("");
  const groupId = useId();
  const amountId = useId();
  const reasonId = useId();

  const text = amount.trim();
  const whole = /^\d+$/.test(text) ? Number(text) : null;
  const valid = whole !== null && whole >= 1 && whole <= REWARDS_RULES.coinsMax;
  const coins = valid ? (way === "add" ? whole : -whole) : 0;
  const after = account.balance + coins;

  const reset = (next: boolean) => {
    if (!next) {
      setWay("add");
      setAmount("");
      setReason("goodwill");
      setNote("");
    }
    onOpenChange(next);
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={reset}
      title={`Adjust the coins of ${name}`}
      description="One row of the ledger, written once with your name, the reason and the note. The customer sees it as “Adjusted by Radhe Foods”."
      facts={[
        { label: "Balance now", value: balanceText(account.balance) },
        {
          label: "After",
          value: valid ? balanceText(after) : "—",
          strong: true,
        },
      ]}
      confirmLabel={
        valid
          ? way === "add"
            ? `Add ${coinsText(whole)}`
            : `Take ${coinsText(whole)} away`
          : "Adjust the coins"
      }
      tone={way === "take" ? "danger" : "primary"}
      canConfirm={valid}
      onConfirm={async () => {
        const result = await adjust.mutateAsync({
          coins,
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        notify.success(
          "Coins adjusted",
          `${signedCoins(result.transaction.coins)} for ${name}: ${coinsText(result.account.available)} available now.`,
        );
      }}
    >
      <RadioGroup
        aria-label="What to do"
        value={way}
        onValueChange={(value) => setWay(value as "add" | "take")}
        className="gap-3"
      >
        {WAYS.map((option) => (
          <div key={option.value} className="flex items-start gap-2.5">
            <RadioItem
              id={`${groupId}-${option.value}`}
              value={option.value}
              aria-describedby={`${groupId}-${option.value}-hint`}
              className="mt-0.5"
            />
            <div className="flex min-w-0 flex-col">
              <label
                htmlFor={`${groupId}-${option.value}`}
                className="text-sm font-medium text-ink"
              >
                {option.label}
              </label>
              <p
                id={`${groupId}-${option.value}-hint`}
                className="text-13 text-ink-muted"
              >
                {option.explanation}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Coins"
          htmlFor={amountId}
          required
          error={
            text !== "" && !valid
              ? `A whole number, 1 to ${REWARDS_RULES.coinsMax.toLocaleString("en")}.`
              : null
          }
        >
          <Input
            id={amountId}
            inputMode="numeric"
            autoComplete="off"
            className="tabular"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={text !== "" && !valid ? true : undefined}
          />
        </Field>
        <Field label="Reason" htmlFor={reasonId} required>
          <Select
            id={reasonId}
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as RewardAdjustmentReason)
            }
          >
            {REWARD_ADJUSTMENT_REASONS.map((value) => (
              <option key={value} value={value}>
                {REWARD_REASON_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ReasonField
        label="Note"
        value={note}
        onChange={setNote}
        maxLength={NOTE_MAX}
        rows={2}
        hint="What happened, for whoever reads the ledger later."
        placeholder="A late delivery in October; the customer was very patient."
      />
    </ConfirmDialog>
  );
}
