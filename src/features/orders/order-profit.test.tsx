// @vitest-environment jsdom
import { configure, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "../../../mocks/db.ts";
import { orderProfitOf } from "../../../mocks/modules/finance.ts";
import {
  formatCost,
  formatExact,
  formatFine,
  formatPercent,
} from "@/features/finance/profit-format";
import { formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { OrderView } from "./order-view";

// The page of an order is long, and the machine may be busy with other work.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

let api: TestApi;

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

const digitsOf = (text: string) => Number(text.replace(/\D/g, "")) || 0;

function find(
  predicate: (order: OrderRecord) => boolean,
  what: string,
): OrderRecord {
  const order = api.mock.db().orders.find(predicate);
  if (!order) throw new Error(`The demo data has no ${what}`);
  return order;
}

/** What the API answers for the order right now. */
const breakdown = (order: OrderRecord) => orderProfitOf(api.mock.db(), order);

/** A delivered, paid order nobody corrected, with a buying price on every line. */
const settled = (entry: OrderRecord) =>
  entry.status === "delivered" &&
  entry.payment.paidAmount > 0 &&
  entry.payment.refundedAmount === 0 &&
  entry.adjustments.length === 0 &&
  entry.items.every((item) => item.returnedQuantity === 0);
const complete = (entry: OrderRecord) =>
  settled(entry) && breakdown(entry).complete;

const profitCalls = () =>
  api.calls.filter((call) => call.path.startsWith("/v1/admin/finance"));

async function open(order: OrderRecord, permissions?: string[]) {
  const view = renderPanel(<OrderView />, {
    params: { id: order.id },
    permissions,
  });
  await screen.findByRole("heading", {
    level: 1,
    name: new RegExp(order.orderNumber),
  });
  return view;
}

const section = () => screen.findByRole("region", { name: "Cost & profit" });

/** The amount next to a label of one of the lists of the section. */
function valueOf(list: HTMLElement, label: string | RegExp): string {
  const term = within(list).getByText(label, { selector: "dt, dt *" });
  const row = term.closest("div");
  return row?.querySelector("dd")?.textContent ?? "";
}

describe("the mock breakdown", () => {
  it("adds up as the API says, for every order of the demo data", () => {
    for (const order of api.mock.db().orders) {
      const { summary, refunds, ordered, final } = breakdown(order);
      const near = (a: number, b: number) =>
        expect(Math.abs(a - b)).toBeLessThan(0.001);
      near(
        summary.profitAsOrdered + summary.refundAdjustment,
        summary.netProfit,
      );
      near(ordered.revenue.total - ordered.costs.total, ordered.netProfit);
      near(final.revenue.total - final.costs.total, final.netProfit);
      near(
        refunds.revenue + refunds.costsRecovered - refunds.goodwill,
        refunds.profit,
      );
    }
  });

  it("calculates the price a pack is sold at when the price follows the rule", () => {
    const lines = api.mock
      .db()
      .orders.flatMap((order) => breakdown(order).lines)
      .filter(
        (line) =>
          line.unit.priceMode === "auto" &&
          line.unit.calculation !== null &&
          line.unit.regularPrice === null,
      );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.unit.calculation?.price).toBe(line.unit.price);
    }
  });
});

