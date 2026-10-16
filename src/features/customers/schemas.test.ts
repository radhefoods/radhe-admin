import { describe, expect, it } from "vitest";
import { blockReasonSchema, toStatusInput } from "./schemas";

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
