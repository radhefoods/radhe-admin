// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cargo, CargoOverview, PageResult } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { CargoActions } from "./cargo-actions";

let api: TestApi;
let overview: CargoOverview;
let cargos: Cargo[];

const byCode = (code: string) => {
  const cargo = cargos.find((entry) => entry.code === code);
  if (!cargo) throw new Error(`No cargo ${code} in the demo data`);
  return cargo;
};
const withStatus = (status: Cargo["status"]) => {
  const cargo = cargos.find((entry) => entry.status === status);
  if (!cargo) throw new Error(`No ${status} cargo in the demo data`);
  return cargo;
};

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  overview = await api.request<CargoOverview>(
    "GET",
    "/v1/admin/cargos/overview",
  );
  cargos = (
    await api.request<PageResult<Cargo>>("GET", "/v1/admin/cargos?limit=50")
  ).items;
  api.calls.length = 0;
});

describe("closing the cargo that takes orders", () => {
  it("restates the numbers of the cargo and closes it", async () => {
    const cargo = overview.current as Cargo;
    const summary = await api.request<{
      summary: { orders: number; customers: number; bookedValue: number };
    }>("GET", `/v1/admin/orders/summary?cargoId=${cargo.id}`);
    const { user } = renderPanel(<CargoActions cargo={cargo} />);

    await user.click(screen.getByRole("button", { name: "Close ordering" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: `Close ordering for ${cargo.code}?`,
      }),
    ).toBeInTheDocument();
    // The real numbers of the API, before anything happens.
    expect(
      await within(dialog).findByText(formatMoney(summary.summary.bookedValue)),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Customers").nextSibling).toHaveTextContent(
      String(summary.summary.customers),
    );
    expect(api.calls.some((call) => call.method !== "GET")).toBe(false);

    await user.click(
      within(dialog).getByRole("button", { name: "Close ordering" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.calls).toContainEqual({
      method: "POST",
      path: `/v1/admin/cargos/${cargo.id}/close`,
      body: {},
    });
    expect(
      api.mock.db().cargos.find((entry) => entry.id === cargo.id)?.status,
    ).toBe("orders_closed");
  });

  it("does nothing when the admin steps back", async () => {
    const cargo = overview.current as Cargo;
    const { user } = renderPanel(<CargoActions cargo={cargo} />);
    await user.click(screen.getByRole("button", { name: "Close ordering" }));
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.calls.some((call) => call.method !== "GET")).toBe(false);
    expect(
      api.mock.db().cargos.find((entry) => entry.id === cargo.id)?.status,
    ).toBe("taking_orders");
  });

  it("can open the next cargo in the same step", async () => {
    const cargo = overview.current as Cargo;
    const next = overview.next as Cargo;
    // The next cargo's window has begun, so that it may open.
    const record = api.mock.db().cargos.find((entry) => entry.id === next.id);
    if (record)
      record.orderOpenAt = new Date(Date.now() - 60_000).toISOString();
    const current = api.mock.db().cargos.find((entry) => entry.id === cargo.id);
    if (current)
      current.orderCloseAt = new Date(Date.now() - 30_000).toISOString();

    const { user } = renderPanel(<CargoActions cargo={cargo} />);
    await user.click(screen.getByRole("button", { name: "Close ordering" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      await within(dialog).findByRole("checkbox", {
        name: new RegExp(`Open ${next.code} at once`),
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Close ordering" }),
    );
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/v1/admin/cargos/rollover",
        body: { nextCargoId: next.id },
      }),
    );
    const db = api.mock.db();
    expect(db.cargos.find((entry) => entry.id === cargo.id)?.status).toBe(
      "orders_closed",
    );
    expect(db.cargos.find((entry) => entry.id === next.id)?.status).toBe(
      "taking_orders",
    );
  });
});

describe("opening a cargo", () => {
  it("closes the cargo that takes orders in the same step", async () => {
    const current = overview.current as Cargo;
    const next = overview.next as Cargo;
    const { user } = renderPanel(<CargoActions cargo={next} />);

    await user.click(screen.getByRole("button", { name: "Open ordering" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      await within(dialog).findByRole("heading", {
        name: `Close ${current.code} and open ${next.code}?`,
      }),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", {
        name: `Close ${current.code}, open ${next.code}`,
      }),
    );
    // The demo's next cargo opens tomorrow: the API refuses nothing here,
    // because a cargo may be opened by hand before its opening time.
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/v1/admin/cargos/rollover",
        body: { nextCargoId: next.id },
      }),
    );
  });
});

