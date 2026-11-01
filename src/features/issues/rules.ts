import type {
  Id,
  Issue,
  IssueProblem,
  IssueResolution,
  IssueResolveInput,
  IssueStatus,
} from "@/lib/api/types";

/** The API's limits for what the admin writes (29, as for returns). */
export const ISSUE_NOTE_MAX = 1000;
export const ISSUE_INTERNAL_NOTE_MAX = 2000;

export const ISSUE_PROBLEM_LABEL: Record<IssueProblem, string> = {
  damaged: "Damaged",
  missing: "Missing",
  wrong_item: "Wrong item",
  not_fresh: "Not fresh",
  late: "Late",
  other: "Other",
};

/** What the customer would like, in their words. */
export const ISSUE_WISH_LABEL: Record<IssueResolution, string> = {
  refund: "A refund",
  replacement: "A replacement",
  none: "Nothing, just telling",
};

/** What the admin decided, as the resolution reads afterwards. */
export const ISSUE_RESOLUTION_LABEL: Record<IssueResolution, string> = {
  refund: "Refund",
  replacement: "Replacement",
  none: "Settled with a note",
};

/** The words on the button for each step (29). */
export const ISSUE_ACTION_LABEL: Record<
  Exclude<IssueStatus, "open" | "cancelled">,
  string
> = {
  in_review: "Take on",
  resolved: "Resolve",
  rejected: "Reject",
};

/** "Damaged, missing" for a list cell. */
export function problemsText(problems: IssueProblem[]): string {
  return problems.map((problem) => ISSUE_PROBLEM_LABEL[problem]).join(", ");
}

/** Units reported over every pack size. */
export function reportedUnits(issue: Pick<Issue, "items">): number {
  return issue.items.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * What resolving with a refund sends: the units per pack size when the
 * admin changed any, nothing when the reported quantities are refunded as
 * they are. The amount is what the credit note will carry at most.
 */
export function refundInput(
  issue: Pick<Issue, "items">,
  quantities: Record<Id, number>,
  note: string,
  internalNote: string,
): {
  input: IssueResolveInput;
  units: number;
  amount: number;
  changed: boolean;
} {
  const lines = issue.items.map((item) => ({
    variantId: item.variantId,
    quantity: quantities[item.variantId] ?? item.quantity,
    unitPrice: item.unitPrice,
    reported: item.quantity,
  }));
  const changed = lines.some((line) => line.quantity !== line.reported);
  return {
    input: {
      resolution: "refund",
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

/** The notes of a resolution without a refund, empty ones left out. */
export function notesInput(
  note: string,
  internalNote: string,
): { note?: string; internalNote?: string } {
  return {
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
  };
}
