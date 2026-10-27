// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscountCode, PageResult } from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { DiscountNewView, DiscountView } from "./discount-view";
import { DiscountsView } from "./discounts-view";

let api: TestApi;
let codes: DiscountCode[];

vi.setConfig({ testTimeout: 30_000 });

const READ_ONLY = ["discounts.read", "orders.read"];

/** The requests that change something. */
const writes = () => api.calls.filter((call) => call.method !== "GET");

function code(text: string): DiscountCode {
  const found = codes.find((entry) => entry.code === text);
  if (!found) throw new Error(`No discount code "${text}" in the demo data`);
  return found;
}

const stored = (id: string) =>
  api.mock.db().discountCodes.find((entry) => entry.id === id);

/** A field of a form by the name the form gives it. */
function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

function renderCode(id: string, permissions?: string[]) {
  return renderPanel(<DiscountView />, {
    path: `/catalogue/discounts/${id}`,
    params: { id },
    permissions,
  });
}

const table = async () =>
  within(await screen.findByRole("table", { name: "Discount codes" }));

const rowOf = async (text: string) => {
  const link = await (await table()).findByRole("link", { name: text });
  const row = link.closest("tr");
  if (!row) throw new Error(`No row for ${text}`);
  return within(row);
};

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  codes = (
    await api.request<PageResult<DiscountCode>>(
      "GET",
      "/v1/admin/discounts?limit=100",
    )
  ).items;
  api.calls.length = 0;
});

