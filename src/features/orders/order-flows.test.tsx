// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { OrderRecord } from "../../../mocks/db.ts";
import { formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { billAfterCorrection } from "./order-dialogs";
import { readRefund } from "./order-payment";
import { OrderView, orderTimeline } from "./order-view";
import { readOrderSearch } from "./orders-list";

let api: TestApi;

function find(
  predicate: (order: OrderRecord) => boolean,
  what: string,
): OrderRecord {
  const order = api.mock.db().orders.find(predicate);
  if (!order) throw new Error(`The demo data has no ${what}`);
  return order;
}
const fresh = (id: string) => find((order) => order.id === id, "such order");

async function open(order: OrderRecord, permissions?: string[]) {
  const view = renderPanel(<OrderView />, {
    params: { id: order.id },
    permissions,
  });
  await screen.findByRole("heading", {
    level: 1,
    name: new RegExp(order.orderNumber),
  });
  api.calls.length = 0;
  return view;
}

const changes = () => api.calls.filter((call) => call.method !== "GET");

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the status of an order", () => {
  it("offers exactly the steps the API allows and marks an order delivered", async () => {
    const order = find(
      (entry) => entry.status === "dispatched",
      "dispatched order",
    );
    const { user } = await open(order);

    // dispatched → delivered, delivery_failed; one step back in the menu.
    expect(
      screen.getByRole("button", { name: "Mark delivered" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delivery failed" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark preparing" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark delivered" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/told by email that the order was delivered/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(formatMoney(order.finalTotals.total)),
    ).toBeInTheDocument();
    expect(changes()).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: "Mark delivered" }),
    );
    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/orders/${order.id}/status`,
          body: { status: "delivered" },
        },
      ]),
    );
    expect(fresh(order.id).status).toBe("delivered");
  });

  it("needs a reason to cancel", async () => {
    const order = find(
      (entry) => entry.status === "confirmed",
      "confirmed order",
    );
    const { user } = await open(order);

    await user.click(screen.getByRole("button", { name: /More actions/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Cancel the order" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Cancel the order",
    });
    expect(confirm).toBeDisabled();

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Reason" }),
      "duplicate_order",
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/orders/${order.id}/cancel`,
          body: { reason: "duplicate_order" },
        },
      ]),
    );
    expect(fresh(order.id).status).toBe("cancelled");
  });

  it("offers no step for a cancelled order", async () => {
    const order = find(
      (entry) => entry.status === "cancelled",
      "cancelled order",
    );
    await open(order);
    expect(
      screen.queryByRole("button", { name: /More actions/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Mark / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Correct" }),
    ).not.toBeInTheDocument();
  });
});

describe("payment of an order", () => {
  it("activates payment with the amount and the deadline restated", async () => {
    const order = find(
      (entry) => entry.status === "delivered" && !entry.payment,
      "delivered order without an invoice",
    );
    const { user } = await open(order);

    await user.click(screen.getByRole("button", { name: "Activate payment" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(formatMoney(order.finalTotals.total)),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/German time/)).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", {
        name: "Activate and send the invoice",
      }),
    );
    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/orders/${order.id}/payment/activate`,
          body: { deadlineDays: 5 },
        },
      ]),
    );
    const after = fresh(order.id);
    expect(after.paymentStatus).toBe("due");
    expect(after.payment?.amountDue).toBe(order.finalTotals.total);
  });

  it("cannot activate payment before delivery", async () => {
    const order = find(
      (entry) => entry.status === "dispatched",
      "dispatched order",
    );
    await open(order);
    expect(
      screen.getByRole("button", { name: "Activate payment" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        "Payment can be activated once the order is delivered.",
      ),
    ).toBeInTheDocument();
  });

  it("records cash for exactly the amount due", async () => {
    const order = find(
      (entry) => entry.paymentStatus === "due",
      "order that is due",
    );
    const due = order.payment?.amountDue ?? 0;
    const { user } = await open(order);

    await user.click(
      await screen.findByRole("button", { name: "Record cash" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    // The amount is not typed: partial payments do not exist.
    expect(
      within(dialog).queryByRole("textbox", { name: /amount/i }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", {
        name: `Record ${formatMoney(due)} in cash`,
      }),
    );
    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/orders/${order.id}/payment/cash`,
          body: { amount: due },
        },
      ]),
    );
    const after = fresh(order.id);
    expect(after.paymentStatus).toBe("paid");
    expect(after.payment?.method).toBe("cash");
    expect(after.payment?.amountDue).toBe(0);
  });

  it("waives only with a reason", async () => {
    const order = find(
      (entry) => entry.paymentStatus === "overdue",
      "overdue order",
    );
    const { user } = await open(order);

    await user.click(await screen.findByRole("button", { name: "Waive" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /^Waive €/ });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Reason" }),
      "Damaged on arrival",
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/orders/${order.id}/payment/waive`,
          body: { reason: "Damaged on arrival" },
        },
      ]),
    );
    expect(fresh(order.id).paymentStatus).toBe("waived");
  });

  it("pauses the reminders", async () => {
    const order = find(
      (entry) => entry.paymentStatus === "due",
      "order that is due",
    );
    const { user } = await open(order);
    await user.click(
      await screen.findByRole("button", { name: "Pause reminders" }),
    );
    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/orders/${order.id}/payment/reminders`,
          body: { paused: true },
        },
      ]),
    );
    expect(
      await screen.findByRole("button", { name: "Resume reminders" }),
    ).toBeInTheDocument();
  });
});