describe("cost and profit of an order", () => {
  it("shows the products, the summary and what the customer paid, with the figures of the API", async () => {
    const order = find(complete, "delivered order with every buying price");
    const profit = breakdown(order);
    await open(order);
    const card = await section();

    // One row per pack size, with the figures as the order ended.
    const table = within(card).getByRole("table");
    const line = profit.lines[0]!;
    const row = within(table).getByText(line.sku).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent(line.name.en);
    expect(row).toHaveTextContent(
      `${line.packSize.value} ${line.packSize.unit}`,
    );
    const cells = within(row).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      String(line.quantity.ordered),
      formatFine(line.unit.cost),
      formatMoney(line.unit.price),
      formatCost(line.final.discount),
      formatFine(line.final.netRevenue),
      formatCost(line.final.buyingCost),
      formatCost(line.final.fulfilmentCost),
      formatFine(line.final.profit),
      formatPercent(line.final.marginPercent),
    ]);

    const summary = within(card).getByRole("region", { name: "Order summary" });
    const list = within(summary).getByLabelText("Order summary");
    expect(valueOf(list, "Total product revenue")).toBe(
      formatFine(profit.summary.productRevenue),
    );
    expect(valueOf(list, "Total buying costs")).toBe(
      formatCost(profit.summary.buyingCosts),
    );
    expect(valueOf(list, "Total fulfilment costs")).toBe(
      formatCost(profit.summary.fulfilmentCosts),
    );
    expect(valueOf(list, "Delivery revenue")).toBe(
      formatFine(profit.summary.deliveryRevenue),
    );
    expect(valueOf(list, "Delivery cost")).toBe(
      formatCost(profit.summary.deliveryCost),
    );
    expect(valueOf(list, "Packaging cost")).toBe(
      formatCost(profit.summary.packagingCost),
    );
    expect(valueOf(list, /Stripe processing fee/)).toBe(
      formatCost(profit.summary.paymentFee),
    );
    expect(valueOf(list, "Other operational costs")).toBe(
      formatCost(profit.summary.otherCosts),
    );
    expect(valueOf(list, "Profit as ordered")).toBe(
      formatFine(profit.summary.profitAsOrdered),
    );
    expect(valueOf(list, "Final net profit")).toBe(
      formatFine(profit.summary.netProfit),
    );
    expect(valueOf(list, "Actual profit margin")).toBe(
      formatPercent(profit.summary.marginPercent),
    );
    // Nothing was refunded: no row and no block for it.
    expect(within(list).queryByText("Refund adjustments")).toBeNull();
    expect(within(card).queryByRole("region", { name: "Refunds" })).toBeNull();
    expect(
      within(summary).getByText("All amounts without VAT."),
    ).toBeInTheDocument();

    const paid = within(
      within(card).getByRole("region", { name: "What the customer paid" }),
    ).getByLabelText("What the customer paid");
    expect(valueOf(paid, "Agreed")).toBe(formatMoney(order.totals.total));
    expect(valueOf(paid, "Paid")).toBe(formatMoney(order.payment.paidAmount));
    expect(valueOf(paid, "Refunded")).toBe(formatMoney(0));
    expect(valueOf(paid, "Kept")).toBe(formatMoney(order.payment.paidAmount));
    expect(valueOf(paid, "of which VAT")).toBe(
      formatMoney(order.finalTotals.vatTotal),
    );
    expect(within(paid).queryByText("Still to refund")).toBeNull();
    // Only reading: the section changes nothing.
    expect(api.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("colours the net profit by its sign", async () => {
    const order = find(complete, "delivered order with every buying price");
    const profit = breakdown(order);
    await open(order);
    const card = await section();
    const value = within(card)
      .getByText("Final net profit")
      .closest("div")
      ?.querySelector("dd");
    const cents = Math.round(profit.summary.netProfit);
    if (cents > 0) expect(value).toHaveClass("text-success-fg");
    else if (cents < 0) expect(value).toHaveClass("text-danger-fg");
    else expect(value).not.toHaveClass("text-success-fg", "text-danger-fg");
  });

  it("opens a row to the calculation of one pack", async () => {
    const order = find(complete, "delivered order with every buying price");
    const line = breakdown(order).lines[0]!;
    const steps = line.unit.calculation!;
    const { user } = await open(order);
    const card = await section();
    const toggle = within(card).getAllByRole("button", {
      name: /^Show the calculation of one pack of /,
    })[0]!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(card).queryByText("Supplier buying price")).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = within(card)
      .getByText("How the price of one pack comes about")
      .closest("div") as HTMLElement;
    expect(valueOf(panel, "Supplier buying price")).toBe(
      formatExact(steps.cost),
    );
    expect(valueOf(panel, "Fulfilment cost (10 %)")).toBe(
      formatExact(steps.fulfilment),
    );
    expect(valueOf(panel, "Cost after fulfilment")).toBe(
      formatExact(steps.cost + steps.fulfilment + steps.extra),
    );
    expect(valueOf(panel, "Markup (35 %)")).toBe(formatExact(steps.markup));
    expect(valueOf(panel, "Selling price before VAT")).toBe(
      formatExact(steps.net),
    );
    expect(valueOf(panel, `VAT (${formatPercent(line.vatPercent)})`)).toBe(
      formatExact(steps.vat),
    );
    expect(valueOf(panel, "Final customer selling price")).toBe(
      formatMoney(steps.price),
    );
    // No other expenses in the rule: no row for them.
    expect(within(panel).queryByText("Other expenses")).toBeNull();

    await user.click(toggle);
    expect(within(card).queryByText("Supplier buying price")).toBeNull();
  });

  it("says when the price charged was set by hand or reduced", async () => {
    const order = find(settled, "delivered order");
    // Every fifth article of the mock has a price set by hand.
    const item = order.items[0]!;
    item.sku = "RF-00005";
    const line = breakdown(order).lines[0]!;
    expect(line.unit.priceMode).toBe("manual");
    expect(line.unit.calculation?.price).not.toBe(line.unit.price);
    const { user } = await open(order);
    const card = await section();
    await user.click(
      within(card).getAllByRole("button", {
        name: /^Show the calculation of one pack of /,
      })[0]!,
    );
    const panel = within(card)
      .getByText("How the price of one pack comes about")
      .closest("div") as HTMLElement;
    expect(
      valueOf(
        panel,
        line.unit.regularPrice === null
          ? "Charged (price set by hand)"
          : "Charged (price set by hand, reduced)",
      ),
    ).toBe(formatMoney(line.unit.price));
  });

  it("names a product without a buying price and warns that the profit is too high", async () => {
    const order = find(settled, "delivered order");
    // Every ninth article of the mock has no buying price.
    order.items[0]!.sku = "RF-00009";
    const profit = breakdown(order);
    expect(profit.complete).toBe(false);
    await open(order);
    const card = await section();
    expect(
      within(card).getByText(
        `The buying price of ${profit.linesWithoutCost} product${profit.linesWithoutCost === 1 ? "" : "s"} is not known: the profit shown is too high.`,
      ),
    ).toBeInTheDocument();
    const row = within(card).getByText("RF-00009").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("buying price not known");
    const cells = within(row)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    // Buying price, buying cost, fulfilment, profit, margin: not known.
    expect([cells[1], cells[5], cells[6], cells[7], cells[8]]).toEqual([
      "–",
      "–",
      "–",
      "–",
      "–",
    ]);
    // Without a buying price there is no calculation to open.
    expect(
      within(row).queryByRole("button", { name: /calculation of one pack/ }),
    ).toBeNull();
  });

  it("marks the payment fee as actual or as an estimate", async () => {
    // In the mock Stripe has reported the fee of every second paid order,
    // and every sixth order is from before order costs were kept.
    const withCosts = (entry: OrderRecord) =>
      settled(entry) && digitsOf(entry.orderNumber) % 6 !== 0;
    const reported = find(
      (entry) => withCosts(entry) && digitsOf(entry.orderNumber) % 2 === 0,
      "paid order with a reported fee",
    );
    const view = await open(reported);
    let card = await section();
    let fee = within(card).getByText("Stripe processing fee").closest("div");
    expect(fee).toHaveTextContent("actual");
    expect(
      within(card).queryByText(
        "The payment fee is an estimate until Stripe reports it.",
      ),
    ).toBeNull();
    view.unmount();

    const waiting = find(
      (entry) => withCosts(entry) && digitsOf(entry.orderNumber) % 2 === 1,
      "paid order with an estimated fee",
    );
    await open(waiting);
    card = await section();
    fee = within(card).getByText("Stripe processing fee").closest("div");
    expect(fee).toHaveTextContent("estimate");
    expect(
      within(card).getByText(
        "The payment fee is an estimate until Stripe reports it.",
      ),
    ).toBeInTheDocument();
  });

  it("says what kind of figures these are: not paid, cancelled, from before the costs were kept", async () => {
    const pending = find(
      (entry) => entry.status === "pending_payment",
      "order that waits for its payment",
    );
    let view = await open(pending);
    let card = await section();
    expect(
      within(card).getByText(
        "Not paid yet: these figures are what is expected.",
      ),
    ).toBeInTheDocument();
    view.unmount();

    const cancelled = find(
      (entry) => entry.status === "cancelled",
      "cancelled order",
    );
    view = await open(cancelled);
    card = await section();
    expect(
      within(card).getByText(
        "Cancelled: only what the order still cost is shown.",
      ),
    ).toBeInTheDocument();
    view.unmount();

    const early = find(
      (entry) => digitsOf(entry.orderNumber) % 6 === 0,
      "order from before order costs were kept",
    );
    await open(early);
    card = await section();
    expect(
      within(card).getByText("Placed before order costs were recorded."),
    ).toBeInTheDocument();
  });

  it("loads the breakdown again after a correction, and shows what refunds changed", async () => {
    const correctable = (entry: OrderRecord) =>
      complete(entry) &&
      entry.totals.discount === 0 &&
      entry.totals.rewards === 0 &&
      entry.items.some((item) => item.quantity > 1);
    const order = find(correctable, "delivered order with more than one unit");
    const item = order.items.find((entry) => entry.quantity > 1)!;
    const before = breakdown(order);
    const { user } = await open(order);
    let card = await section();
    await waitFor(() => expect(profitCalls()).toHaveLength(1));
    expect(within(card).queryByRole("region", { name: "Refunds" })).toBeNull();

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
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Reason" }),
      "damaged",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: `Correct and lower the bill by ${formatMoney(item.unitPrice)}`,
      }),
    );

    // The order was loaded again, and its breakdown with it.
    await waitFor(() => expect(profitCalls().length).toBeGreaterThan(1));
    const after = breakdown(order);
    expect(after.summary.refundAdjustment).not.toBe(0);
    card = await section();
    const row = (
      await within(card).findByText(
        `${item.quantity} ordered, ${item.quantity - 1} kept`,
      )
    ).closest("tr") as HTMLElement;
    // The revenue as it ended, with the ordered one crossed out next to it.
    const line = after.lines.find(
      (entry) => entry.variantId === item.variantId,
    )!;
    expect(row).toHaveTextContent(formatFine(line.final.netRevenue));
    expect(within(row).getAllByText("As ordered:").length).toBeGreaterThan(0);
    expect(row.querySelector("s")).toHaveTextContent(
      formatFine(line.ordered.netRevenue),
    );

    const list = within(
      within(card).getByRole("region", { name: "Order summary" }),
    ).getByLabelText("Order summary");
    // The rows of the order as it was agreed stay; the adjustment follows.
    expect(valueOf(list, "Profit as ordered")).toBe(
      formatFine(before.summary.profitAsOrdered),
    );
    expect(valueOf(list, "Refund adjustments")).toBe(
      formatFine(after.summary.refundAdjustment),
    );
    expect(valueOf(list, "Final net profit")).toBe(
      formatFine(after.summary.netProfit),
    );
    const refunds = within(
      within(card).getByRole("region", { name: "Refunds" }),
    ).getByLabelText("Refunds");
    expect(valueOf(refunds, "Revenue given back")).toBe(
      formatFine(after.refunds.revenue),
    );
    expect(valueOf(refunds, "Costs recovered")).toBe(
      formatFine(after.refunds.costsRecovered),
    );
    const paid = within(
      within(card).getByRole("region", { name: "What the customer paid" }),
    ).getByLabelText("What the customer paid");
    expect(valueOf(paid, "Still to refund")).toBe(
      formatMoney(after.customer.pendingRefund),
    );
  });
});

