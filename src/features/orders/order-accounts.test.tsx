// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { OrderRecord } from "../../../mocks/db.ts";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { TodayView } from "@/features/today/today-view";
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

async function open(order: OrderRecord) {
  renderPanel(<OrderView />, { params: { id: order.id } });
  await screen.findByRole("heading", {
    level: 1,
    name: new RegExp(order.orderNumber),
  });
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("guests, closed accounts, the review and the reports on an order", () => {
  it("marks a guest order in the list and on its page", async () => {
    const guest = find((entry) => entry.isGuest, "guest order");
    renderPanel(<OrdersList />, {
      path: `/orders?orderNumber=${guest.orderNumber}`,
    });
    const link = await screen.findByRole("link", { name: guest.orderNumber });
    expect(within(link.closest("tr")!).getByText("Guest")).toHaveAttribute(
      "title",
      "Ordered without an account",
    );
  });

  it("explains a guest order on its page", async () => {
    const guest = find((entry) => entry.isGuest, "guest order");
    await open(guest);
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ordered without an account\. The emails about the order/,
      ),
    ).toBeInTheDocument();
  });

  it("names a closed account without an email", async () => {
    const order = find(
      (entry) => entry.customer.deleted === true,
      "order of a closed account",
    );
    await open(order);
    expect(
      screen.getByRole("link", { name: "Deleted account" }),
    ).toHaveAttribute("href", `/customers/${order.customer.id}`);
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(
      screen.getByText(/The customer closed the account/),
    ).toBeInTheDocument();
  });

  it("shows the review of a delivered order with a link to its page", async () => {
    const review = api.mock.db().reviews[0];
    if (!review) throw new Error("No review in the demo data");
    const order = find(
      (entry) => entry.id === review.orderId,
      "order with a review",
    );
    await open(order);
    expect(
      await screen.findByRole("img", {
        name: `Rating: ${review.rating} of 5 stars`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(`“${review.text}”`)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the review" }),
    ).toHaveAttribute("href", `/reviews/${review.id}`);
    expect(api.calls.map((call) => call.path)).toContain(
      `/v1/admin/reviews?orderNumber=${order.orderNumber}`,
    );
  });

  it("shows no review box without a review, and asks for none without the permission", async () => {
    const reviewed = new Set(
      api.mock.db().reviews.map((entry) => entry.orderId),
    );
    const plain = find(
      (entry) => entry.status === "delivered" && !reviewed.has(entry.id),
      "delivered order without a review",
    );
    await open(plain);
    await screen.findByText("Customer", { selector: "h2, h3" });
    expect(screen.queryByText("Review")).not.toBeInTheDocument();

    const review = api.mock.db().reviews[0]!;
    const order = find(
      (entry) => entry.id === review.orderId,
      "order with a review",
    );
    api.calls.length = 0;
    renderPanel(<OrderView />, {
      params: { id: order.id },
      permissions: ["orders.read", "customers.read"],
    });
    await screen.findByRole("heading", {
      level: 1,
      name: new RegExp(order.orderNumber),
    });
    expect(
      api.calls.some((call) => call.path.startsWith("/v1/admin/reviews")),
    ).toBe(false);
  });

  it("lists the problem reports of the order next to its returns", async () => {
    const reported = api.mock.db().issues[0];
    if (!reported) throw new Error("No problem report in the demo data");
    const order = find(
      (entry) => entry.id === reported.orderId,
      "order with a report",
    );
    await open(order);
    const link = await screen.findByRole("link", {
      name: new RegExp(reported.issueNumber),
    });
    expect(link).toHaveAttribute("href", `/issues/${reported.id}`);
  });

  it("shows nothing about reports on an order without one", async () => {
    const reported = new Set(
      api.mock.db().issues.map((entry) => entry.orderId),
    );
    const plain = find(
      (entry) => entry.status === "delivered" && !reported.has(entry.id),
      "delivered order without a report",
    );
    await open(plain);
    expect(screen.queryByText("Problem reports")).not.toBeInTheDocument();
  });
});

describe("the start page", () => {
  it("counts the open reports and the reviews to read", async () => {
    renderPanel(<TodayView />, { path: "/" });
    const open = api.mock
      .db()
      .issues.filter((entry) => entry.status === "open");
    const tile = (
      await screen.findByText("Problem reports", { selector: "span" })
    ).closest("a")!;
    expect(tile).toHaveTextContent(String(open.length));
    expect(tile).toHaveAttribute("href", "/issues?status=open");
    const panel = screen
      .getByRole("heading", { name: "Problem reports" })
      .closest("section")!;
    for (const issue of open) {
      expect(
        within(panel).getByRole("link", {
          name: new RegExp(issue.issueNumber),
        }),
      ).toHaveAttribute("href", `/issues/${issue.id}`);
    }
    const pending = api.mock
      .db()
      .reviews.filter((entry) => entry.status === "pending");
    const reviews = (
      await screen.findByText("Reviews to read", { selector: "span" })
    ).closest("a")!;
    expect(reviews).toHaveTextContent(String(pending.length));
    expect(reviews).toHaveAttribute("href", "/reviews?status=pending");
  });

  it("leaves the reviews tile out for an admin who may not read them", async () => {
    renderPanel(<TodayView />, { path: "/", permissions: ["orders.read"] });
    await screen.findByText("Problem reports", { selector: "span" });
    expect(screen.queryByText("Reviews to read")).not.toBeInTheDocument();
  });
});
