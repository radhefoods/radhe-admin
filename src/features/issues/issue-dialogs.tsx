"use client";

import { useId, useState } from "react";
import { ReasonField } from "@/components/form/reason-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RadioGroup, RadioItem } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import type { Id, Issue, IssueResolution } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { plural, translated } from "@/lib/format/names";
import type { IssueActions } from "./queries";
import {
  ISSUE_INTERNAL_NOTE_MAX,
  ISSUE_NOTE_MAX,
  ISSUE_WISH_LABEL,
  notesInput,
  refundInput,
} from "./rules";

export type IssueDecision = "review" | "resolve" | "reject" | null;

const WAYS: {
  value: IssueResolution;
  label: string;
  explanation: string;
}[] = [
  {
    value: "refund",
    label: "Refund the units",
    explanation:
      "The units come off the delivered quantity of the order. A credit note is issued and the money waits in the refund queue, as after a return.",
  },
  {
    value: "replacement",
    label: "Send a replacement",
    explanation:
      "Noted on the report; the replacement is sent by hand. The order and its bill stay as they are.",
  },
  {
    value: "none",
    label: "Settle with a note",
    explanation: "Nothing changes on the order. The customer reads your note.",
  },
];

function Notes({
  note,
  internalNote,
  onNote,
  onInternalNote,
  noteRequired = false,
}: {
  note: string;
  internalNote: string;
  onNote: (value: string) => void;
  onInternalNote: (value: string) => void;
  noteRequired?: boolean;
}) {
  return (
    <>
      <ReasonField
        label="Note to the customer"
        value={note}
        onChange={onNote}
        maxLength={ISSUE_NOTE_MAX}
        required={noteRequired}
        hint="Goes into the email about the decision."
      />
      <ReasonField
        label="Internal note"
        value={internalNote}
        onChange={onInternalNote}
        maxLength={ISSUE_INTERNAL_NOTE_MAX}
        rows={2}
        hint="For the team. The customer never sees it."
      />
    </>
  );
}

/**
 * The three decisions on a problem report (29). Resolving asks for the
 * way: a refund with the units per pack size prefilled from the report, a
 * replacement, or just a note.
 */
