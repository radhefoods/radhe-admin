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
      expect(planSearch(text).query, text).toBe("RF-1084");
    }
  });

  it("finds the order of a return or refund number", () => {
    expect(planSearch("RF-1084-R1").query).toBe("RF-1084");
    expect(planSearch("rf-1084-rf2").query).toBe("RF-1084");
  });

  it("also searches products for digits: an article number can be all digits", () => {
    expect(planSearch("1084").productQuery).toBe("1084");
  });

  it("searches orders and customers by any words, products unless it is an email", () => {
    expect(planSearch("priya")).toEqual({
      query: "priya",
      productQuery: "priya",
    });
    expect(planSearch("anna schmidt").query).toBe("anna schmidt");
    expect(planSearch("priya@exa")).toEqual({
      query: "priya@exa",
      productQuery: null,
    });
  });

  it("asks nothing for less than two characters", () => {
    expect(hasRemoteSearch(planSearch(""))).toBe(false);
    expect(hasRemoteSearch(planSearch("a"))).toBe(false);
    expect(hasRemoteSearch(planSearch("at"))).toBe(true);
  });

  it("respects the API's limits: 80 characters for products, 100 for orders and customers", () => {
    expect(planSearch("x".repeat(81)).productQuery).toBeNull();
    expect(planSearch("x".repeat(81)).query).toBe("x".repeat(81));
    expect(planSearch("x".repeat(101)).query).toBeNull();
  });
});

describe("addresses", () => {
  it("adds query values and leaves empty ones out", () => {
    expect(
      withQuery(routes.orders, {
        status: "delivered",
        customerId: "",
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