describe("refunds", () => {
  const paidInCash = (entry: OrderRecord) =>
    entry.paymentStatus === "paid" &&
    entry.payment?.method === "cash" &&
    entry.payment.refundedAmount === 0 &&
    !api.mock.db().refunds.some((refund) => refund.orderId === entry.id);

  it("refunds by hand, up to what was paid", async () => {
    const order = find(paidInCash, "paid order");
    const paid = order.payment?.paidAmount ?? 0;
    const { user } = await open(order);

    await user.click(await screen.findByRole("button", { name: "Refund" }));
    const dialog = await screen.findByRole("alertdialog");
    // Stripe is not connected (section 19): refunding through Stripe is not offered.
    expect(
      within(dialog).queryByRole("option", { name: /Through Stripe/ }),
    ).not.toBeInTheDocument();

    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    await user.clear(amount);
    await user.type(amount, "9999");
    expect(
      within(dialog).getByText(`At most ${formatMoney(paid)} can be refunded.`),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Refund" }),
    ).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, "1,50");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Reason" }),
      "goodwill",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Sent by" }),
      "bank_transfer",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Refund €1.50" }),
    );

    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/orders/${order.id}/payment/refunds`,
          body: {
            amount: 150,
            reason: "goodwill",
            method: "manual",
            manual: { way: "bank_transfer" },
          },
        },
      ]),
    );
    const refund = api.mock
      .db()
      .refunds.find((entry) => entry.orderId === order.id);
    expect(refund?.status).toBe("pending");
    expect(refund?.amount).toBe(150);
  });

  it("offers Stripe when the order was paid through Stripe", async () => {
    api = installTestApi({ stripe: true });
    await api.signIn();
    const order = find(
      (entry) =>
        entry.paymentStatus === "paid" && entry.payment?.method === "stripe",
      "order paid through Stripe",
    );
    const { user } = await open(order);
    await user.click(await screen.findByRole("button", { name: "Refund" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("combobox", { name: "How" })).toHaveValue(
      "stripe",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Reason" }),
      "goodwill",
    );
    await user.click(within(dialog).getByRole("button", { name: /^Refund €/ }));
    await waitFor(() => expect(changes()).toHaveLength(1));
    expect(changes()[0]?.body).toMatchObject({
      method: "stripe",
      reason: "goodwill",
    });
    expect(
      api.mock.db().refunds.find((entry) => entry.orderId === order.id)?.status,
    ).toBe("processing");
  });

  it("checks the form the way the API will", () => {
    const refundable = {
      paidAmount: 3193,
      refundedAmount: 0,
      openAmount: 0,
      maximum: 3193,
      suggested: 499,
      stripePossible: false,
    };
    const manual = { method: "manual" as const, way: "bank_transfer" as const };
    expect(readRefund({ amount: "4,99", ...manual }, refundable)).toEqual({
      cents: 499,
      problem: null,
    });
    expect(
      readRefund({ amount: "31.93", ...manual }, refundable).problem,
    ).toBeNull();
    expect(
      readRefund({ amount: "31.94", ...manual }, refundable).problem?.field,
    ).toBe("amount");
    expect(
      readRefund({ amount: "0", ...manual }, refundable).problem?.field,
    ).toBe("amount");
    expect(
      readRefund({ amount: "", ...manual }, refundable).problem?.message,
    ).toBe("Enter an amount.");
    expect(
      readRefund({ amount: "5", method: "manual", way: "" }, refundable).problem
        ?.field,
    ).toBe("way");
    expect(
      readRefund({ amount: "5", method: "stripe", way: "" }, refundable).problem
        ?.field,
    ).toBe("method");
  });
});

describe("correcting what was delivered", () => {
  it("lowers the bill and, after the invoice, issues a credit note", async () => {
    const order = find(
      (entry) =>
        entry.paymentStatus === "due" &&
        entry.items.some(
          (item) =>
            item.quantity > 1 && item.deliveredQuantity === item.quantity,
        ),
      "invoiced order with more than one unit of a product",
    );
    const item = order.items.find(
      (entry) =>
        entry.quantity > 1 && entry.deliveredQuantity === entry.quantity,
    );
    if (!item) throw new Error("no item");
    const before = order.finalTotals.total;
    const invoices = api.mock.db().invoices.length;
    const { user } = await open(order);

    await user.click(
      screen.getByRole("button", {
        name: new RegExp(`Correct the delivered units of ${item.name.en}`),
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const units = within(dialog).getByRole("textbox", {
      name: "Units delivered",
    });
    await user.clear(units);
    await user.type(units, String(item.quantity - 1));
    expect(
      within(dialog).getByText(
        `${formatMoney(before)} → ${formatMoney(before - item.unitPrice)}`,
      ),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", {
      name: `Correct and lower the bill by ${formatMoney(item.unitPrice)}`,
    });
    expect(confirm).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Reason" }),
      "damaged",
    );
    await user.click(confirm);

    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/orders/${order.id}/items/${item.productId}`,
          body: { deliveredQuantity: item.quantity - 1, reason: "damaged" },
        },
      ]),
    );
    const after = fresh(order.id);
    expect(after.finalTotals.total).toBe(before - item.unitPrice);
    expect(after.totals.total).toBe(order.totals.total);
    expect(api.mock.db().invoices).toHaveLength(invoices + 1);
    expect(after.payment?.creditedAmount).toBe(item.unitPrice);
  });

  it("refuses more than was ordered and less than was returned", async () => {
    const order = find(
      (entry) => entry.status === "delivered" && !entry.payment,
      "delivered order",
    );
    const item = order.items[0];
    if (!item) throw new Error("no item");
    const { user } = await open(order);
    await user.click(
      screen.getAllByRole("button", {
        name: /Correct the delivered units/,
      })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("alertdialog");
    const units = within(dialog).getByRole("textbox", {
      name: "Units delivered",
    });
    await user.clear(units);
    await user.type(units, String(item.quantity + 1));
    expect(
      within(dialog).getByText(`Between 0 and ${item.quantity}.`),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save the correction" }),
    ).toBeDisabled();
  });

  it("works out the final bill like the API", () => {
    const item = (
      productId: string,
      quantity: number,
      unitPrice: number,
      returned = 0,
    ) => ({
      productId,
      sku: productId,
      name: { en: productId },
      packSize: { value: 1, unit: "kg" as const, label: "1 kg" },
      imageUrl: null,
      quantity,
      unitPrice,
      regularUnitPrice: unitPrice,
      lineTotal: quantity * unitPrice,
      vatRate: 700,
      vatPercent: 7,
      vatAmount: 0,
      deliveredQuantity: quantity,
      returnedQuantity: returned,
      finalLineTotal: (quantity - returned) * unitPrice,
    });
    const totals = (total: number, deliveryFee: number) => ({
      currency: "EUR" as const,
      subtotal: total - deliveryFee,
      deliveryFee,
      total,
      netTotal: 0,
      vatTotal: 0,
      vat: [],
    });
    const atta = item("atta", 2, 1299);
    const order = {
      items: [atta, item("rice", 1, 499)],
      totals: totals(3596, 499),
      finalTotals: totals(3596, 499),
    };
    // One unit less: the line and the bill go down by one unit; the fee stays.
    expect(billAfterCorrection(order, atta, 1)).toEqual({
      lineTotal: 1299,
      total: 2297,
      difference: -1299,
    });
    // Nothing was kept at all: the delivery fee goes as well.
    const single = {
      items: [atta],
      totals: totals(3097, 499),
      finalTotals: totals(3097, 499),
    };
    expect(billAfterCorrection(single, atta, 0)).toEqual({
      lineTotal: 0,
      total: 0,
      difference: -3097,
    });
    // Units that came back are not billed either.
    const returned = item("atta", 3, 1000, 1);
    const withReturn = {
      items: [returned],
      totals: totals(3499, 499),
      finalTotals: totals(2499, 499),
    };
    expect(billAfterCorrection(withReturn, returned, 2).total).toBe(1499);
  });
});