export function IssueDecideDialog({
  issue,
  decision,
  actions,
  onOpenChange,
}: {
  issue: Issue;
  decision: IssueDecision;
  actions: IssueActions;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  // The customer's wish is preselected; a report without products cannot be refunded by the unit.
  const [way, setWay] = useState<IssueResolution>(
    issue.items.length === 0 && issue.preferredResolution === "refund"
      ? "none"
      : issue.preferredResolution,
  );
  const [quantities, setQuantities] = useState<Record<Id, string>>({});
  const groupId = useId();

  const reset = (open: boolean) => {
    if (!open) {
      setNote("");
      setInternalNote("");
      setQuantities({});
    }
    onOpenChange(open);
  };

  if (!decision) return null;

  if (decision === "review") {
    return (
      <ConfirmDialog
        open
        onOpenChange={reset}
        title={`Take on ${issue.issueNumber}?`}
        description="You are on it: the customer can no longer take the report back, and photos can still be added. Nothing is sent."
        confirmLabel="Take it on"
        onConfirm={async () => {
          await actions.review.mutateAsync(notesInput("", internalNote));
          notify.success(`${issue.issueNumber} is in review`);
        }}
      >
        <ReasonField
          label="Internal note"
          value={internalNote}
          onChange={setInternalNote}
          maxLength={ISSUE_INTERNAL_NOTE_MAX}
          rows={2}
          hint="For the team. The customer never sees it."
        />
      </ConfirmDialog>
    );
  }

  if (decision === "reject") {
    return (
      <ConfirmDialog
        open
        onOpenChange={reset}
        title={`Reject ${issue.issueNumber}?`}
        description="The customer is told by email that nothing follows from the report. Your note is what they read: give the reason."
        tone="danger"
        facts={[
          {
            label: "Reported",
            value:
              issue.reportedAmount > 0
                ? formatMoney(issue.reportedAmount)
                : "The delivery as a whole",
            strong: issue.reportedAmount > 0,
          },
        ]}
        confirmLabel="Reject the report"
        canConfirm={note.trim().length > 0}
        onConfirm={async () => {
          await actions.reject.mutateAsync({
            note: note.trim(),
            ...notesInput("", internalNote),
          });
          notify.success(`${issue.issueNumber} rejected`);
        }}
      >
        <Notes
          note={note}
          internalNote={internalNote}
          onNote={setNote}
          onInternalNote={setInternalNote}
          noteRequired
        />
      </ConfirmDialog>
    );
  }

  // Resolve: the way, the units when refunding, the notes.
  const parsed: Record<Id, number> = {};
  let valid = true;
  for (const item of issue.items) {
    const text = quantities[item.variantId];
    if (text === undefined) continue;
    const value = /^\d{1,5}$/.test(text.trim()) ? Number(text) : Number.NaN;
    if (Number.isNaN(value) || value > item.quantity) valid = false;
    else parsed[item.variantId] = value;
  }
  const refund = refundInput(issue, parsed, note, internalNote);
  const refunding = way === "refund";
  const canRefund = issue.items.length > 0;
  const facts = refunding
    ? [
        { label: "Units refunded", value: refund.units },
        {
          label: "Credit for the goods",
          value: formatMoney(refund.amount),
          strong: true,
        },
      ]
    : [
        {
          label: "Wish of the customer",
          value: ISSUE_WISH_LABEL[issue.preferredResolution],
        },
      ];

  return (
    <ConfirmDialog
      open
      onOpenChange={reset}
      title={`Resolve ${issue.issueNumber}`}
      description="The customer is told by email how the report was settled, with your note."
      facts={facts}
      confirmLabel={
        refunding
          ? `Refund ${formatMoney(refund.amount)}`
          : way === "replacement"
            ? "Resolve with a replacement"
            : "Settle with the note"
      }
      canConfirm={!refunding || (valid && refund.units > 0)}
      onConfirm={async () => {
        const result = await actions.resolve.mutateAsync(
          refunding
            ? refund.input
            : { resolution: way, ...notesInput(note, internalNote) },
        );
        notify.success(
          `${issue.issueNumber} resolved`,
          refunding
            ? `${formatMoney(result.resolution?.amount ?? refund.amount)} credited on ${issue.orderNumber}; the refund waits in the queue.`
            : way === "replacement"
              ? "Send the replacement by hand."
              : "The customer can read your note.",
        );
      }}
    >
      <RadioGroup
        aria-label="How to settle the report"
        value={way}
        onValueChange={(value) => setWay(value as IssueResolution)}
        className="gap-3"
      >
        {WAYS.map((option) => {
          const disabled = option.value === "refund" && !canRefund;
          return (
            <div key={option.value} className="flex items-start gap-2.5">
              <RadioItem
                id={`${groupId}-${option.value}`}
                value={option.value}
                disabled={disabled}
                aria-describedby={`${groupId}-${option.value}-hint`}
                className="mt-0.5"
              />
              <div className="flex min-w-0 flex-col">
                <label
                  htmlFor={`${groupId}-${option.value}`}
                  className="text-sm font-medium text-ink"
                >
                  {option.label}
                  {option.value === issue.preferredResolution ? (
                    <span className="ml-1.5 font-normal text-ink-subtle">
                      the customer&apos;s wish
                    </span>
                  ) : null}
                </label>
                <p
                  id={`${groupId}-${option.value}-hint`}
                  className="text-13 text-ink-muted"
                >
                  {disabled
                    ? "The report names no product: there is nothing to refund by the unit."
                    : option.explanation}
                </p>
              </div>
            </div>
          );
        })}
      </RadioGroup>
      {refunding ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-13 font-medium text-ink">
            Units to refund
          </legend>
          {issue.items.map((item) => {
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
                    {plural(item.quantity, "unit")} reported ·{" "}
                    {formatMoney(item.unitPrice)} each
                  </span>
                </span>
                <Input
                  inputMode="numeric"
                  value={text}
                  aria-label={`Units of ${translated(item.name)} ${item.packSize.label} to refund`}
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
              At most what was reported; 0 leaves a pack size out.
            </p>
          ) : refund.units === 0 ? (
            <p className="text-13 text-danger-fg">
              Nothing would be refunded. Settle with a note, or reject the
              report.
            </p>
          ) : null}
        </fieldset>
      ) : null}
      <Notes
        note={note}
        internalNote={internalNote}
        onNote={setNote}
        onInternalNote={setInternalNote}
      />
    </ConfirmDialog>
  );
}
