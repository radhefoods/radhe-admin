// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Customer } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { CustomerView } from "./customer-view";
import { CustomersView } from "./customers-view";

let api: TestApi;

const customers = () => api.mock.db().customers;
const stored = (id: string) => {
  const customer = customers().find((entry) => entry.id === id);
  if (!customer) throw new Error(`No customer ${id} in the demo data`);
  return customer;
};
const name = (customer: Customer) =>
  `${customer.firstName} ${customer.lastName}`;

/** A customer who is active, with no decision and nothing overdue. */
function plainCustomer(): Customer {
  const db = api.mock.db();
  const customer = db.customers.find(
    (entry) =>
      entry.status === "active" &&
      entry.orderingOverride === null &&
      !db.orders.some(
        (order) =>
          order.customer.id === entry.id && order.paymentStatus === "overdue",
      ),
  );
  if (!customer) throw new Error("No plain customer in the demo data");
  return customer;
}

/** The customer who was allowed to order although a payment is overdue. */
function allowedCustomer(): Customer {
  const customer = customers().find(
    (entry) => entry.orderingOverride?.mode === "allowed",
  );
  if (!customer)
    throw new Error("No customer with an ordering decision in the demo data");
  return customer;
}

function show(customer: Customer, permissions?: string[]) {
  return renderPanel(<CustomerView />, {
    path: `/customers/${customer.id}`,
    params: { id: customer.id },
    permissions,
  });
}

const writes = () => api.calls.filter((call) => call.method !== "GET");

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("blocking a customer", () => {
  it("says what blocking does and sends the reason", async () => {
    const customer = plainCustomer();
    const { user } = show(customer);

    await user.click(
      await screen.findByRole("button", { name: "Block the account" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: `Block ${name(customer)}?` }),
    ).toBeInTheDocument();
    // What blocking does, before it happens.
    expect(
      within(dialog).getByText(
        "Blocking signs the customer out everywhere and refuses sign-in and ordering, until the account is unblocked.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(customer.email)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await user.type(
      within(dialog).getByRole("textbox", { name: /Reason/ }),
      "Three orders refused at the door.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Block the account" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: `/v1/admin/customers/${customer.id}/status`,
        body: {
          status: "blocked",
          reason: "Three orders refused at the door.",
        },
      },
    ]);
    expect(stored(customer.id).status).toBe("blocked");
    // The page now shows the block with its reason, and offers to undo it.
    expect(
      await screen.findByText(/This account is blocked since/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reason: Three orders refused at the door."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unblock the account" }),
    ).toBeInTheDocument();
  });

  it("blocks without a reason when none is given", async () => {
    const customer = plainCustomer();
    const { user } = show(customer);
    await user.click(
      await screen.findByRole("button", { name: "Block the account" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Block the account" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/customers/${customer.id}/status`,
          body: { status: "blocked" },
        },
      ]),
    );
  });

  it("does nothing when the admin steps back", async () => {
    const customer = plainCustomer();
    const { user } = show(customer);
    await user.click(
      await screen.findByRole("button", { name: "Block the account" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Keep it active" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toHaveLength(0);
    expect(stored(customer.id).status).toBe("active");
  });

  it("shows why and since when a customer is blocked, and unblocks", async () => {
    const customer = customers().find((entry) => entry.status === "blocked");
    if (!customer) throw new Error("No blocked customer in the demo data");
    const { user } = show(customer);

    expect(
      await screen.findByText(/This account is blocked since/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Reason: ${customer.blockedReason}`),
    ).toBeInTheDocument();
    // The ordering decision names the block as what stands in the way.
    expect(
      await screen.findByText("Cannot place a new order"),
    ).toBeInTheDocument();
    expect(screen.getByText("The account is blocked.")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Unblock the account" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Unblock the account" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/customers/${customer.id}/status`,
          body: { status: "active" },
        },
      ]),
    );
    expect(stored(customer.id).status).toBe("active");
  });
});

