import { z } from "zod";
import type {
  CannotOrderReason,
  CustomerStatus,
  OrderingAction,
  OrderingDecisionInput,
  OrderingHistoryEntry,
  SignupMethod,
} from "@/lib/api/types";
import { zInt } from "@/lib/validation";

// The rules of the API for the two things the panel can change about a
// customer (documentation, 4): the account status with an optional reason,
// and the ordering decision with a required one.

export const BLOCK_REASON_MAX = 500;
export const DECISION_REASON_MAX = 1000;
export const ALLOW_DAYS = { min: 1, max: 365 } as const;

/** The reason stored with a block: optional, at most 500 characters. */
export const blockReasonSchema = z
  .string()
  .trim()
  .max(BLOCK_REASON_MAX, `At most ${BLOCK_REASON_MAX} characters.`);

/** What `PATCH /customers/{id}/status` gets. A reason is only stored when blocking. */
export function toStatusInput(
  status: CustomerStatus,
  reason = "",
): { status: CustomerStatus; reason?: string } {
  const text = reason.trim();
  return status === "blocked" && text !== ""
    ? { status, reason: text }
    : { status };
}

export const ORDERING_ACTIONS = ["block", "allow", "clear"] as const;

/** An ordering decision as the dialog holds it: the days are typed text. */
export const orderingDecisionSchema = z
  .object({
    action: z.enum(ORDERING_ACTIONS),
    reason: z
      .string()
      .trim()
      .min(1, "Give a reason. It is kept in the history with your name.")
      .max(DECISION_REASON_MAX, "At most 1,000 characters."),
    allowDays: z.string(),
  })
  .superRefine((value, context) => {
    if (value.action !== "allow") return;
    const days = zInt(ALLOW_DAYS).safeParse(value.allowDays);
    if (!days.success) {
      context.addIssue({
        code: "custom",
        path: ["allowDays"],
        message: days.error.issues[0]?.message ?? "Between 1 and 365.",
      });
    }
  });

export type OrderingDecisionValues = z.input<typeof orderingDecisionSchema>;

/** The first problem of each field, or nothing when the decision can be sent. */
export function decisionProblems(
  values: OrderingDecisionValues,
): Partial<Record<"reason" | "allowDays", string>> {
  const result = orderingDecisionSchema.safeParse(values);
  if (result.success) return {};
  const problems: Partial<Record<"reason" | "allowDays", string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if ((field === "reason" || field === "allowDays") && !problems[field]) {
      problems[field] = issue.message;
    }
  }
  return problems;
}

/** What `POST /customers/{id}/ordering` gets: `allowDays` only for `allow`. */
export function toOrderingDecision(
  values: OrderingDecisionValues,
): OrderingDecisionInput {
  const reason = values.reason.trim();
  if (values.action === "allow") {
    return {
      action: "allow",
      reason,
      allowDays: Number(values.allowDays.trim()),
    };
  }
  return { action: values.action, reason };
}

/** The typed days as a number, or `null` while they are not valid. */
export function parseAllowDays(text: string): number | null {
  const days = zInt(ALLOW_DAYS).safeParse(text);
  return days.success ? days.data : null;
}

/**
 * When an allowance given now ends: the API counts the days from the moment
 * of the decision (4: `at` 30 Sep 09:00 and 7 days give `until` 7 Oct 09:00).
 */
export function allowedUntil(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

// --- Words -------------------------------------------------------------------

export const SIGNUP_METHOD_LABEL: Record<SignupMethod, string> = {
  email_otp: "Email code",
  google: "Google",
};

/** Why the customer cannot order now, as a sentence. */
export function cannotOrderText(
  reason: CannotOrderReason,
  overdue: number,
): string {
  switch (reason) {
    case "account_blocked":
      return "The account is blocked.";
    case "ordering_blocked":
      return "Ordering is blocked by a decision of the team.";
    case "payment_overdue":
      return overdue > 1
        ? `${overdue} payments are overdue.`
        : "A payment is overdue.";
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** A decision of the history as a headline: "Allowed to order for 7 days". */
export function decisionTitle(entry: OrderingHistoryEntry): string {
  if (entry.action === "block") return "Ordering blocked";
  if (entry.action === "clear") return "Decision cleared";
  if (!entry.until) return "Allowed to order";
  const days = Math.round(
    (Date.parse(entry.until) - Date.parse(entry.at)) / DAY,
  );
  return days >= 1
    ? `Allowed to order for ${days} day${days === 1 ? "" : "s"}`
    : "Allowed to order";
}

export const DECISION_TONE: Record<
  OrderingAction,
  "danger" | "attention" | "neutral"
> = {
  block: "danger",
  allow: "attention",
  clear: "neutral",
};