describe("permissions on an order", () => {
  it("keeps the actions visible but disabled for a read-only role", async () => {
    const order = find(
      (entry) => entry.paymentStatus === "due",
      "order that is due",
    );
    await open(order, ["orders.read", "payments.read"]);
    expect(
      await screen.findByRole("button", { name: "Record cash" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Waive" })).toBeDisabled();
    expect(
      screen.getAllByLabelText('Your role does not include "Payments: manage".')
        .length,
    ).toBeGreaterThan(0);
    for (const button of screen.getAllByRole("button", {
      name: /Correct the delivered units/,
    })) {
      expect(button).toBeDisabled();
    }
    // Nothing that changes the order hides in a menu.
    expect(
      screen.queryByRole("button", { name: /More actions/ }),
    ).not.toBeInTheDocument();
  });

  it("separates order and payment permissions", async () => {
    const order = find(
      (entry) => entry.status === "delivered" && !entry.payment,
      "delivered order",
    );
    await open(order, ["orders.read", "orders.manage"]);
    // May correct the items, may not activate payment.
    expect(
      screen.getAllByRole("button", { name: /Correct the delivered units/ })[0],
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Activate payment" }),
    ).toBeDisabled();
  });
});

describe("finding and reading orders", () => {
  it("understands what the API can search for", () => {
    expect(readOrderSearch("RF-1084")).toEqual({
      orderNumber: "RF-1084",
      understood: true,
    });
    expect(readOrderSearch(" rf1084 ")).toEqual({
      orderNumber: "RF-1084",
      understood: true,
    });
    expect(readOrderSearch("1084")).toEqual({
      orderNumber: "RF-1084",
      understood: true,
    });
    expect(readOrderSearch("Priya@Example.com")).toEqual({
      email: "priya@example.com",
      understood: true,
    });
    expect(readOrderSearch("")).toEqual({ understood: true });
    // No search by name or by a part of an email: say so instead of showing nothing.
    expect(readOrderSearch("priya").understood).toBe(false);
    expect(readOrderSearch("priya@").understood).toBe(false);
  });

  it("folds the daily reminders of the history into one line", () => {
    const entry = (
      to: string,
      at: string,
      field: "order" | "payment" = "payment",
    ) => ({
      field,
      from: null,
      to,
      at,
      by: "system" as const,
      adminId: null,
      note: null,
    });
    const timeline = orderTimeline(
      [
        entry("delivered", "2026-09-10T09:00:00.000Z", "order"),
        entry("due", "2026-09-13T18:00:00.000Z"),
        entry("reminder_sent", "2026-09-14T07:00:00.000Z"),
        entry("reminder_sent", "2026-09-15T07:00:00.000Z"),
        entry("reminder_sent", "2026-09-16T07:00:00.000Z"),
        entry("overdue", "2026-09-18T22:00:00.000Z"),
        entry("reminder_sent", "2026-09-19T07:00:00.000Z"),
      ],
      () => "Admin",
    );
    expect(timeline.map((line) => line.title)).toEqual([
      "Reminder sent",
      "Payment overdue",
      "3 reminders sent",
      "Payment due",
      "Delivered",
    ]);
    expect(timeline[2]?.by).toBe("daily since 14 Sep 2026");
    expect(timeline[2]?.at).toBe("2026-09-16T07:00:00.000Z");
  });
});
