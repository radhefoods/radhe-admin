// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { OrderRecord } from "../../../mocks/db.ts";
import { centsToInput, formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { billAfterCorrection } from "./order-dialogs";
import { readRefund } from "./order-payment";
import { OrderView, orderTimeline } from "./order-view";
import { OrdersList } from "./orders-list";

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

/** A paid order that was cancelled and waits for a refund, untouched so far. */
const waitingForRefund = (entry: OrderRecord) =>
  entry.status === "cancelled" &&
  entry.payment.paidAmount > 0 &&
  entry.payment.refundedAmount === 0 &&
  !api.mock.db().refunds.some((refund) => refund.orderId === entry.id);

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

    // dispatched → delivered; one step back in the menu.
    expect(
      screen.getByRole("button", { name: "Mark delivered" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark processing" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /More actions/ }));
    expect(
      await screen.findByRole("menuitem", { name: "Back to processing" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Mark delivered" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/told by email that the order was delivered/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(formatMoney(order.payment.paidAmount)),
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

  it("asks for the tracking number when a carrier order is dispatched", async () => {
    const order = find(
      (entry) =>
        entry.status === "confirmed" && entry.delivery.method === "dhl",
      "confirmed order delivered by DHL",
    );
    const { user } = await open(order);
    // The next step is processing; dispatching straight away is offered too.
    expect(
      screen.getByRole("button", { name: "Mark processing" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark dispatched" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: /DHL tracking number/ }),
      "00340434161094015902",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Mark dispatched" }),
    );
    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/orders/${order.id}/status`,
          body: {
            status: "dispatched",
            trackingNumber: "00340434161094015902",
          },
        },
      ]),
    );
    const after = fresh(order.id);
    expect(after.status).toBe("dispatched");
    expect(after.delivery.trackingNumber).toBe("00340434161094015902");
  });

  it("offers no step for a pending order: the payment confirms it", async () => {
    const order = find(
      (entry) => entry.status === "pending_payment",
      "pending order",
    );
    const { user } = await open(order);
    expect(
      screen.queryByRole("button", { name: /^Mark / }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Waiting for the payment: it confirms the order."),
    ).toBeInTheDocument();
    // It can still be cancelled.
    await user.click(screen.getByRole("button", { name: /More actions/ }));
    expect(
      await screen.findByRole("menuitem", { name: "Cancel the order" }),
    ).toBeInTheDocument();
  });

  it("needs a reason to cancel, and says that the payment waits for a refund", async () => {
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
    expect(within(dialog).getByText(/waits for a refund/)).toBeInTheDocument();
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
    // The money waits for a decision, and the page says so.
    expect(
      await screen.findByText(
        `${formatMoney(order.payment.paidAmount)} waits for a refund`,
      ),
    ).toBeInTheDocument();
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

describe("the refund decision", () => {
  it("restates what waits for a refund and refunds it by hand", async () => {
    const order = find(waitingForRefund, "cancelled paid order");
    const paid = order.payment.paidAmount;
    const { user } = await open(order);

    expect(
      await screen.findByText(`${formatMoney(paid)} waits for a refund`),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Decide the refund" }));
    const dialog = await screen.findByRole("alertdialog");
    // Stripe is not connected (section 18): refunding through Stripe is not offered.
    expect(
      within(dialog).queryByRole("option", { name: /Through Stripe/ }),
    ).not.toBeInTheDocument();
    // The suggested amount is restated and prefilled.
    expect(within(dialog).getByText("Waits for a refund")).toBeInTheDocument();
    const amount = within(dialog).getByRole("textbox", { name: "Amount" });
    expect(amount).toHaveValue(centsToInput(paid));

    await user.clear(amount);
    await user.type(amount, "9999");
    expect(
      within(dialog).getByText(`At most ${formatMoney(paid)} can be refunded.`),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Refund" }),
    ).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, (paid / 100).toFixed(2));
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Reason" }),
      "other",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Sent by" }),
      "bank_transfer",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: `Refund ${formatMoney(paid)}`,
      }),
    );

    await waitFor(() =>
      expect(changes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/orders/${order.id}/payment/refunds`,
          body: {
            amount: paid,
            reason: "other",
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
    expect(refund?.amount).toBe(paid);
  });

  it("offers Stripe when Stripe is connected and the order was paid through it", async () => {
    api = installTestApi({ stripe: true });
    await api.signIn();
    const order = find(waitingForRefund, "cancelled paid order");
    const { user } = await open(order);
    await user.click(
      await screen.findByRole("button", { name: "Decide the refund" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("combobox", { name: "How" })).toHaveValue(
      "stripe",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Reason" }),
      "other",
    );
    await user.click(within(dialog).getByRole("button", { name: /^Refund €/ }));
    await waitFor(() => expect(changes()).toHaveLength(1));
    expect(changes()[0]?.body).toMatchObject({
      method: "stripe",
      reason: "other",
    });
    // The stand-in for Stripe confirms at once: the money is booked on the order.
    const refund = api.mock
      .db()
      .refunds.find((entry) => entry.orderId === order.id);
    expect(refund?.status).toBe("completed");
    expect(refund?.statusHistory.at(-1)?.by).toBe("stripe");
    expect(fresh(order.id).paymentStatus).toBe("refunded");
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
  const correctable = (entry: OrderRecord) =>
    entry.status === "delivered" &&
    entry.adjustments.length === 0 &&
    entry.items.every((item) => item.returnedQuantity === 0) &&
    entry.items.some((item) => item.quantity > 1);

  it("lowers the bill, issues a credit note and gives the units back", async () => {
    const order = find(correctable, "delivered order with more than one unit");
    const item = order.items.find((entry) => entry.quantity > 1);
    if (!item) throw new Error("no item");
    const before = order.finalTotals.total;
    const invoices = api.mock.db().invoices.length;
    const variant = api.mock
      .db()
      .products.find((entry) => entry.id === item.productId)
      ?.variants.find((entry) => entry.id === item.variantId);
    const stockBefore = variant?.stock.quantity ?? 0;
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
          path: `/v1/admin/orders/${order.id}/items/${item.variantId}`,
          body: { deliveredQuantity: item.quantity - 1, reason: "damaged" },
        },
      ]),
    );
    const after = fresh(order.id);
    expect(after.finalTotals.total).toBe(before - item.unitPrice);
    expect(after.totals.total).toBe(order.totals.total);
    expect(api.mock.db().invoices).toHaveLength(invoices + 1);
    expect(after.payment.creditedAmount).toBe(item.unitPrice);
    expect(variant?.stock.quantity).toBe(stockBefore + 1);
    // The credited money waits for a refund.
    expect(
      await screen.findByText(
        `${formatMoney(item.unitPrice)} waits for a refund`,
      ),
    ).toBeInTheDocument();
  });

  it("refuses more than was ordered and less than was returned", async () => {
    const order = find(correctable, "delivered order");
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
      variantId: `${productId}-1kg`,
      sku: productId,
      name: { en: productId },
      displayName: `${productId} (1 kg)`,
      packSize: { value: 1, unit: "kg" as const, label: "1 kg" },
      imageUrl: null,
      quantity,
      unitPrice,
      regularUnitPrice: null,
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
    const order = find(waitingForRefund, "cancelled paid order");
    await open(order, ["orders.read", "payments.read"]);
    expect(
      await screen.findByRole("button", { name: "Decide the refund" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refund" })).toBeDisabled();
    expect(
      screen.getAllByLabelText('Your role does not include "Payments: manage".')
        .length,
    ).toBeGreaterThan(0);
    // Nothing that changes the order hides in a menu.
    expect(
      screen.queryByRole("button", { name: /More actions/ }),
    ).not.toBeInTheDocument();
  });

  it("separates order and payment permissions", async () => {
    const order = find(
      (entry) => entry.status === "delivered" && entry.adjustments.length === 0,
      "delivered order",
    );
    await open(order, ["orders.read", "orders.manage"]);
    // May correct the items, may not read the payment's documents.
    expect(
      screen.getAllByRole("button", { name: /Correct the delivered units/ })[0],
    ).toBeEnabled();
    expect(
      screen.getByText(/Documents and refunds need the permission/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refund" }),
    ).not.toBeInTheDocument();
  });
});

describe("finding and reading orders", () => {
  it("sends what is typed as `q`, asks for the count with the same filters, and sorts", async () => {
    const { user } = renderPanel(<OrdersList />, { path: "/orders" });
    await screen.findAllByRole("link", { name: /^RF-\d{4}$/ });
    api.calls.length = 0;

    await user.type(
      screen.getByRole("searchbox", { name: "Find orders" }),
      "priya",
    );
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/orders?q=priya&limit=25",
      ),
    );
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/orders/count?q=priya",
      ),
    );

    await user.click(screen.getByRole("button", { name: "Sort" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Highest bill first" }),
    );
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/orders?q=priya&sort=total%3Adesc&limit=25",
      ),
    );
    expect(testNavigation.location).toBe("/orders?q=priya&sort=total%3Adesc");
  });

  it("lists the orders waiting for a refund from the address, as a chip", async () => {
    const { user } = renderPanel(<OrdersList />, {
      path: "/orders?needsRefund=true",
    });
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/orders?needsRefund=true&limit=25",
      ),
    );
    const waiting = api.mock
      .db()
      .orders.filter(
        (order) =>
          order.payment.paidAmount - order.payment.refundedAmount > 0 &&
          (order.status === "cancelled" ||
            order.payment.creditedAmount - order.payment.refundedAmount > 0),
      );
    expect(waiting.length).toBeGreaterThan(0);
    for (const order of waiting) {
      expect(
        await screen.findByRole("link", { name: order.orderNumber }),
      ).toBeInTheDocument();
    }
    await user.click(
      screen.getByRole("button", {
        name: "Remove the filter: Waiting for a refund",
      }),
    );
    await waitFor(() => expect(testNavigation.location).toBe("/orders"));
  });

  it("reads the history newest first, in words", () => {
    const entry = (
      field: "order" | "payment" | "delivery",
      to: string,
      at: string,
      note: string | null = null,
    ) => ({
      field,
      from: null,
      to,
      at,
      by: "system" as const,
      adminId: null,
      note,
    });
    const timeline = orderTimeline(
      [
        entry("order", "pending_payment", "2026-09-10T09:00:00.000Z"),
        entry("payment", "authorized", "2026-09-10T09:05:00.000Z"),
        entry("order", "confirmed", "2026-09-10T09:05:02.000Z"),
        entry("payment", "paid", "2026-09-10T09:05:02.000Z"),
        entry("delivery", "dhl", "2026-09-11T08:00:00.000Z"),
        entry(
          "payment",
          "credited",
          "2026-09-14T10:00:00.000Z",
          "CN-2026-000007",
        ),
        entry("payment", "refunded", "2026-09-15T10:00:00.000Z", "RF-1084-RF1"),
      ],
      () => "Admin",
    );
    expect(timeline.map((line) => line.title)).toEqual([
      "Refund completed",
      "Credit note issued",
      "Delivery method: DHL",
      "Payment captured",
      "Confirmed",
      "Payment approved by the bank",
      "Pending payment",
    ]);
    expect(timeline[0]?.note).toBe("RF-1084-RF1");
    expect(timeline[0]?.by).toBe("The system");
  });
});

describe("acting on chosen orders", () => {
  /** The numbers of the orders on the page, as links. */
  const visible = () =>
    screen
      .getAllByRole("link", { name: /^RF-\d{4}$/ })
      .map((link) => link.textContent);

  /** Two confirmed orders and one cancelled one among the rows shown. */
  function pick() {
    const shown = visible();
    const orders = api.mock
      .db()
      .orders.filter((order) => shown.includes(order.orderNumber));
    const confirmed = orders.filter((order) => order.status === "confirmed");
    const cancelled = orders.find((order) => order.status === "cancelled");
    if (confirmed.length < 2 || !cancelled)
      throw new Error("The page lacks the orders this test needs");
    return { confirmed: confirmed.slice(0, 2), cancelled };
  }

  it("ticks orders, sends their ids, and names what happened to each", async () => {
    // Sorted by status, cancelled orders come first, then confirmed ones.
    const { user } = renderPanel(<OrdersList />, {
      path: "/orders?sort=status%3Aasc",
    });
    await screen.findAllByRole("link", { name: /^RF-\d{4}$/ });
    const { confirmed, cancelled } = pick();
    expect(
      screen.queryByRole("region", { name: "Chosen orders" }),
    ).not.toBeInTheDocument();

    for (const order of [...confirmed, cancelled]) {
      await user.click(
        screen.getByRole("checkbox", { name: `Choose ${order.orderNumber}` }),
      );
    }
    const bar = screen.getByRole("region", { name: "Chosen orders" });
    expect(bar).toHaveTextContent("3 orders chosen");
    api.calls.length = 0;

    await user.click(
      within(bar).getByRole("button", { name: "Mark processing" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Mark processing: 3 orders?");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Note for the history/ }),
      "Packing started",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Mark processing" }),
    );

    await waitFor(() => expect(changes()).toHaveLength(1));
    expect(changes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/orders/bulk/status",
      body: {
        orderIds: [...confirmed, cancelled].map((order) => order.id),
        status: "processing",
        note: "Packing started",
      },
    });
    for (const order of confirmed) {
      expect(fresh(order.id).status).toBe("processing");
    }
    expect(fresh(cancelled.id).status).toBe("cancelled");

    // Every order is answered: what changed, and what was left with its reason.
    const outcome = await screen.findByRole("dialog", {
      name: "2 orders changed, 1 order not",
    });
    expect(outcome).toHaveTextContent(cancelled.orderNumber);
    expect(outcome).toHaveTextContent(
      'An order that is "cancelled" cannot be set to "processing".',
    );
    for (const order of confirmed) {
      expect(outcome).toHaveTextContent(order.orderNumber);
    }
    expect(within(outcome).getAllByText("Changed")).toHaveLength(2);
    await user.click(
      within(outcome).getByRole("button", { name: "Understood" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Chosen orders" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("changes the delivery method of the chosen orders and clears the choice when all went through", async () => {
    const { user } = renderPanel(<OrdersList />, {
      path: "/orders?status=confirmed",
    });
    await screen.findAllByRole("link", { name: /^RF-\d{4}$/ });
    const shown = visible();
    const target = api.mock
      .db()
      .orders.find(
        (order) =>
          shown.includes(order.orderNumber) && order.delivery.method !== "dhl",
      );
    if (!target) throw new Error("No confirmed order without DHL on the page");
    await user.click(
      screen.getByRole("checkbox", { name: `Choose ${target.orderNumber}` }),
    );
    api.calls.length = 0;
    await user.click(screen.getByRole("button", { name: "Delivery method" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Delivery method" }),
      "dhl",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Change the method" }),
    );
    await waitFor(() => expect(changes()).toHaveLength(1));
    expect(changes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/orders/bulk/delivery-method",
      body: { orderIds: [target.id], method: "dhl" },
    });
    await waitFor(() => expect(fresh(target.id).delivery.method).toBe("dhl"));
    expect(
      (await screen.findAllByText("1 order changed")).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Chosen orders" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("offers no choice to an admin who may only read", async () => {
    renderPanel(<OrdersList />, {
      path: "/orders",
      permissions: ["orders.read", "payments.read"],
    });
    await screen.findAllByRole("link", { name: /^RF-\d{4}$/ });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