describe("who sees cost and profit", () => {
  it("shows no section and asks nothing without the right to see costs and profit", async () => {
    const order = find(settled, "delivered order");
    await open(order, [
      "orders.read",
      "orders.manage",
      "payments.read",
      "payments.manage",
      "customers.read",
    ]);
    await screen.findByRole("table", {
      name: new RegExp(`Items of ${order.orderNumber}`),
    });
    expect(
      screen.queryByRole("region", { name: "Cost & profit" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Final net profit")).not.toBeInTheDocument();
    expect(profitCalls()).toEqual([]);
  });

  it("shows the section to a role that may only read", async () => {
    const order = find(complete, "delivered order with every buying price");
    await open(order, ["orders.read", "finance.read"]);
    const card = await section();
    expect(
      await within(card).findByText("Final net profit"),
    ).toBeInTheDocument();
    expect(profitCalls().map((call) => call.path)).toEqual([
      `/v1/admin/finance/orders/${order.id}/profit`,
    ]);
  });

  it("is refused by the API without the permission, whatever the panel shows", async () => {
    await api.signIn("orders");
    const order = find(settled, "delivered order");
    await expect(
      api.request("GET", `/v1/admin/finance/orders/${order.id}/profit`),
    ).rejects.toThrow(/answered 403/);
    await expect(
      api.request("GET", "/v1/admin/finance/settings"),
    ).rejects.toThrow(/answered 403/);
  });
});