describe("the ordering decision", () => {
  it("shows the overdue payments with a link to each order", async () => {
    const customer = allowedCustomer();
    const overdue = api.mock
      .db()
      .orders.filter(
        (order) =>
          order.customer.id === customer.id &&
          order.paymentStatus === "overdue",
      );
    expect(overdue.length).toBeGreaterThan(0);
    show(customer);

    // Allowed by a decision although a payment is overdue.
    expect(
      await screen.findByText("May place a new order"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Decision in force: may order until/),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Overdue payments of this customer",
    });
    for (const order of overdue) {
      const link = within(table).getByRole("link", { name: order.orderNumber });
      expect(link).toHaveAttribute(
        "href",
        `/orders?orderNumber=${order.orderNumber}`,
      );
      expect(
        within(table).getByText(formatMoney(order.payment?.amountDue ?? 0)),
      ).toBeInTheDocument();
      expect(
        within(table).getByText(order.payment?.invoice.number ?? ""),
      ).toBeInTheDocument();
    }
    // The decision in the history, with its reason.
    expect(screen.getByText("Allowed to order for 7 days")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Promised to pay on Friday\./).length,
    ).toBeGreaterThan(0);
  });

  it("allows ordering for the days typed, with a reason", async () => {
    const customer = plainCustomer();
    const { user } = show(customer);

    await user.click(
      await screen.findByRole("button", { name: "Allow for a while" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = () =>
      within(dialog).getByRole("button", { name: /^Allow/ });
    // A reason is required: nothing can be sent without it.
    expect(confirm()).toBeDisabled();

    const days = within(dialog).getByRole("textbox", { name: /Allow for/ });
    await user.clear(days);
    await user.type(days, "400");
    expect(within(dialog).getByText("Between 1 and 365.")).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: /Reason/ }),
      "Promised to pay Friday",
    );
    expect(confirm()).toBeDisabled();

    await user.clear(days);
    await user.type(days, "14");
    expect(
      within(dialog).queryByText("Between 1 and 365."),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Allow for 14 days" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `/v1/admin/customers/${customer.id}/ordering`,
        body: {
          action: "allow",
          reason: "Promised to pay Friday",
          allowDays: 14,
        },
      },
    ]);
    expect(stored(customer.id).orderingOverride?.mode).toBe("allowed");
    // The decision appears in the history with the reason.
    expect(
      await screen.findByText("Allowed to order for 14 days"),
    ).toBeInTheDocument();
  });

  it("blocks ordering with a reason and leaves the account active", async () => {
    const customer = plainCustomer();
    const { user } = show(customer);

    await user.click(
      await screen.findByRole("button", { name: "Block ordering" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: `Block ordering for ${name(customer)}?`,
      }),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", {
      name: "Block ordering",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: /Reason/ }),
      "Suspected misuse",
    );
    await user.click(confirm);

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/customers/${customer.id}/ordering`,
          body: { action: "block", reason: "Suspected misuse" },
        },
      ]),
    );
    expect(stored(customer.id).status).toBe("active");
    expect(
      await screen.findByText("Cannot place a new order"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ordering is blocked by a decision of the team."),
    ).toBeInTheDocument();
  });

  it("clears a decision that is in force", async () => {
    const customer = allowedCustomer();
    const { user } = show(customer);

    await user.click(
      await screen.findByRole("button", { name: "Clear the decision" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    // What clearing means for this customer: the payment is still overdue.
    expect(
      within(dialog).getByText(
        /A payment is overdue, so the customer cannot order/,
      ),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: /Reason/ }),
      "Did not pay",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Clear the decision" }),
    );

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/customers/${customer.id}/ordering`,
          body: { action: "clear", reason: "Did not pay" },
        },
      ]),
    );
    expect(stored(customer.id).orderingOverride).toBeNull();
    expect(
      await screen.findByText("Cannot place a new order"),
    ).toBeInTheDocument();
    expect(screen.getByText("A payment is overdue.")).toBeInTheDocument();
  });

  it("offers no clearing when no decision is in force", async () => {
    show(plainCustomer());
    const clear = await screen.findByRole("button", {
      name: "Clear the decision",
    });
    expect(clear).toBeDisabled();
    expect(
      screen.getByLabelText("No decision is in force."),
    ).toBeInTheDocument();
  });
});

