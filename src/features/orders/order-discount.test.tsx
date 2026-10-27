// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { OrderRecord } from "../../../mocks/db.ts";
import { formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { OrderView } from "./order-view";
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

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the discount code of an order", () => {
  it("is shown next to the number in the list", async () => {
    const withCode = find(
      (entry) => entry.discount !== null && entry.status === "confirmed",
      "confirmed order made with a code",
    );
    renderPanel(<OrdersList />, { path: "/orders" });
    const link = await screen.findByRole("link", {
      name: withCode.orderNumber,
    });
    const row = link.closest("tr");
    if (!row) throw new Error("No row");
    expect(within(row).getByText(withCode.discount!.code)).toBeInTheDocument();
    expect(within(row).getByText(withCode.discount!.code)).toHaveAttribute(
      "title",
      `Made with the discount code ${withCode.discount!.code}`,
    );
  });

  it("is explained on the order with its state, the amount per line and a Discount row in the totals", async () => {
    const withCode = find(
      (entry) =>
        entry.discount !== null &&
        entry.discount.state === "used" &&
        entry.totals.discount > 0 &&
        entry.finalTotals.total === entry.totals.total,
      "paid order made with a code",
    );
    renderPanel(<OrderView />, { params: { id: withCode.id } });
    await screen.findByRole("heading", {
      level: 1,
      name: new RegExp(withCode.orderNumber),
    });
    const block = within(screen.getByRole("region", { name: "Discount code" }));
    expect(
      block.getByRole("link", { name: withCode.discount!.code }),
    ).toHaveAttribute(
      "href",
      `/catalogue/discounts?q=${encodeURIComponent(withCode.discount!.code)}`,
    );
    expect(block.getByText("Paid")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Discount code" }),
    ).toHaveTextContent(`${formatMoney(withCode.discount!.amount)} taken off`);

    const bill = screen.getByLabelText("Total");
    expect(bill).toHaveTextContent("Discount");
    expect(bill).toHaveTextContent(formatMoney(-withCode.totals.discount));
    expect(bill).toHaveTextContent(formatMoney(withCode.totals.total));

    // A line with a share says so under its total.
    const line = withCode.items.find((item) => item.discountAmount > 0)!;
    const items = within(
      screen.getByRole("table", { name: `Items of ${withCode.orderNumber}` }),
    );
    const row = items.getByText(line.sku).closest("tr");
    expect(row).toHaveTextContent(
      `${formatMoney(-line.discountAmount)} discount`,
    );
  });

  it("shows no code and no Discount row on an order made without one", async () => {
    const plain = find(
      (entry) =>
        entry.discount === null &&
        entry.status === "delivered" &&
        entry.finalTotals.total === entry.totals.total,
      "delivered order without a code",
    );
    renderPanel(<OrderView />, { params: { id: plain.id } });
    await screen.findByRole("heading", {
      level: 1,
      name: new RegExp(plain.orderNumber),
    });
    expect(
      screen.queryByRole("region", { name: "Discount code" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Total")).not.toHaveTextContent("Discount");
  });
});