describe("the steps of a cargo on its way", () => {
  it("offers exactly what the API allows", () => {
    const cargo = {
      ...withStatus("in_transit"),
      allowedStatuses: ["arrived" as const],
    };
    renderPanel(<CargoActions cargo={cargo} />);
    expect(
      screen.getByRole("button", { name: "Mark arrived" }),
    ).toBeInTheDocument();
    // No step back and no cancellation: the API did not offer them.
    expect(
      screen.queryByRole("button", { name: /More actions/ }),
    ).not.toBeInTheDocument();
  });

  it("offers nothing for a cancelled cargo", () => {
    renderPanel(<CargoActions cargo={withStatus("cancelled")} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("marks the dispatched orders delivered, except the ones left out", async () => {
    const cargo = withStatus("delivering");
    const dispatched = api.mock
      .db()
      .orders.filter(
        (order) => order.cargo.id === cargo.id && order.status === "dispatched",
      );
    const leftOut = dispatched[0];
    if (!leftOut) throw new Error("The demo cargo has no dispatched order");
    const { user } = renderPanel(<CargoActions cargo={cargo} />);

    await user.click(screen.getByRole("button", { name: "Mark delivered" }));
    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByRole("button", {
      name: `Mark ${dispatched.length} orders delivered`,
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Leave single orders out" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: `${leftOut.orderNumber} will be delivered`,
      }),
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: `Mark ${dispatched.length - 1} orders delivered`,
      }),
    );

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "PUT",
        path: `/v1/admin/cargos/${cargo.id}/status`,
        body: { status: "delivered", excludeOrderIds: [leftOut.id] },
      }),
    );
    const orders = api.mock.db().orders;
    expect(orders.find((order) => order.id === leftOut.id)?.status).toBe(
      "dispatched",
    );
    expect(
      orders.filter(
        (order) => order.cargo.id === cargo.id && order.status === "dispatched",
      ),
    ).toHaveLength(1);
  });

  it("cancels a cargo with orders only with a target and its code typed", async () => {
    const cargo = withStatus("in_transit");
    const target = withStatus("taking_orders");
    const orders = api.mock
      .db()
      .orders.filter(
        (order) => order.cargo.id === cargo.id && order.status !== "cancelled",
      );
    const { user } = renderPanel(<CargoActions cargo={cargo} />);

    await user.click(screen.getByRole("button", { name: /More actions/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Cancel cargo" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = await within(dialog).findByRole("button", {
      name: `Cancel and move ${orders.length} orders`,
    });
    expect(confirm).toBeDisabled();

    await user.selectOptions(
      await within(dialog).findByRole("combobox", {
        name: "Move the orders to",
      }),
      target.id,
    );
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: /to confirm/ }),
      cargo.code,
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "PUT",
        path: `/v1/admin/cargos/${cargo.id}/status`,
        body: { status: "cancelled", moveOrdersToCargoId: target.id },
      }),
    );
    const db = api.mock.db();
    expect(db.cargos.find((entry) => entry.id === cargo.id)?.status).toBe(
      "cancelled",
    );
    expect(
      db.orders.filter(
        (order) => order.cargo.id === cargo.id && order.status !== "cancelled",
      ),
    ).toHaveLength(0);
  });

  it("shows the API's refusal and keeps the dialog open", async () => {
    const cargo = byCode(overview.next?.code ?? "");
    // The window passed in the meantime: the API refuses to open the cargo.
    const record = api.mock.db().cargos.find((entry) => entry.id === cargo.id);
    if (record)
      record.orderCloseAt = new Date(Date.now() - 60_000).toISOString();
    const { user, unhandled } = renderPanel(<CargoActions cargo={cargo} />);

    await user.click(screen.getByRole("button", { name: "Open ordering" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      await within(dialog).findByRole("button", { name: /open RF-C/ }),
    );
    expect(
      await within(dialog).findByText(
        "The order deadline of this cargo lies in the past.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // The dialog shows the error itself: no second report as a toast.
    expect(unhandled).toHaveLength(0);
  });
});

describe("activating payment for a cargo", () => {
  it("restates what will be collected and activates the delivered orders", async () => {
    const cargo = cargos.find(
      (entry) =>
        entry.status === "delivered" &&
        api.mock
          .db()
          .orders.some(
            (order) =>
              order.cargo.id === entry.id &&
              order.status === "delivered" &&
              !order.payment,
          ),
    );
    if (!cargo)
      throw new Error(
        "No delivered cargo waits for its invoices in the demo data",
      );
    const waiting = api.mock
      .db()
      .orders.filter(
        (order) =>
          order.cargo.id === cargo.id &&
          order.status === "delivered" &&
          !order.payment,
      );
    const amount = waiting.reduce(
      (sum, order) => sum + order.finalTotals.total,
      0,
    );
    const { user } = renderPanel(<CargoActions cargo={cargo} />);

    await user.click(
      await screen.findByRole("button", { name: /Activate payment/ }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      await within(dialog).findByText(formatMoney(amount)),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/German time/)).toBeInTheDocument();
    expect(api.calls.some((call) => call.method !== "GET")).toBe(false);

    await user.click(
      within(dialog).getByRole("button", {
        name: `Activate and notify ${waiting.length} customers`,
      }),
    );
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: `/v1/admin/cargos/${cargo.id}/payments/activate`,
        body: { deadlineDays: 5, excludeOrderIds: [] },
      }),
    );
    const after = api.mock
      .db()
      .orders.filter((order) => waiting.some((w) => w.id === order.id));
    expect(
      after.every((order) => order.paymentStatus === "due" && order.payment),
    ).toBe(true);
  });

  it("refuses a deadline the API would refuse", async () => {
    const cargo = withStatus("delivered");
    const record = api.mock
      .db()
      .orders.find(
        (order) =>
          order.cargo.id === cargo.id &&
          order.status === "delivered" &&
          !order.payment,
      );
    if (!record) {
      // Make one order of the cargo wait for its invoice.
      const any = api.mock
        .db()
        .orders.find((order) => order.cargo.id === cargo.id && order.payment);
      if (any) {
        any.payment = null;
        any.paymentStatus = "not_enabled";
      }
    }
    const { user } = renderPanel(<CargoActions cargo={cargo} />);
    await user.click(
      await screen.findByRole("button", { name: /Activate payment/ }),
    );
    const dialog = await screen.findByRole("alertdialog");
    const days = await within(dialog).findByRole("textbox", {
      name: "Days to pay",
    });
    await user.clear(days);
    await user.type(days, "90");
    expect(
      within(dialog).getByText("Between 1 and 60 days."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Activate and notify/ }),
    ).toBeDisabled();
  });
});

