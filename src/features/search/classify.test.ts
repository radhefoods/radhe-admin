import { describe, expect, it } from "vitest";
import { safeReturnTo, withQuery, routes } from "@/lib/routes";
import { hasRemoteSearch, planSearch } from "./classify";

describe("planSearch", () => {
  it("reads an order number in any way of writing it", () => {
    for (const text of [
      "RF-1084",
      "rf-1084",
      "rf1084",
      "#1084",
      "1084",
      " RF 1084 ",
    ]) {
      expect(planSearch(text).orderNumber, text).toBe("RF-1084");
    }
  });

  it("finds the order of a return or refund number", () => {
    expect(planSearch("RF-1084-R1").orderNumber).toBe("RF-1084");
    expect(planSearch("rf-1084-rf2").orderNumber).toBe("RF-1084");
  });

  it("also searches products for digits: an article number can be all digits", () => {
    expect(planSearch("1084").productQuery).toBe("1084");
  });

  it("reads a cargo code", () => {
    expect(planSearch("RF-C027").cargoCode).toBe("RF-C027");
    expect(planSearch("c27").cargoCode).toBe("RF-C027");
    expect(planSearch("rf-c027").orderNumber).toBeNull();
  });

  it("looks up orders only for a complete email", () => {
    const partial = planSearch("priya@exa");
    expect(partial.orderEmail).toBeNull();
    expect(partial.customerEmailPrefix).toBe("priya@exa");
    const complete = planSearch("Priya@Example.com");
    expect(complete.orderEmail).toBe("priya@example.com");
    expect(complete.customerEmailPrefix).toBe("priya@example.com");
    expect(complete.productQuery).toBeNull();
  });

  it("searches customers by email prefix and products by words", () => {
    expect(planSearch("priya")).toEqual({
      orderNumber: null,
      orderEmail: null,
      customerEmailPrefix: "priya",
      productQuery: "priya",
      cargoCode: null,
    });
  });

  it("does not search customers for several words: emails have no spaces", () => {
    const plan = planSearch("basmati rice");
    expect(plan.customerEmailPrefix).toBeNull();
    expect(plan.productQuery).toBe("basmati rice");
  });

  it("asks nothing for less than two characters", () => {
    expect(hasRemoteSearch(planSearch(""))).toBe(false);
    expect(hasRemoteSearch(planSearch("a"))).toBe(false);
    expect(hasRemoteSearch(planSearch("at"))).toBe(true);
  });

  it("respects the API's limit of 80 characters for product search", () => {
    expect(planSearch("x".repeat(81)).productQuery).toBeNull();
  });
});

describe("addresses", () => {
  it("adds query values and leaves empty ones out", () => {
    expect(
      withQuery(routes.orders, {
        status: "delivered",
        cargoId: "",
        page: undefined,
      }),
    ).toBe("/orders?status=delivered");
    expect(withQuery(routes.orders, {})).toBe("/orders");
  });

  it("only returns to an address inside the panel", () => {
    expect(safeReturnTo("/orders/abc?tab=payment")).toBe(
      "/orders/abc?tab=payment",
    );
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo("/sign-in?returnTo=/sign-in")).toBe("/");
  });
});
