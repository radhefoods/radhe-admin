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
const stored = (id: string) => {
  const customer = customers().find((entry) => entry.id === id);
  if (!customer) throw new Error(`No customer ${id} in the demo data`);
  return customer;
};
const name = (customer: Customer) =>
  `${customer.firstName} ${customer.lastName}`;

/** An active customer with at least one order. */
function plainCustomer(): Customer {
  const db = api.mock.db();
  const customer = db.customers.find(
    (entry) =>
      entry.status === "active" &&
      db.orders.some((order) => order.customer.id === entry.id),
  );
  if (!customer) throw new Error("No plain customer in the demo data");
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
        "Blocking signs the customer out everywhere and refuses sign-in and checkout, until the account is unblocked.",
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

describe("the customer page", () => {
  it("links to everything of the customer and lists the newest orders", async () => {
    const customer = plainCustomer();
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
    const customer = plainCustomer();
    show(customer, ["customers.read"]);

    expect(
      await screen.findByRole("button", { name: "Block the account" }),
    ).toBeDisabled();
    // It says what is missing.
    expect(
      screen.getAllByLabelText(
        'Your role does not include "Customers: manage".',
      ),
    ).toHaveLength(1);
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
  it("searches by words of the name, the email or the phone, and says how many match", async () => {
    const target = plainCustomer();
    const prefix = target.email.slice(0, 6);
    const { user } = renderPanel(<CustomersView />, { path: "/customers" });
    await screen.findByRole("link", {
      name: name(customers()[customers().length - 1] as Customer),
    });
    expect(
      await screen.findByText(
        new RegExp(
          `of ${customers().length} customers|^${customers().length} customers, that is all`,
        ),
      ),
    ).toBeInTheDocument();
    api.calls.length = 0;

    const search = screen.getByRole("searchbox", { name: "Search customers" });
    await user.type(search, prefix);

    await waitFor(() =>
      expect(testNavigation.location).toBe(
        `/customers?q=${encodeURIComponent(prefix)}`,
      ),
    );
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/customers?q=${encodeURIComponent(prefix)}&limit=50`,
      ),
    );
    // The count follows the same filters.
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        `/v1/admin/customers/count?q=${encodeURIComponent(prefix)}`,
      ),
    );
    expect(
      await screen.findByRole("link", { name: name(target) }),
    ).toBeInTheDocument();
  });

  it("filters by status from the address and loads more by cursor", async () => {
    const { user } = renderPanel(<CustomersView />, { path: "/customers" });
    const more = await screen.findByRole("button", { name: "Load more" });
    expect(
      screen.getByText(/^Showing 50 of \d+ customers$/),
    ).toBeInTheDocument();
    await user.click(more);
    expect(
      await screen.findByText(`${customers().length} customers, that is all`),
    ).toBeInTheDocument();
    expect(
      api.calls.some((call) =>
        // The cursor is an opaque string (0.8).
        /\/v1\/admin\/customers\?limit=50&cursor=[A-Za-z0-9_-]+$/.test(
          call.path,
        ),
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