describe("permissions", () => {
  it("keeps the next step visible but disabled without cargos.manage", async () => {
    const cargo = overview.current as Cargo;
    const { user } = renderPanel(<CargoActions cargo={cargo} />, {
      permissions: ["cargos.read", "orders.read"],
    });
    const button = screen.getByRole("button", { name: "Close ordering" });
    expect(button).toBeDisabled();
    // The hint says what is missing.
    expect(
      screen.getByLabelText('Your role does not include "Cargos: manage".'),
    ).toBeInTheDocument();
    await user.click(button).catch(() => undefined);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // Nothing that changes the cargo is offered in a menu either.
    expect(
      screen.queryByRole("button", { name: /More actions/ }),
    ).not.toBeInTheDocument();
  });

  it("offers payment activation only with payments.manage", async () => {
    const cargo = cargos.find(
      (entry) =>
        entry.status === "delivered" &&
        api.mock
          .db()
          .orders.some(
            (order) =>
              order.cargo.id === entry.id &&
              order.status === "delivered" &&
              !order.payment,
          ),
    );
    if (!cargo)
      throw new Error(
        "No delivered cargo waits for its invoices in the demo data",
      );
    renderPanel(<CargoActions cargo={cargo} />, {
      permissions: ["cargos.read", "cargos.manage", "payments.read"],
    });
    const button = await screen.findByRole("button", {
      name: /Activate payment/,
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByLabelText('Your role does not include "Payments: manage".'),
    ).toBeInTheDocument();
  });
});