describe("the customer page", () => {
  it("links to everything of the customer and lists the newest orders", async () => {
    const customer = allowedCustomer();
    show(customer);
    const records = await screen.findByRole("navigation", {
      name: `Records of ${name(customer)}`,
    });
    expect(
      within(records).getByRole("link", { name: "Orders" }),
    ).toHaveAttribute("href", `/orders?customerId=${customer.id}`);
    expect(
      within(records).getByRole("link", { name: "Invoices" }),
    ).toHaveAttribute("href", `/payments/invoices?customerId=${customer.id}`);
    expect(
      within(records).getByRole("link", { name: "Returns" }),
    ).toHaveAttribute("href", `/returns?customerId=${customer.id}`);
    expect(
      within(records).getByRole("link", { name: "Messages" }),
    ).toHaveAttribute(
      "href",
      `/communication/notifications?customerId=${customer.id}`,
    );
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "GET",
        path: `/v1/admin/orders?customerId=${customer.id}&limit=5`,
        body: undefined,
      }),
    );
    expect(
      screen.getByRole("link", { name: "All orders of this customer" }),
    ).toHaveAttribute("href", `/orders?customerId=${customer.id}`);
  });

  it("says that an unknown customer does not exist", async () => {
    renderPanel(<CustomerView />, {
      path: "/customers/000000000000000000000000",
      params: { id: "000000000000000000000000" },
    });
    expect(
      await screen.findByText("This customer does not exist"),
    ).toBeInTheDocument();
  });
});

describe("permissions", () => {
  it("keeps every change visible but disabled without customers.manage", async () => {
    const customer = allowedCustomer();
    show(customer, ["customers.read"]);

    expect(
      await screen.findByRole("button", { name: "Block the account" }),
    ).toBeDisabled();
    for (const label of [
      "Allow for a while",
      "Block ordering",
      "Clear the decision",
    ]) {
      expect(await screen.findByRole("button", { name: label })).toBeDisabled();
    }
    // Each says what is missing.
    expect(
      screen.getAllByLabelText(
        'Your role does not include "Customers: manage".',
      ),
    ).toHaveLength(4);
    // Orders, invoices, returns and messages need their own permissions.
    expect(screen.queryByText("Newest orders")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Invoices" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Messages" }),
    ).not.toBeInTheDocument();
    expect(
      api.calls.some((call) => call.path.startsWith("/v1/admin/orders")),
    ).toBe(false);
  });

  it("does not open the page without customers.read", () => {
    const customer = plainCustomer();
    show(customer, ["orders.read"]);
    expect(
      screen.getByText("Your role does not open this page"),
    ).toBeInTheDocument();
  });
});

describe("the list of customers", () => {
  it("searches by the beginning of the email, from two characters on", async () => {
    const target = plainCustomer();
    const prefix = target.email.slice(0, 6);
    const { user } = renderPanel(<CustomersView />, { path: "/customers" });

    expect(
      screen.getByText(/The search finds the beginning of the email address/),
    ).toBeInTheDocument();
    await screen.findByRole("link", {
      name: name(customers()[customers().length - 1] as Customer),
    });
    api.calls.length = 0;

    const search = screen.getByRole("searchbox", {
      name: "Search customers by the beginning of their email address",
    });
    await user.type(search, prefix.slice(0, 1));
    expect(
      await screen.findByText("Type at least 2 characters."),
    ).toBeInTheDocument();
    await user.type(search, prefix.slice(1));

    await waitFor(() =>
      expect(testNavigation.location).toBe(
        `/customers?email=${encodeURIComponent(prefix)}`,
      ),
    );
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/customers?email=${encodeURIComponent(prefix)}&limit=50`,
      ),
    );
    // One character alone was never sent to the API.
    expect(
      api.calls.some((call) =>
        call.path.includes(`email=${prefix.slice(0, 1)}&`),
      ),
    ).toBe(false);
    expect(
      await screen.findByRole("link", { name: name(target) }),
    ).toBeInTheDocument();
  });

  it("filters by status from the address and loads more by cursor", async () => {
    const { user } = renderPanel(<CustomersView />, { path: "/customers" });
    const more = await screen.findByRole("button", { name: "Load more" });
    expect(
      screen.getByText("Showing the newest 50 customers"),
    ).toBeInTheDocument();
    await user.click(more);
    expect(
      await screen.findByText(`${customers().length} customers, that is all`),
    ).toBeInTheDocument();
    expect(
      api.calls.some((call) =>
        /\/v1\/admin\/customers\?limit=50&cursor=[0-9a-f]{24}$/.test(call.path),
      ),
    ).toBe(true);
  });

  it("shows the blocked customers when the address asks for them", async () => {
    renderPanel(<CustomersView />, { path: "/customers?status=blocked" });
    const blocked = customers().filter((entry) => entry.status === "blocked");
    expect(
      await screen.findByText(
        `${blocked.length} customer${blocked.length === 1 ? "" : "s"}, that is all`,
      ),
    ).toBeInTheDocument();
    expect(api.calls.map((call) => call.path)).toContain(
      "/v1/admin/customers?status=blocked&limit=50",
    );
  });
});
