// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Customer } from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { CustomerView } from "./customer-view";
import { CustomersView } from "./customers-view";

let api: TestApi;

const customers = () => api.mock.db().customers;
const name = (customer: Customer) =>
  `${customer.firstName} ${customer.lastName}`;

function show(customer: Customer, path = `/customers/${customer.id}`) {
  return renderPanel(<CustomerView />, {
    path,
    params: { id: customer.id },
  });
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("guests and closed accounts", () => {
  it("marks guests in the list and filters by kind with the API's parameter", async () => {
    renderPanel(<CustomersView />, { path: "/customers?kind=guest" });
    const guests = customers().filter((entry) => entry.kind === "guest");
    expect(
      await screen.findByText(`${guests.length} customers, that is all`),
    ).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toContain(
      "/v1/admin/customers?kind=guest&limit=50",
    );
    const table = screen.getByRole("table", { name: /^Customers/ });
    expect(within(table).getAllByText("Guest").length).toBe(guests.length);
    expect(within(table).queryByText("Registered")).not.toBeInTheDocument();
  });

  it("shows a closed account as such: no personal fields, no block button", async () => {
    const closed = customers().find((entry) => entry.status === "deleted");
    if (!closed) throw new Error("No closed account in the demo data");
    show(closed);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Deleted account" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This account was closed by the customer on/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Block the account/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(closed.email)).not.toBeInTheDocument();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    // The orders stay for the books and name the account the same way.
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/orders?customerId=${closed.id}&limit=5`,
      ),
    );
    const orders = api.mock
      .db()
      .orders.filter((order) => order.customer.id === closed.id);
    expect(orders.length).toBeGreaterThan(0);
    const table = await screen.findByRole("table", {
      name: "The newest orders of Deleted account",
    });
    expect(
      within(table).getAllByRole("link", { name: /^RF-\d+$/ }).length,
    ).toBeGreaterThan(0);
  });

  it("shows the referral code, whom the customer was referred by, and the Referrals and Reviews tabs", async () => {
    const referral = api.mock.db().referrals[0];
    if (!referral) throw new Error("No referral in the demo data");
    const referred = customers().find(
      (entry) => entry.id === referral.referredId,
    )!;
    const referrer = customers().find(
      (entry) => entry.id === referral.referrerId,
    )!;
    const { user } = show(referred);
    await screen.findByRole("heading", { level: 1, name: name(referred) });
    // The inviter is named once their record is loaded (0.9).
    await waitFor(() =>
      expect(screen.getByText("Referred by").nextSibling).toHaveTextContent(
        name(referrer),
      ),
    );
    expect(screen.getByRole("link", { name: name(referrer) })).toHaveAttribute(
      "href",
      `/customers/${referrer.id}`,
    );

    await user.click(screen.getByRole("tab", { name: "Referrals" }));
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/referrals?referrerId=${referred.id}&limit=50`,
      ),
    );
    expect(testNavigation.location).toBe(
      `/customers/${referred.id}?tab=referrals`,
    );

    await user.click(screen.getByRole("tab", { name: "Reviews" }));
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/reviews?customerId=${referred.id}&limit=25`,
      ),
    );
  });

  it("lists whom an inviter brought, with the code on the profile", async () => {
    const referral = api.mock
      .db()
      .referrals.find((entry) => entry.status === "qualified");
    if (!referral) throw new Error("No qualified referral in the demo data");
    const referrer = customers().find(
      (entry) => entry.id === referral.referrerId,
    )!;
    const referred = customers().find(
      (entry) => entry.id === referral.referredId,
    )!;
    show(referrer, `/customers/${referrer.id}?tab=referrals`);
    await screen.findByRole("heading", { level: 1, name: name(referrer) });
    expect(screen.getByText(referrer.referralCode!)).toBeInTheDocument();
    const table = await screen.findByRole("table", {
      name: `Referrals of ${name(referrer)}`,
    });
    expect(
      await within(table).findByRole("link", { name: name(referred) }),
    ).toHaveAttribute("href", `/customers/${referred.id}`);
    expect(within(table).getByText("Qualified")).toBeInTheDocument();
  });

  it("hides the Reviews tab from an admin who may not read reviews", async () => {
    const customer = customers().find(
      (entry) => entry.status === "active" && entry.kind === "registered",
    )!;
    renderPanel(<CustomerView />, {
      path: `/customers/${customer.id}`,
      params: { id: customer.id },
      permissions: ["customers.read", "orders.read"],
    });
    await screen.findByRole("heading", { level: 1, name: name(customer) });
    expect(screen.getByRole("tab", { name: "Referrals" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Reviews" }),
    ).not.toBeInTheDocument();
  });
});