describe("the list of discount codes", () => {
  it("shows each code with its discount, state, uses and period, and filters through the API", async () => {
    const { user } = renderPanel(<DiscountsView />, {
      path: "/catalogue/discounts",
    });
    const diwali = await rowOf("DIWALI10");
    expect(diwali.getByText("10 %")).toBeInTheDocument();
    expect(diwali.getByText("Active")).toBeInTheDocument();
    const live = code("DIWALI10");
    expect(
      diwali.getByText(
        `${live.usedCount} of ${live.maxUses}${live.reservedCount > 0 ? ` · ${live.reservedCount} pending` : ""}`,
      ),
    ).toBeInTheDocument();
    expect(diwali.getByText(/^Until /)).toBeInTheDocument();
    expect(
      diwali.getByRole("switch", { name: "DIWALI10 is switched on" }),
    ).toBeChecked();

    const spring = await rowOf("SPRING15");
    expect(spring.getByText("Expired")).toBeInTheDocument();
    const welcome = await rowOf("WELCOME5");
    expect(welcome.getByText("€5.00")).toBeInTheDocument();
    expect(welcome.getByText(/· unlimited/)).toBeInTheDocument();
    expect(
      (await rowOf("EARLYBIRD")).getByText("Exhausted"),
    ).toBeInTheDocument();
    expect((await rowOf("XMAS20")).getByText("Scheduled")).toBeInTheDocument();
    expect((await rowOf("STAFF50")).getByText("Inactive")).toBeInTheDocument();
    expect(
      (await rowOf("STAFF50")).getByRole("switch", {
        name: "STAFF50 is switched on",
      }),
    ).not.toBeChecked();

    api.calls.length = 0;
    await user.click(screen.getByRole("button", { name: /^State/ }));
    await user.click(screen.getByRole("menuitem", { name: "Expired" }));
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/discounts?status=expired&page=1&limit=24",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "DIWALI10" }),
      ).not.toBeInTheDocument(),
    );
    expect(testNavigation.location).toBe("/catalogue/discounts?status=expired");

    await user.type(
      screen.getByRole("searchbox", { name: "Search discount codes" }),
      "newsletter",
    );
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/discounts?q=newsletter&status=expired&page=1&limit=24",
      ),
    );
  });

  it("switches a code off at once and tells the API only that", async () => {
    const { user } = renderPanel(<DiscountsView />, {
      path: "/catalogue/discounts",
    });
    const row = await rowOf("DIWALI10");
    await user.click(
      row.getByRole("switch", { name: "DIWALI10 is switched on" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/discounts/${code("DIWALI10").id}`,
      body: { isActive: false },
    });
    expect(
      (await screen.findAllByText("DIWALI10 is switched off")).length,
    ).toBeGreaterThan(0);
    await waitFor(async () =>
      expect(
        (await rowOf("DIWALI10")).getByRole("switch", {
          name: "DIWALI10 is switched on",
        }),
      ).not.toBeChecked(),
    );
    expect((await rowOf("DIWALI10")).getByText("Inactive")).toBeInTheDocument();
    expect(stored(code("DIWALI10").id)?.isActive).toBe(false);
  });
});

describe("the page of a discount code", () => {
  it("shows the facts and every order made with the code, with its state", async () => {
    const diwali = code("DIWALI10");
    renderCode(diwali.id);
    await screen.findByRole("heading", { level: 1, name: /DIWALI10/ });
    const facts = within(screen.getByRole("region", { name: "Facts" }));
    expect(facts.getByText("Active")).toBeInTheDocument();
    expect(
      facts.getByText(`${diwali.remainingUses} of 100`),
    ).toBeInTheDocument();
    expect(facts.getByText("Vrushabh Vasoya")).toBeInTheDocument();

    const uses = api.mock
      .db()
      .discountUses.filter((entry) => entry.codeId === diwali.id);
    expect(uses.length).toBeGreaterThan(2);
    const usesTable = within(
      await screen.findByRole("table", { name: "Uses of DIWALI10" }),
    );
    await waitFor(() =>
      expect(usesTable.getAllByRole("link", { name: /^RF-\d+$/ })).toHaveLength(
        uses.length,
      ),
    );
    const reserved = uses.find((entry) => entry.state === "reserved");
    const released = uses.find((entry) => entry.state === "released");
    const used = uses.find((entry) => entry.state === "used");
    expect(reserved && released && used).toBeTruthy();
    const rowFor = (orderNumber: string) => {
      const row = usesTable
        .getByRole("link", { name: orderNumber })
        .closest("tr");
      if (!row) throw new Error(`No row for ${orderNumber}`);
      return within(row);
    };
    expect(
      rowFor(reserved!.orderNumber).getByText("Waiting for payment"),
    ).toBeInTheDocument();
    expect(
      rowFor(released!.orderNumber).getByText("Given up unpaid"),
    ).toBeInTheDocument();
    expect(rowFor(used!.orderNumber).getByText("Paid")).toBeInTheDocument();
    expect(
      usesTable.getByRole("link", { name: used!.orderNumber }),
    ).toHaveAttribute("href", `/orders/${used!.orderId}`);
  });

  it("keeps the text of a used code, saves only what changed, and clears an emptied field with null", async () => {
    const diwali = code("DIWALI10");
    const { user } = renderCode(diwali.id);
    await screen.findByRole("heading", { level: 1, name: /DIWALI10/ });
    expect(field("code")).toBeDisabled();
    expect(
      screen.getByText(/Orders were made with this code/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.clear(field("note"));
    await user.type(field("note"), "Diwali newsletter, week two");
    await user.clear(field("maxUses"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/discounts/${diwali.id}`,
      body: { note: "Diwali newsletter, week two", maxUses: null },
    });
    expect(
      (await screen.findAllByText("DIWALI10 saved")).length,
    ).toBeGreaterThan(0);
    expect(stored(diwali.id)?.maxUses).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled(),
    );
    expect(
      within(screen.getByRole("region", { name: "Facts" })).getByText(
        "Unlimited",
      ),
    ).toBeInTheDocument();
  });

  it("puts a refusal of the API, and its own checks, on the field they belong to", async () => {
    const xmas = code("XMAS20");
    const { user } = renderCode(xmas.id);
    await screen.findByRole("heading", { level: 1, name: /XMAS20/ });
    expect(field("code")).toBeEnabled();

    // The panel's checks come first and nothing is sent.
    await user.clear(field("value"));
    await user.type(field("value"), "120");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Between 1 and 100 percent."),
    ).toBeInTheDocument();
    await user.clear(field("value"));
    await user.type(field("value"), "20");
    await user.clear(field("expiresAt"));
    await user.type(field("expiresAt"), "2020-01-01T10:00");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("The end must come after the start."),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    // A code another one has: the API refuses, the field says so.
    await user.clear(field("expiresAt"));
    await user.type(field("expiresAt"), "2030-01-01T10:00");
    await user.clear(field("code"));
    await user.type(field("code"), "diwali10");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toMatchObject({ code: "DIWALI10" });
    expect(
      await screen.findByText("Another discount code has this text."),
    ).toBeInTheDocument();
    expect(stored(xmas.id)?.code).toBe("XMAS20");
  });

  it("deletes an unused code after a confirmation, and offers Switch off for a used one", async () => {
    const xmas = code("XMAS20");
    const { user } = renderCode(xmas.id);
    await screen.findByRole("heading", { level: 1, name: /XMAS20/ });
    expect(
      screen.queryByRole("button", { name: "Switch off" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    await user.click(dialog.getByRole("button", { name: "Delete the code" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "DELETE",
      path: `/v1/admin/discounts/${xmas.id}`,
      body: undefined,
    });
    expect(stored(xmas.id)).toBeUndefined();
    expect(
      (await screen.findAllByText("XMAS20 deleted")).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(testNavigation.location).toBe("/catalogue/discounts"),
    );
  });

  it("switches a used code off instead of deleting it, and says that it stays for the order history", async () => {
    const diwali = code("DIWALI10");
    const { user } = renderCode(diwali.id);
    await screen.findByRole("heading", { level: 1, name: /DIWALI10/ });
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch off" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText(/stays for the order history/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Switch off" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/discounts/${diwali.id}`,
      body: { isActive: false },
    });
    expect(stored(diwali.id)?.isActive).toBe(false);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1 }).parentElement,
      ).toHaveTextContent("Inactive"),
    );
  });

  it("shows everything to a reader and lets them change nothing", async () => {
    const diwali = code("DIWALI10");
    renderCode(diwali.id, READ_ONLY);
    await screen.findByRole("heading", { level: 1, name: /DIWALI10/ });
    expect(field("note")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch off" })).toBeDisabled();
    await screen.findByRole("table", { name: "Uses of DIWALI10" });
    expect(writes()).toHaveLength(0);
  });
});

describe("a new discount code", () => {
  it("creates a code with the typed text, upper-cased, and opens its page", async () => {
    const { user } = renderPanel(<DiscountNewView />, {
      path: "/catalogue/discounts/new",
    });
    await user.type(field("code"), "summer-5");
    await user.type(field("note"), "Summer flyer");
    await user.selectOptions(field("type"), "fixed");
    await user.type(field("value"), "5");
    await user.type(field("minOrderValue"), "25");
    await user.type(field("maxUses"), "50");
    await user.click(
      screen.getByRole("switch", { name: "Any number of times per customer" }),
    );
    await user.click(screen.getByRole("button", { name: "Create the code" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/discounts",
      body: {
        code: "SUMMER-5",
        note: "Summer flyer",
        type: "fixed",
        value: 500,
        appliesToSaleItems: true,
        minOrderValue: 2500,
        maxUses: 50,
        oncePerCustomer: true,
        isActive: true,
      },
    });
    const created = api.mock
      .db()
      .discountCodes.find((entry) => entry.code === "SUMMER-5");
    expect(created).toBeDefined();
    await waitFor(() =>
      expect(testNavigation.location).toBe(
        `/catalogue/discounts/${created?.id}`,
      ),
    );
  });

  it("lets the API generate the code when asked", async () => {
    const { user } = renderPanel(<DiscountNewView />, {
      path: "/catalogue/discounts/new",
    });
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(field("code")).toBeDisabled();
    expect(
      screen.getByText(/The API makes a code of 8 characters/),
    ).toBeInTheDocument();
    await user.type(field("value"), "10");
    await user.click(screen.getByRole("button", { name: "Create the code" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({
      type: "percent",
      value: 10,
      appliesToSaleItems: true,
      oncePerCustomer: false,
      isActive: true,
    });
    const created = api.mock
      .db()
      .discountCodes.find(
        (entry) => !codes.some((known) => known.id === entry.id),
      );
    expect(created?.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it("keeps the page from an admin without discounts.manage", async () => {
    renderPanel(<DiscountNewView />, {
      path: "/catalogue/discounts/new",
      permissions: READ_ONLY,
    });
    expect(
      await screen.findByText("Your role does not open this page"),
    ).toBeInTheDocument();
  });
});
