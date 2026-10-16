import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  RETURN_STATUSES,
} from "@/lib/api/types";
import { STATUS_TABLES, humanize, statusMeta } from "./index";
import {
  ORDER_CANCELLABLE_IN,
  ORDER_CHANGEABLE_IN,
  ORDER_PATH,
  ORDER_TRANSITIONS,
  orderActionLabel,
  refundActions,
  sortTransitions,
} from "./transitions";

describe("order transitions (documentation, 9.1)", () => {
  it("lists exactly the documented transitions", () => {
    expect(ORDER_TRANSITIONS).toEqual({
      pending_payment: [],
      confirmed: ["processing", "dispatched"],
      processing: ["confirmed", "dispatched"],
      dispatched: ["processing", "delivered"],
      delivered: ["dispatched"],
      returned: [],
      cancelled: [],
    });
  });

  it("covers every order status", () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual(
      [...ORDER_STATUSES].sort(),
    );
  });

  it("never offers cancelled, returned or a confirmation by hand", () => {
    for (const targets of Object.values(ORDER_TRANSITIONS)) {
      expect(targets).not.toContain("cancelled");
      expect(targets).not.toContain("returned");
      expect(targets).not.toContain("pending_payment");
    }
    // The payment confirms a pending order; nothing is set by hand.
    expect(ORDER_TRANSITIONS.pending_payment).toEqual([]);
  });

  it("knows where the admin can cancel and change an order", () => {
    expect(ORDER_CANCELLABLE_IN).toEqual([
      "pending_payment",
      "confirmed",
      "processing",
      "dispatched",
    ]);
    expect(ORDER_CHANGEABLE_IN).toEqual([
      "confirmed",
      "processing",
      "dispatched",
      "delivered",
    ]);
  });

  it("sorts a dispatched order", () => {
    expect(
      sortTransitions(ORDER_PATH, "dispatched", ORDER_TRANSITIONS.dispatched),
    ).toEqual({
      forward: ["delivered"],
      back: ["processing"],
      aside: [],
    });
  });

  it("offers two ways forward from a confirmed order, the nearest first", () => {
    expect(
      sortTransitions(ORDER_PATH, "confirmed", ["dispatched", "processing"]),
    ).toEqual({ forward: ["processing", "dispatched"], back: [], aside: [] });
  });

  it("offers only what the API allows, whatever the tables say", () => {
    expect(sortTransitions(ORDER_PATH, "confirmed", [])).toEqual({
      forward: [],
      back: [],
      aside: [],
    });
  });

  it("words the steps of an order", () => {
    expect(orderActionLabel("confirmed", "processing")).toBe("Mark processing");
    expect(orderActionLabel("processing", "dispatched")).toBe(
      "Mark dispatched",
    );
    expect(orderActionLabel("dispatched", "delivered")).toBe("Mark delivered");
    expect(orderActionLabel("delivered", "dispatched")).toBe(
      "Back to dispatched",
    );
    expect(orderActionLabel("processing", "confirmed")).toBe(
      "Back to confirmed",
    );
  });
});

describe("refund actions (documentation, 11.2)", () => {
  it("lets the admin complete only a pending manual refund", () => {
    expect(refundActions({ method: "manual", status: "pending" })).toEqual({
      complete: true,
      cancel: true,
      sync: false,
    });
    expect(refundActions({ method: "stripe", status: "processing" })).toEqual({
      complete: false,
      cancel: false,
      sync: true,
    });
  });

  it("lets a failed refund be withdrawn and a finished one be left alone", () => {
    expect(refundActions({ method: "stripe", status: "failed" }).cancel).toBe(
      true,
    );
    expect(refundActions({ method: "manual", status: "completed" })).toEqual({
      complete: false,
      cancel: false,
      sync: false,
    });
  });
});

describe("status badges", () => {
  it("has a tone for every status of the API", () => {
    const expected: Record<string, readonly string[]> = {
      order: ORDER_STATUSES,
      payment: PAYMENT_STATUSES,
      return: RETURN_STATUSES,
      refund: REFUND_STATUSES,
      notification: NOTIFICATION_STATUSES,
    };
    for (const [kind, statuses] of Object.entries(expected)) {
      const table = STATUS_TABLES[kind as keyof typeof STATUS_TABLES];
      expect(Object.keys(table).sort()).toEqual([...statuses].sort());
    }
  });

  it("gives the same tone the same meaning everywhere", () => {
    // A pending order waits for the customer; a confirmed one for a person.
    expect(statusMeta("order", "pending_payment").tone).toBe("neutral");
    expect(statusMeta("order", "confirmed").tone).toBe("attention");
    expect(statusMeta("return", "requested").tone).toBe("attention");
    expect(statusMeta("refund", "pending").tone).toBe("attention");
    expect(statusMeta("payment", "failed").tone).toBe("danger");
    expect(statusMeta("notification", "failed").tone).toBe("danger");
    expect(statusMeta("order", "delivered").tone).toBe("success");
    expect(statusMeta("payment", "paid").tone).toBe("success");
    expect(statusMeta("payment", "authorized").tone).toBe("moving");
    expect(statusMeta("order", "dispatched").tone).toBe("moving");
    expect(statusMeta("payment", "pending").tone).toBe("neutral");
  });

  it("shows the API's name, made readable", () => {
    expect(statusMeta("order", "pending_payment").label).toBe(
      "Pending payment",
    );
    expect(statusMeta("payment", "refunded").label).toBe("Refunded");
    expect(humanize("payment_not_completed")).toBe("Payment not completed");
  });

  it("shows a status it does not know in grey", () => {
    expect(statusMeta("order", "on_hold")).toEqual({
      label: "On hold",
      tone: "neutral",
    });
  });
});
