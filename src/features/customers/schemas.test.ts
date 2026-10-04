import { describe, expect, it } from "vitest";
import {
  allowedUntil,
  blockReasonSchema,
  cannotOrderText,
  decisionProblems,
  decisionTitle,
  orderingDecisionSchema,
  parseAllowDays,
  toOrderingDecision,
  toStatusInput,
} from "./schemas";

describe("the status of a customer", () => {
  it("sends the reason only when blocking, and only when one was given", () => {
    expect(toStatusInput("blocked", "  Three orders refused.  ")).toEqual({
      status: "blocked",
      reason: "Three orders refused.",
    });
    expect(toStatusInput("blocked", "   ")).toEqual({ status: "blocked" });
    expect(toStatusInput("blocked")).toEqual({ status: "blocked" });
    // Unknown fields are refused by the API: no reason travels with an unblock.
    expect(toStatusInput("active", "left over")).toEqual({ status: "active" });
  });

  it("accepts a reason of up to 500 characters", () => {
    expect(blockReasonSchema.safeParse("x".repeat(500)).success).toBe(true);
    expect(blockReasonSchema.safeParse("x".repeat(501)).success).toBe(false);
    expect(blockReasonSchema.safeParse("").success).toBe(true);
  });
});

describe("an ordering decision", () => {
  it("needs a reason of 1 to 1000 characters for every action", () => {
    for (const action of ["block", "allow", "clear"] as const) {
      expect(
        decisionProblems({ action, reason: "   ", allowDays: "7" }).reason,
      ).toBeDefined();
      expect(
        decisionProblems({ action, reason: "ok", allowDays: "7" }),
      ).toEqual({});
      expect(
        decisionProblems({ action, reason: "x".repeat(1001), allowDays: "7" })
          .reason,
      ).toBe("At most 1,000 characters.");
      expect(
        decisionProblems({ action, reason: "x".repeat(1000), allowDays: "7" }),
      ).toEqual({});
    }
  });

  it("needs 1 to 365 whole days to allow, and no days otherwise", () => {
    const allow = (allowDays: string) =>
      decisionProblems({
        action: "allow",
        reason: "Promised to pay",
        allowDays,
      }).allowDays;
    expect(allow("1")).toBeUndefined();
    expect(allow("365")).toBeUndefined();
    expect(allow(" 14 ")).toBeUndefined();
    expect(allow("0")).toBe("Between 1 and 365.");
    expect(allow("366")).toBe("Between 1 and 365.");
    expect(allow("")).toBe("Enter a number.");
    expect(allow("7.5")).toBe("Enter a whole number.");
    expect(allow("a week")).toBe("Enter a whole number.");
    // The days are not looked at when ordering is blocked or the decision cleared.
    expect(
      decisionProblems({ action: "block", reason: "Misuse", allowDays: "" }),
    ).toEqual({});
    expect(
      decisionProblems({ action: "clear", reason: "Paid", allowDays: "abc" }),
    ).toEqual({});
  });

  it("builds exactly what the API accepts", () => {
    expect(
      toOrderingDecision({
        action: "allow",
        reason: " Promised to pay Friday ",
        allowDays: " 7 ",
      }),
    ).toEqual({
      action: "allow",
      reason: "Promised to pay Friday",
      allowDays: 7,
    });
    // `allowDays` is only for `allow`: the API refuses fields it does not expect.
    expect(
      toOrderingDecision({ action: "block", reason: "Misuse", allowDays: "7" }),
    ).toEqual({
      action: "block",
      reason: "Misuse",
    });
    expect(
      toOrderingDecision({ action: "clear", reason: "Paid", allowDays: "7" }),
    ).toEqual({
      action: "clear",
      reason: "Paid",
    });
  });

  it("parses through the schema as well", () => {
    expect(
      orderingDecisionSchema.safeParse({
        action: "allow",
        reason: "x",
        allowDays: "12",
      }).success,
    ).toBe(true);
    expect(
      orderingDecisionSchema.safeParse({
        action: "pause",
        reason: "x",
        allowDays: "12",
      }).success,
    ).toBe(false);
  });

  it("reads the typed days", () => {
    expect(parseAllowDays("30")).toBe(30);
    expect(parseAllowDays("0")).toBeNull();
    expect(parseAllowDays("")).toBeNull();
  });

  it("ends an allowance that many days after the decision", () => {
    const now = new Date("2026-09-30T09:00:00.000Z");
    expect(allowedUntil(7, now).toISOString()).toBe("2026-10-07T09:00:00.000Z");
    expect(allowedUntil(1, now).toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });
});

describe("the words of the ordering decision", () => {
  it("says why a customer cannot order", () => {
    expect(cannotOrderText("account_blocked", 0)).toBe(
      "The account is blocked.",
    );
    expect(cannotOrderText("ordering_blocked", 2)).toBe(
      "Ordering is blocked by a decision of the team.",
    );
    expect(cannotOrderText("payment_overdue", 1)).toBe("A payment is overdue.");
    expect(cannotOrderText("payment_overdue", 3)).toBe(
      "3 payments are overdue.",
    );
  });

  it("names a decision of the history", () => {
    const at = "2026-09-30T09:00:00.000Z";
    const entry = { reason: "x", adminId: "a".repeat(24), at };
    expect(decisionTitle({ ...entry, action: "block", until: null })).toBe(
      "Ordering blocked",
    );
    expect(decisionTitle({ ...entry, action: "clear", until: null })).toBe(
      "Decision cleared",
    );
    expect(
      decisionTitle({
        ...entry,
        action: "allow",
        until: "2026-10-07T09:00:00.000Z",
      }),
    ).toBe("Allowed to order for 7 days");
    expect(
      decisionTitle({
        ...entry,
        action: "allow",
        until: "2026-10-01T09:00:00.000Z",
      }),
    ).toBe("Allowed to order for 1 day");
    expect(decisionTitle({ ...entry, action: "allow", until: null })).toBe(
      "Allowed to order",
    );
  });
});
