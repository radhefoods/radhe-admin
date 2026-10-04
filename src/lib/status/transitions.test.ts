import { describe, expect, it } from "vitest";
import {
  CARGO_STATUSES,
  NOTIFICATION_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  RETURN_STATUSES,
} from "@/lib/api/types";
import { STATUS_TABLES, humanize, statusMeta } from "./index";
import {
  CARGO_PATH,
  CARGO_TRANSITIONS,
  ORDER_PATH,
  ORDER_TRANSITIONS,
  cargoActionLabel,
  orderActionLabel,
  refundActions,
  sortTransitions,
} from "./transitions";

describe("cargo transitions (documentation, 9.1)", () => {
  it("lists exactly the documented transitions", () => {
    expect(CARGO_TRANSITIONS).toEqual({
      draft: ["scheduled", "taking_orders", "cancelled"],
      scheduled: ["draft", "taking_orders", "cancelled"],
      taking_orders: ["orders_closed", "cancelled"],
      orders_closed: ["taking_orders", "in_transit", "cancelled"],
      in_transit: ["orders_closed", "arrived", "cancelled"],
      arrived: ["in_transit", "delivering"],
      delivering: ["arrived", "delivered"],
      delivered: ["delivering"],
      cancelled: [],
    });
  });

  it("covers every cargo status", () => {
    expect(Object.keys(CARGO_TRANSITIONS).sort()).toEqual(
      [...CARGO_STATUSES].sort(),
    );
  });

  it("can be cancelled until the goods arrive", () => {
    const cancellable = CARGO_STATUSES.filter((status) =>
      CARGO_TRANSITIONS[status].includes("cancelled"),
    );
    expect(cancellable).toEqual([
      "draft",
      "scheduled",
      "taking_orders",
      "orders_closed",
      "in_transit",
    ]);
  });

  it("sorts what the API allows into next, back and aside", () => {
    expect(
      sortTransitions(CARGO_PATH, "draft", CARGO_TRANSITIONS.draft),
    ).toEqual({
      forward: ["scheduled", "taking_orders"],
      back: [],
      aside: ["cancelled"],
    });
    expect(
      sortTransitions(
        CARGO_PATH,
        "orders_closed",
        CARGO_TRANSITIONS.orders_closed,
      ),
    ).toEqual({
      forward: ["in_transit"],
      back: ["taking_orders"],
      aside: ["cancelled"],
    });
    expect(
      sortTransitions(CARGO_PATH, "delivered", CARGO_TRANSITIONS.delivered),
    ).toEqual({
      forward: [],
      back: ["delivering"],
      aside: [],
    });
  });

  it("offers only what the API allows, whatever the tables say", () => {
    // `allowedStatuses` of the cargo is authoritative.
    expect(sortTransitions(CARGO_PATH, "in_transit", ["arrived"])).toEqual({
      forward: ["arrived"],
      back: [],
      aside: [],
    });
    expect(sortTransitions(CARGO_PATH, "cancelled", [])).toEqual({
      forward: [],
      back: [],
      aside: [],
    });
  });

  it("words a step back as one", () => {
    expect(cargoActionLabel("taking_orders", "orders_closed")).toBe(
      "Close ordering",
    );
    expect(cargoActionLabel("orders_closed", "taking_orders")).toBe(
      "Open ordering again",
    );
    expect(cargoActionLabel("arrived", "in_transit")).toBe(
      "Back to in transit",
    );
    expect(cargoActionLabel("scheduled", "draft")).toBe("Back to draft");
    expect(cargoActionLabel("arrived", "delivering")).toBe("Start delivering");
    expect(cargoActionLabel("in_transit", "cancelled")).toBe("Cancel cargo");
  });
});

describe("order transitions (documentation, 10.1)", () => {
  it("lists exactly the documented transitions", () => {
    expect(ORDER_TRANSITIONS).toEqual({
      confirmed: ["preparing", "dispatched"],
      preparing: ["confirmed", "dispatched"],
      dispatched: ["preparing", "delivered", "delivery_failed"],
      delivery_failed: ["dispatched", "delivered"],
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

  it("never offers cancelled or returned as a status to set", () => {
    for (const targets of Object.values(ORDER_TRANSITIONS)) {
      expect(targets).not.toContain("cancelled");
      expect(targets).not.toContain("returned");
    }
  });

  it("sorts a dispatched order", () => {
    expect(
      sortTransitions(ORDER_PATH, "dispatched", ORDER_TRANSITIONS.dispatched),
    ).toEqual({
      forward: ["delivered"],
      back: ["preparing"],
      aside: ["delivery_failed"],
    });
  });

  it("treats everything after a failed delivery as a way forward", () => {
    expect(
      sortTransitions(
        ORDER_PATH,
        "delivery_failed",
        ORDER_TRANSITIONS.delivery_failed,
      ),
    ).toEqual({ forward: ["dispatched", "delivered"], back: [], aside: [] });
    expect(orderActionLabel("delivery_failed", "dispatched")).toBe(
      "Dispatch again",
    );
  });

  it("words the steps of an order", () => {
    expect(orderActionLabel("dispatched", "delivered")).toBe("Mark delivered");
    expect(orderActionLabel("delivered", "dispatched")).toBe(
      "Back to dispatched",
    );
    expect(orderActionLabel("dispatched", "delivery_failed")).toBe(
      "Delivery failed",
    );
  });
});

describe("refund actions (documentation, 12.9)", () => {
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
      cargo: CARGO_STATUSES,
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
    expect(statusMeta("payment", "overdue").tone).toBe("danger");
    expect(statusMeta("order", "delivery_failed").tone).toBe("danger");
    expect(statusMeta("notification", "failed").tone).toBe("danger");
    expect(statusMeta("order", "delivered").tone).toBe("success");
    expect(statusMeta("payment", "paid").tone).toBe("success");
    expect(statusMeta("payment", "due").tone).toBe("attention");
    expect(statusMeta("return", "requested").tone).toBe("attention");
    expect(statusMeta("cargo", "in_transit").tone).toBe("moving");
    expect(statusMeta("order", "dispatched").tone).toBe("moving");
  });

  it("shows the API's name, made readable", () => {
    expect(statusMeta("order", "delivery_failed").label).toBe(
      "Delivery failed",
    );
    expect(statusMeta("cargo", "taking_orders").label).toBe("Taking orders");
    expect(humanize("not_enabled")).toBe("Not enabled");
  });

  it("shows a status it does not know in grey", () => {
    expect(statusMeta("order", "on_hold")).toEqual({
      label: "On hold",
      tone: "neutral",
    });
  });
});
