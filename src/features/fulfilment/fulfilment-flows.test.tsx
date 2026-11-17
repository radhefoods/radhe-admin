// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FulfilmentAdjustment,
  FulfilmentAdjustmentResult,
  FulfilmentBrands,
  FulfilmentExport,
  FulfilmentReport,
  FulfilmentVariantDetail,
  PageResult,
} from "@/lib/api/types";
import { berlinDay } from "@/lib/format/dates";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { addDays } from "./fulfilment";
import { FulfilmentView } from "./fulfilment-view";

const BASE = "/v1/admin/fulfilment-tracker";

let api: TestApi;
const db = () => api.mock.db();
const writes = () => api.calls.filter((call) => call.method !== "GET");
/** The calls to the tracker, without the base: `""`, `"/brands?q=dal"`. */
const calls = () =>
  api.calls
    .filter((call) => call.method === "GET" && call.path.startsWith(BASE))
    .map((call) => decodeURIComponent(call.path.slice(BASE.length)));

/** The pack size with this article number, as the catalogue has it. */
function pack(sku: string) {
  for (const product of db().products) {
    const variant = product.variants.find((entry) => entry.sku === sku);
    if (variant) return { product, variant, variantId: variant.id };
  }
  throw new Error(`No pack size ${sku}`);
}

const report = (query = "") =>
  api.request<FulfilmentReport>("GET", `${BASE}${query}`);
const rowOfApi = async (sku: string, query = "?limit=100") => {
  const found = (await report(query)).items.find((row) => row.sku === sku);
  if (!found) throw new Error(`No row ${sku}`);
  return found;
};

/** The day a return was completed, in German time. */
function completedOn(returnNumber: string): string {
  const found = db().returns.find(
    (entry) => entry.returnNumber === returnNumber,
  );
  if (!found?.completedAt) throw new Error(`${returnNumber} is not completed`);
  return berlinDay(found.completedAt);
}

const table = () => screen.getByRole("table");
const row = (sku: string) =>
  within(table()).getByText(sku).closest("tr") as HTMLElement;
const totals = () =>
  screen.getByRole("group", { name: "Totals of the period" });
const tile = (label: string) =>
  within(totals()).getByText(label, { selector: "p" })
    .parentElement as HTMLElement;
const filters = () => screen.getByRole("search");
const dialog = () => screen.getByRole("dialog");

async function open(path = "/fulfilment", permissions?: string[]) {
  const rendered = renderPanel(<FulfilmentView />, { path, permissions });
  await waitFor(() => expect(table()).toHaveAttribute("aria-busy", "false"));
  return rendered;
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the report page", () => {
  it("shows the totals of the API and a page of pack sizes, most dispatched first", async () => {
    const all = await report();
    api.calls.length = 0;
    const { user } = await open();

    expect(
      screen.getByText("All dates", { selector: "span" }),
    ).toBeInTheDocument();
    expect(tile("Dispatched")).toHaveTextContent(String(all.totals.dispatched));
    expect(tile("Returned")).toHaveTextContent(String(all.totals.returned));
    expect(tile("Net sold")).toHaveTextContent(String(all.totals.net));
    expect(tile("Pack sizes")).toHaveTextContent(
      `${all.totals.packSizes}in ${all.totals.products} products`,
    );
    expect(calls().sort()).toEqual(["/brands", "?page=1&limit=25"]);

    // The order of the API: the first row has the most dispatched units.
    const skus = within(table())
      .getAllByRole("row")
      .slice(1)
      .map((entry) => within(entry).getAllByRole("cell")[2]?.textContent);
    expect(skus).toEqual(all.items.map((item) => item.sku));
    expect(
      within(table()).getByRole("columnheader", { name: /^Dispatched/ }),
    ).toHaveAttribute("aria-sort", "descending");

    expect(all.total).toBeGreaterThan(25);
    expect(
      screen.getByText(`1 to 25 of ${all.total} pack sizes`),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(testNavigation.location).toBe("/fulfilment?page=2");
    await waitFor(() => expect(calls()).toContain("?page=2&limit=25"));
    // The totals are those of every row, not of the page.
    await waitFor(() =>
      expect(within(table()).getAllByRole("row")).toHaveLength(
        all.total - 25 + 1,
      ),
    );
    expect(tile("Dispatched")).toHaveTextContent(String(all.totals.dispatched));
  });

  it("names a pack size in English, with the German name below when it differs, and links to the product", async () => {
    await open();
    const rice = row("RF-00005");
    const link = within(rice).getByRole("link", { name: "Sona Masoori Rice" });
    expect(link).toHaveAttribute(
      "href",
      `/catalogue/products/${pack("RF-00005").product.id}`,
    );
    expect(within(rice).getByText("Sona Masoori Reis")).toBeInTheDocument();
    expect(within(rice).getByText("10 kg")).toBeInTheDocument();
    expect(within(rice).getByText("Daawat")).toBeInTheDocument();
    // "Chakki Atta" is the same in both languages: said once.
    expect(within(row("RF-00008")).getAllByText("Chakki Atta")).toHaveLength(1);
  });

  it("marks a row that was adjusted by hand and says by how much", async () => {
    await open();
    const adjusted = row("RF-00008");
    expect(within(adjusted).getByText("adjusted")).toBeInTheDocument();
    expect(
      within(adjusted).getByText(": +2 dispatched, +1 returned by hand"),
    ).toBeInTheDocument();
    expect(within(row("RF-00005")).queryByText("adjusted")).toBeNull();
  });

  it("says when a pack size is no longer in the catalogue, without a link", async () => {
    const { product } = pack("RF-00020");
    db().products.splice(db().products.indexOf(product), 1);
    await open("/fulfilment?q=RF-00020");
    const gone = row("RF-00020");
    expect(
      within(gone).getByText("no longer in the catalogue"),
    ).toBeInTheDocument();
    expect(within(gone).queryByRole("link")).toBeNull();
    // The name is the one its orders recorded.
    expect(within(gone).getByText("Banana Chips")).toBeInTheDocument();
  });

  it("searches after a pause, from two characters, and keeps the search in the address", async () => {
    const { user } = await open();
    api.calls.length = 0;
    const search = screen.getByRole("searchbox", {
      name: "Search by product name or SKU",
    });
    await user.type(search, "d");
    expect(
      await screen.findByText("At least two characters."),
    ).toBeInTheDocument();
    await user.type(search, "al");
    await waitFor(() =>
      expect(testNavigation.location).toBe("/fulfilment?q=dal"),
    );
    await waitFor(() =>
      expect(calls().sort()).toEqual([
        "/brands?q=dal",
        "?q=dal&page=1&limit=25",
      ]),
    );
    const found = await report("?q=dal");
    await waitFor(() =>
      expect(within(table()).getAllByRole("row")).toHaveLength(found.total + 1),
    );
    expect(tile("Pack sizes")).toHaveTextContent(String(found.total));
    // One letter was never sent.
    expect(calls().some((call) => call.includes("q=d&"))).toBe(false);
  });

  it("filters by several brands, with a search inside the list and the number of pack sizes of each", async () => {
    const brands = await api.request<FulfilmentBrands>("GET", `${BASE}/brands`);
    const trs = brands.items.find((entry) => entry.brand === "TRS");
    const { user } = await open();
    api.calls.length = 0;

    await user.click(within(filters()).getByRole("button", { name: "Brand" }));
    const list = await screen.findByRole("list", { name: "Brands" });
    expect(
      within(list).getByRole("checkbox", {
        name: new RegExp(`^TRS\\s*${trs?.packSizes} pack sizes$`),
      }),
    ).toBeInTheDocument();
    // Pack sizes without a brand cannot be chosen.
    expect(within(list).getAllByRole("checkbox")).toHaveLength(
      brands.items.filter((entry) => entry.brand !== null).length,
    );

    await user.type(
      screen.getByRole("searchbox", { name: "Search the brands" }),
      "wag",
    );
    expect(within(list).getAllByRole("checkbox")).toHaveLength(1);
    await user.click(
      within(list).getByRole("checkbox", { name: /^Wagh Bakri/ }),
    );
    expect(testNavigation.location).toBe("/fulfilment?brand=Wagh+Bakri");

    await user.clear(
      screen.getByRole("searchbox", { name: "Search the brands" }),
    );
    await user.click(
      within(screen.getByRole("list", { name: "Brands" })).getByRole(
        "checkbox",
        { name: /^MDH/ },
      ),
    );
    expect(testNavigation.location).toBe(
      "/fulfilment?brand=Wagh+Bakri&brand=MDH",
    );
    await waitFor(() =>
      expect(calls()).toContain("?brand=Wagh+Bakri&brand=MDH&page=1&limit=25"),
    );
    // The list of brands is asked for without the brand filter: it stays whole.
    expect(calls().filter((call) => call.startsWith("/brands"))).toEqual([]);

    const both = await report("?brand=Wagh%20Bakri&brand=MDH");
    await waitFor(() =>
      expect(tile("Pack sizes")).toHaveTextContent(String(both.total)),
    );
    expect(
      within(filters()).getByRole("button", { name: /^Brand\s*2 chosen$/ }),
    ).toBeInTheDocument();
  });

  it("sends a preset as two days of German time and keeps the choice in the address", async () => {
    const { user } = await open();
    api.calls.length = 0;
    const today = berlinDay();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Period" }),
      "last_7_days",
    );
    expect(testNavigation.location).toBe("/fulfilment?range=last_7_days");
    const from = addDays(today, -6);
    await waitFor(() =>
      expect(calls().sort()).toEqual([
        `/brands?from=${from}&to=${today}`,
        `?from=${from}&to=${today}&page=1&limit=25`,
      ]),
    );
    expect(screen.queryByText("All dates", { selector: "span" })).toBeNull();
  });

  it("starts a custom range with the days shown, and asks for nothing while it runs backwards", async () => {
    const { user } = await open("/fulfilment?range=last_month");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Period" }),
      "custom",
    );
    const first = `${addDays(`${berlinDay().slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
    expect(screen.getByLabelText("First day")).toHaveValue(first);
    api.calls.length = 0;

    fireEvent.change(screen.getByLabelText("Last day"), {
      target: { value: addDays(first, -1) },
    });
    expect(
      (
        await screen.findAllByText(
          "The first day must not come after the last.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(calls()).toEqual([]);

    fireEvent.change(screen.getByLabelText("Last day"), {
      target: { value: first },
    });
    await waitFor(() =>
      expect(calls()).toContain(`?from=${first}&to=${first}&page=1&limit=25`),
    );
    expect(testNavigation.location).toBe(
      `/fulfilment?range=custom&from=${first}&to=${first}`,
    );
  });

  it("shows net sold below zero as it is, with the hint, when more came back than left", async () => {
    const day = completedOn("RF-1003-R1");
    const expected = await rowOfApi("RF-00005", `?from=${day}&to=${day}`);
    expect(expected).toMatchObject({ dispatched: 0, returned: 3, net: -3 });
    await open(`/fulfilment?range=custom&from=${day}&to=${day}`);
    const rice = row("RF-00005");
    expect(within(rice).getByText("-3")).toBeInTheDocument();
    expect(
      within(rice).getByText(
        ". More units came back in this period than left in it.",
      ),
    ).toBeInTheDocument();
  });

  it("sorts by a header: its natural direction first, the other on the second click", async () => {
    const { user } = await open();
    api.calls.length = 0;
    await user.click(
      within(table()).getByRole("button", { name: /^Returned/ }),
    );
    expect(testNavigation.location).toBe("/fulfilment?sort=returned%3Adesc");
    await waitFor(() =>
      expect(calls()).toContain("?sort=returned:desc&page=1&limit=25"),
    );
    await waitFor(() =>
      expect(
        within(table()).getByRole("columnheader", { name: /^Returned/ }),
      ).toHaveAttribute("aria-sort", "descending"),
    );
    expect(
      within(table()).getByRole("columnheader", { name: /^Dispatched/ }),
    ).toHaveAttribute("aria-sort", "none");

    await user.click(
      within(table()).getByRole("button", { name: /^Returned/ }),
    );
    expect(testNavigation.location).toBe("/fulfilment?sort=returned%3Aasc");

    await user.click(within(table()).getByRole("button", { name: /^Product/ }));
    expect(testNavigation.location).toBe("/fulfilment?sort=name%3Aasc");
    const sorted = await report("?sort=name:asc");
    await waitFor(() =>
      expect(
        within(within(table()).getAllByRole("row")[1] as HTMLElement).getByText(
          sorted.items[0]!.sku,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("goes back to page one when a filter changes, and clears everything at once", async () => {
    const { user } = await open("/fulfilment?page=2");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Period" }),
      "this_month",
    );
    expect(testNavigation.location).toBe("/fulfilment?range=this_month");
    await user.click(
      within(filters()).getByRole("button", { name: "Clear filters" }),
    );
    expect(testNavigation.location).toBe("/fulfilment");
  });

  it("shows one product when the address names it, as a filter that can be removed", async () => {
    const { product } = pack("RF-00008");
    const { user } = await open(`/fulfilment?productId=${product.id}`);
    expect(within(table()).getAllByRole("row")).toHaveLength(
      product.variants.length + 1,
    );
    expect(within(filters()).getByText("Product")).toBeInTheDocument();
    expect(calls()).toContain(`/brands?productId=${product.id}`);
    await user.click(
      screen.getByRole("button", { name: "Remove the filter Product" }),
    );
    expect(testNavigation.location).toBe("/fulfilment");
  });

  it("says when nothing was dispatched or returned, and offers to clear the filters", async () => {
    const { user } = renderPanel(<FulfilmentView />, {
      path: "/fulfilment?q=zzzz",
    });
    expect(
      await screen.findByText(
        "Nothing was dispatched or returned in this period.",
      ),
    ).toBeInTheDocument();
    expect(tile("Pack sizes")).toHaveTextContent("0");
    const empty = screen.getByText("Change the filters or clear them.")
      .parentElement?.parentElement as HTMLElement;
    await user.click(
      within(empty).getByRole("button", { name: "Clear filters" }),
    );
    expect(testNavigation.location).toBe("/fulfilment");
  });

  it("shows the error of the API with a way to try again", async () => {
    const role = db().roles.find((entry) => entry.key === "super_admin")!;
    role.permissions = ["catalog.read"];
    const { user } = renderPanel(<FulfilmentView />, { path: "/fulfilment" });
    expect(
      await screen.findByText("This list could not be loaded"),
    ).toBeInTheDocument();
    role.permissions = ["*"];
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(row("RF-00008")).toBeInTheDocument());
  });

  it("is closed to a role without orders.read, and hides Adjust without orders.manage", async () => {
    const closed = renderPanel(<FulfilmentView />, {
      path: "/fulfilment",
      permissions: ["catalog.read"],
    });
    expect(
      await screen.findByText("Your role does not open this page"),
    ).toBeInTheDocument();
    expect(calls()).toEqual([]);
    closed.unmount();

    await open("/fulfilment", ["orders.read"]);
    expect(
      within(row("RF-00008")).getByRole("button", { name: /^View orders/ }),
    ).toBeInTheDocument();
    expect(
      within(table()).queryByRole("button", { name: /^Adjust/ }),
    ).toBeNull();
  });
});

describe("the orders behind a row", () => {
  it("lists the orders with what each adds, the correction and the delivered quantity", async () => {
    const { variantId } = pack("RF-00016");
    const { user } = await open();
    api.calls.length = 0;
    await user.click(
      within(row("RF-00016")).getByRole("button", { name: /^View orders/ }),
    );
    const detail = await api.request<FulfilmentVariantDetail>(
      "GET",
      `${BASE}/variants/${variantId}`,
    );
    expect(
      await within(dialog()).findByText("Orders of Cumin Seeds, 200 g"),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByText(/SKU RF-00016 · MDH · All dates/),
    ).toBeInTheDocument();
    await within(dialog()).findByRole("table");
    expect(calls()).toContain(`/variants/${variantId}?page=1&limit=25`);

    const orders = within(within(dialog()).getByRole("table"));
    for (const order of detail.orders.items) {
      expect(
        orders.getByRole("link", { name: order.orderNumber }),
      ).toHaveAttribute("href", `/orders/${order.orderId}`);
    }
    expect(orders.getAllByText("dispatched")).toHaveLength(
      detail.orders.items.length,
    );
    // RF-1014: three ordered, one was missing.
    expect(orders.getByText("3 ordered, 2 delivered")).toBeInTheDocument();
    expect(orders.getByText(/corrected from 3 to 2/)).toBeInTheDocument();
    // The figures of the row, for the period of the page.
    const figures = within(dialog()).getByText("Dispatched", { selector: "p" })
      .parentElement as HTMLElement;
    expect(figures).toHaveTextContent(String(detail.row.dispatched));
    expect(detail.fromOrders.dispatched).toBe(detail.row.dispatched);
    expect(within(dialog()).queryByText(/^Orders: /)).toBeNull();
  });

  it("names every return of an order and says which ones count", async () => {
    const { user } = await open();
    await user.click(
      within(row("RF-00014")).getByRole("button", { name: /^View orders/ }),
    );
    const waiting = await within(dialog()).findByRole("list", {
      name: "Returns of RF-1017",
    });
    const asked = db().returns.find(
      (entry) => entry.returnNumber === "RF-1017-R1",
    )!;
    expect(
      within(waiting).getByRole("link", { name: "RF-1017-R1" }),
    ).toHaveAttribute("href", `/returns/${asked.id}`);
    expect(within(waiting).getByText("Requested")).toBeInTheDocument();
    expect(
      within(waiting).getByText("1 requested, not decided yet"),
    ).toBeInTheDocument();
    expect(within(waiting).getByText("does not count yet")).toBeInTheDocument();
  });

  it("loads the period of the page and marks an order that was dispatched before it", async () => {
    const day = completedOn("RF-1003-R1");
    const { variantId } = pack("RF-00005");
    const { user } = await open(
      `/fulfilment?range=custom&from=${day}&to=${day}`,
    );
    api.calls.length = 0;
    await user.click(
      within(row("RF-00005")).getByRole("button", { name: /^View orders/ }),
    );
    const orders = within(await within(dialog()).findByRole("table"));
    expect(calls()).toContain(
      `/variants/${variantId}?from=${day}&to=${day}&page=1&limit=25`,
    );
    expect(orders.getByRole("link", { name: "RF-1003" })).toBeInTheDocument();
    expect(orders.getByText("returned")).toBeInTheDocument();
    expect(
      orders.getByText("dispatched before this period"),
    ).toBeInTheDocument();
    expect(orders.queryByText("dispatched")).toBeNull();
    const returns = orders.getByRole("list", { name: "Returns of RF-1003" });
    expect(
      within(returns).getByText("3 requested, 3 accepted"),
    ).toBeInTheDocument();
    expect(within(returns).getByText("counts: 3")).toBeInTheDocument();
    expect(
      within(dialog()).getByText(
        "More units came back in this period than left in it.",
      ),
    ).toBeInTheDocument();
  });

  it("explains the sum when adjustments are part of it", async () => {
    const { user } = await open();
    await user.click(
      within(row("RF-00008")).getByRole("button", { name: /^View orders/ }),
    );
    expect(
      await within(dialog()).findByText(
        "Orders: 9 dispatched, 0 returned. Adjustments: +2 dispatched, +1 returned.",
      ),
    ).toBeInTheDocument();
    const list = within(dialog()).getByRole("list", {
      name: /^Adjustments of Chakki Atta, 10 kg/,
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(list).getByText("One pack of the market stall came back unopened"),
    ).toBeInTheDocument();
    // Nothing is edited here.
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("says that a pack size no longer exists", async () => {
    const { product, variantId } = pack("RF-00020");
    const { user } = await open("/fulfilment?q=RF-00020");
    db().products.splice(db().products.indexOf(product), 1);
    for (const order of db().orders) {
      order.items = order.items.filter((item) => item.variantId !== variantId);
    }
    await user.click(
      within(row("RF-00020")).getByRole("button", { name: /^View orders/ }),
    );
    expect(
      await within(dialog()).findByText("This pack size no longer exists."),
    ).toBeInTheDocument();
  });
});

describe("the export", () => {
  /** jsdom has no object URLs: the file is caught on its way to the browser. */
  function catchFiles() {
    const saved: { name: string; text: string }[] = [];
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        void blob.text().then((text) => saved.push({ name: "", text }));
        return "blob:test";
      },
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      const name = this.download;
      void Promise.resolve().then(() => {
        const last = saved[saved.length - 1];
        if (last) last.name = name;
      });
    });
    return saved;
  }

  const exportButton = () =>
    within(dialog()).getByRole("button", { name: "Export CSV" });

  it("offers the fourteen columns with the usual seven ticked, and says how many rows there are", async () => {
    const all = await report();
    const { user } = await open();
    api.calls.length = 0;
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    const boxes = within(dialog()).getAllByRole("checkbox");
    expect(boxes).toHaveLength(14);
    expect(
      boxes
        .filter((box) => box.getAttribute("aria-checked") === "true")
        .map((box) => box.getAttribute("aria-labelledby") ?? box.id).length,
    ).toBe(7);
    for (const label of [
      "Product name",
      "Brand",
      "SKU",
      "Pack size",
      "Dispatched",
      "Returned",
      "Net sold",
    ]) {
      expect(
        within(dialog()).getByRole("checkbox", { name: label }),
      ).toBeChecked();
    }
    expect(
      within(dialog()).getByRole("checkbox", { name: "Pack size ID" }),
    ).not.toBeChecked();
    expect(
      await within(dialog()).findByText(
        `${all.totals.packSizes} rows will be exported`,
      ),
    ).toBeInTheDocument();
    expect(calls()).toContain("?limit=1");
    expect(within(dialog()).getByText("All brands")).toBeInTheDocument();

    await user.click(
      within(dialog()).getByRole("button", { name: "Select all" }),
    );
    expect(
      within(dialog())
        .getAllByRole("checkbox")
        .every((box) => box.getAttribute("aria-checked") === "true"),
    ).toBe(true);
    await user.click(within(dialog()).getByRole("button", { name: "Reset" }));
    expect(
      within(dialog()).getByRole("checkbox", { name: "Orders" }),
    ).not.toBeChecked();
  });

  it("asks the export endpoint for the chosen columns in the order of the list and writes its rows", async () => {
    const saved = catchFiles();
    const { user } = await open("/fulfilment?sort=name%3Aasc");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    // Orders is ticked before Brand is unticked: the file keeps the order of the list.
    await user.click(
      within(dialog()).getByRole("checkbox", { name: "Orders" }),
    );
    await user.click(within(dialog()).getByRole("checkbox", { name: "Brand" }));
    await within(dialog()).findByText(/rows will be exported/);
    api.calls.length = 0;
    await user.click(exportButton());

    const query =
      "?sort=name:asc&columns=product_name,sku,pack_size,dispatched,returned,net,orders";
    await waitFor(() => expect(calls()).toContain(`/export${query}`));
    const answer = await api.request<FulfilmentExport>(
      "GET",
      `${BASE}/export${query}`,
    );
    await waitFor(() => expect(saved[0]?.name).toBe(answer.fileName));
    expect(answer.fileName).toBe("fulfilment-returns_all-dates.csv");
    const lines = saved[0]!.text.replace(/^﻿/, "").split(/\r?\n/);
    expect(lines[0]).toBe(
      "Product name,SKU,Pack size,Dispatched,Returned,Net sold,Orders",
    );
    // Every row under the filters, not the 25 of the page.
    expect(lines).toHaveLength(answer.rows.length + 1);
    expect(answer.rows.length).toBeGreaterThan(25);
    const first = answer.rows[0]!;
    expect(lines[1]).toBe(
      [
        first.product_name,
        first.sku,
        first.pack_size,
        first.dispatched,
        first.returned,
        first.net,
        first.orders,
      ].join(","),
    );
    expect(await screen.findByText("CSV exported")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("carries the filters of the page over; brands and dates can be changed in the dialog", async () => {
    const saved = catchFiles();
    const today = berlinDay();
    // Nothing leaves on the day itself in the demo: the page is empty, the file is not.
    const { user } = renderPanel(<FulfilmentView />, {
      path: "/fulfilment?q=dal&brand=Heera&range=today",
    });
    await screen.findByText(
      "Nothing was dispatched or returned in this period.",
    );
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(
      within(dialog()).getByText("Carried over from the page: Search: dal"),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByRole("button", { name: /^Brand\s*Heera$/ }),
    ).toBeInTheDocument();
    expect(within(dialog()).getByText("Only this brand")).toBeInTheDocument();
    expect(
      within(dialog()).getByRole("combobox", { name: "Period" }),
    ).toHaveValue("today");
    api.calls.length = 0;

    // The dates of the file change; the page keeps its own.
    await user.selectOptions(
      within(dialog()).getByRole("combobox", { name: "Period" }),
      "all",
    );
    const heera = await report("?q=dal&brand=Heera");
    expect(
      await within(dialog()).findByText(
        `${heera.totals.packSizes} rows will be exported`,
      ),
    ).toBeInTheDocument();
    expect(testNavigation.location).toBe(
      "/fulfilment?q=dal&brand=Heera&range=today",
    );
    await user.click(exportButton());
    await waitFor(() =>
      expect(calls()).toContain(
        "/export?q=dal&brand=Heera&columns=product_name,brand,sku,pack_size,dispatched,returned,net",
      ),
    );
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(calls().some((call) => call.includes(today))).toBe(false);
  });

  it("says so and writes no file when there are no rows", async () => {
    const saved = catchFiles();
    const { user } = renderPanel(<FulfilmentView />, {
      path: "/fulfilment?q=zzzz",
    });
    await screen.findByText(
      "Nothing was dispatched or returned in this period.",
    );
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(
      await within(dialog()).findByText("Nothing to export"),
    ).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    expect(calls().some((call) => call.startsWith("/export"))).toBe(false);
    expect(saved).toHaveLength(0);
  });

  it("needs at least one column", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    for (const box of within(dialog()).getAllByRole("checkbox")) {
      if (box.getAttribute("aria-checked") === "true") await user.click(box);
    }
    expect(
      within(dialog()).getByText("Tick at least one column."),
    ).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
  });
});

describe("adjusting by hand", () => {
  const adjustOf = async (
    user: ReturnType<typeof renderPanel>["user"],
    sku: string,
  ) => {
    await user.click(within(row(sku)).getByRole("button", { name: /^Adjust/ }));
    // The figures over all dates are loaded before anything can be saved.
    await within(dialog()).findByText("Dispatched, all dates");
  };
  const units = (name: "Dispatched" | "Returned") =>
    within(dialog()).getByLabelText(`${name}: add or remove units`);
  const save = () =>
    within(dialog()).getByRole("button", { name: "Save the adjustment" });
  const reason = () => within(dialog()).getByLabelText(/^Reason/);

  it("shows the figures over all dates, a live line, and sends the adjustment", async () => {
    const { variantId } = pack("RF-00008");
    // The page shows one day; the form still works on all dates.
    const { user } = await open("/fulfilment?q=RF-00008");
    api.calls.length = 0;
    await adjustOf(user, "RF-00008");
    expect(calls()).toContain(`?variantId=${variantId}&limit=1`);
    expect(calls()).toContain(
      `/adjustments?variantId=${variantId}&page=1&limit=25`,
    );
    expect(
      within(dialog()).getByText(
        "Dispatched 11 → 11 · Returned 1 → 1 · Net sold 10 → 10",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByText(
        "Net sold is always Dispatched minus Returned. To lower it without changing Dispatched, add returned units.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByText(
        "This changes the report only. Orders, returns and stock stay as they are.",
      ),
    ).toBeInTheDocument();
    // The history of the pack size, below the form.
    expect(
      within(
        within(dialog()).getByRole("list", {
          name: "Adjustments of Chakki Atta, 10 kg",
        }),
      ).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(save()).toBeDisabled();

    await user.click(
      within(dialog()).getByRole("button", { name: "Add one dispatched unit" }),
    );
    await user.click(
      within(dialog()).getByRole("button", { name: "Add one dispatched unit" }),
    );
    expect(units("Dispatched")).toHaveValue("2");
    await user.type(units("Returned"), "1");
    expect(
      within(dialog()).getByText(
        "Dispatched 11 → 13 · Returned 1 → 2 · Net sold 10 → 11",
      ),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
    await user.type(
      reason(),
      "Two bags sold at the market stall, one came back",
    );
    expect(within(dialog()).getByLabelText(/^Counts for/)).toHaveValue(
      berlinDay(),
    );
    await user.click(save());

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "POST",
      path: `${BASE}/adjustments`,
      body: {
        variantId,
        dispatched: 2,
        returned: 1,
        reason: "Two bags sold at the market stall, one came back",
        date: berlinDay(),
      },
    });
    expect(await screen.findByText("Adjustment saved")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The report is read again: the row shows the new figures.
    await waitFor(() =>
      expect(within(row("RF-00008")).getAllByRole("cell")[4]).toHaveTextContent(
        "13",
      ),
    );
    expect(tile("Net sold")).toHaveTextContent("11");
    expect(db().fulfilmentAdjustments).toHaveLength(3);
  });

  it("refuses before sending what the API would refuse", async () => {
    const { user } = await open();
    await adjustOf(user, "RF-00008");
    await user.type(reason(), "A count that was wrong");
    // Nothing changes yet.
    expect(save()).toBeDisabled();

    // 11 dispatched, 1 returned: eleven more returned would be more than left.
    await user.type(units("Returned"), "11");
    expect(
      within(dialog()).getByText(
        "No more units can be returned than were dispatched: that would be 12 returned of 11 dispatched.",
      ),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();

    await user.clear(units("Returned"));
    await user.type(units("Dispatched"), "-12");
    expect(
      within(dialog()).getByText(
        "Only 11 units count as dispatched: the figure cannot go below zero.",
      ),
    ).toBeInTheDocument();

    await user.clear(units("Dispatched"));
    await user.type(units("Dispatched"), "1.5");
    expect(
      within(dialog()).getByText("A whole number, such as 2 or -1."),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();

    await user.clear(units("Dispatched"));
    await user.click(
      within(dialog()).getByRole("button", {
        name: "Remove one dispatched unit",
      }),
    );
    expect(units("Dispatched")).toHaveValue("-1");
    expect(save()).toBeEnabled();

    // A day in the future, and a reason that says nothing.
    fireEvent.change(within(dialog()).getByLabelText(/^Counts for/), {
      target: { value: addDays(berlinDay(), 1) },
    });
    expect(
      within(dialog()).getByText("Not in the future: today or an earlier day."),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
    fireEvent.change(within(dialog()).getByLabelText(/^Counts for/), {
      target: { value: berlinDay() },
    });
    await user.clear(reason());
    await user.type(reason(), "oops");
    expect(
      within(dialog()).getByText("At least 5 characters."),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("shows the message of the API when the figures changed meanwhile", async () => {
    const { variantId, product } = pack("RF-00008");
    const { user, unhandled } = await open();
    await adjustOf(user, "RF-00008");
    await user.type(units("Returned"), "10");
    await user.type(reason(), "Ten packs came back from the stall");
    expect(save()).toBeEnabled();

    // Another admin takes five dispatched units off in the meantime.
    await api.request("POST", `${BASE}/adjustments`, {
      variantId,
      dispatched: -5,
      reason: "Counted twice at the stall",
    });
    api.calls.length = 0;
    await user.click(save());
    expect(
      await within(dialog()).findByText(
        "No more units can be returned than were dispatched: that would be 11 returned of 6 dispatched.",
      ),
    ).toBeInTheDocument();
    // The dialog stays open and reads the figures again.
    await waitFor(() =>
      expect(
        within(dialog()).getByText(/^Dispatched 6 → 6 · Returned 1 → 11/),
      ).toBeInTheDocument(),
    );
    expect(product.variants.length).toBeGreaterThan(0);
    expect(unhandled).toEqual([]);
  });

  it("lists every adjustment in the history and takes one back with the opposite numbers", async () => {
    const { variantId } = pack("RF-00008");
    const { user } = await open();
    api.calls.length = 0;
    await user.click(
      screen.getByRole("button", { name: "Adjustment history" }),
    );
    const list = await within(dialog()).findByRole("list", {
      name: "Adjustments, newest first",
    });
    expect(calls()).toContain("/adjustments?page=1&limit=25");
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    // Newest first: the unit that came back, then the two that were sold.
    expect(entries[0]).toHaveTextContent("+1 returned");
    expect(entries[0]).toHaveTextContent("Chakki Atta, 10 kg · RF-00008");
    expect(entries[0]).toHaveTextContent(
      "Dispatched 11 → 11 · Returned 0 → 1 · Net sold 11 → 10",
    );
    expect(entries[0]).toHaveTextContent(
      "One pack of the market stall came back unopened",
    );
    expect(entries[0]).toHaveTextContent("Vrushabh Vasoya");
    expect(entries[1]).toHaveTextContent("+2 dispatched");

    await user.click(
      within(entries[0] as HTMLElement).getByRole("button", {
        name: /^Take back/,
      }),
    );
    await within(dialog()).findByText("Dispatched, all dates");
    expect(
      within(dialog()).getByText("Adjust Chakki Atta, 10 kg"),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByLabelText("Returned: add or remove units"),
    ).toHaveValue("-1");
    expect(
      within(dialog()).getByLabelText("Dispatched: add or remove units"),
    ).toHaveValue("");
    const text = (
      within(dialog()).getByLabelText(/^Reason/) as HTMLTextAreaElement
    ).value;
    expect(text).toMatch(
      /^Takes back the adjustment of \d{1,2} \w{3} \d{4}: One pack of the market stall came back unopened$/,
    );
    expect(
      within(dialog()).getByText(
        "Dispatched 11 → 11 · Returned 1 → 0 · Net sold 10 → 11",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog()).getByRole("button", { name: "Save the adjustment" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({
      variantId,
      returned: -1,
      reason: text,
      date: berlinDay(),
    });
    // Both entries stay; a third one says what was taken back.
    await waitFor(() => expect(db().fulfilmentAdjustments).toHaveLength(3));
  });

  it("shows the history to a reader, without anything to take back", async () => {
    const { user } = await open("/fulfilment", ["orders.read"]);
    await user.click(
      screen.getByRole("button", { name: "Adjustment history" }),
    );
    const list = await within(dialog()).findByRole("list", {
      name: "Adjustments, newest first",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).queryByRole("button")).toBeNull();
  });
});

describe("the tracker endpoints of the mock", () => {
  const sumOf = (sku: string, statuses: string[]) =>
    db()
      .orders.filter((order) => statuses.includes(order.status))
      .flatMap((order) => order.items)
      .filter((item) => item.sku === sku)
      .reduce((sum, item) => sum + item.deliveredQuantity, 0);
  const counted = ["dispatched", "delivered", "returned"];

  it("counts delivered units of orders that left, and nothing of orders that wait or were cancelled", async () => {
    const all = await report("?limit=100");
    // Only ever in orders that wait or are unpaid.
    expect(all.items.find((row) => row.sku === "RF-00013")).toBeUndefined();
    // The corrected quantity counts: three ordered, two delivered.
    const cumin = await rowOfApi("RF-00016");
    expect(cumin.dispatched).toBe(sumOf("RF-00016", counted));
    expect(cumin.dispatched).toBeLessThan(
      db()
        .orders.filter((order) => counted.includes(order.status))
        .flatMap((order) => order.items)
        .filter((item) => item.sku === "RF-00016")
        .reduce((sum, item) => sum + item.quantity, 0),
    );
    // Every figure is dispatched less returned, and the totals are those of all rows.
    for (const row of all.items)
      expect(row.net).toBe(row.dispatched - row.returned);
    expect(all.totals).toMatchObject({
      packSizes: all.items.length,
      products: new Set(all.items.map((row) => row.productId)).size,
      dispatched: all.items.reduce((sum, row) => sum + row.dispatched, 0),
      returned: all.items.reduce((sum, row) => sum + row.returned, 0),
      adjusted: { dispatched: 2, returned: 1 },
    });
    expect(all.range).toEqual({
      from: null,
      to: null,
      timeZone: "Europe/Berlin",
    });
  });

  it("counts a return when it is completed, by the accepted units, and never lowers dispatched", async () => {
    const rice = await rowOfApi("RF-00005");
    expect(rice).toMatchObject({ returned: 3, returns: 1 });
    expect(rice.dispatched).toBe(sumOf("RF-00005", counted));
    // Requested and approved returns count nothing yet.
    expect(await rowOfApi("RF-00014")).toMatchObject({
      returned: 0,
      returns: 0,
    });
    expect(await rowOfApi("RF-00024")).toMatchObject({ returned: 0 });

    // By the day of completion: the order left weeks before.
    const day = completedOn("RF-1003-R1");
    expect(await rowOfApi("RF-00005", `?from=${day}&to=${day}`)).toMatchObject({
      dispatched: 0,
      returned: 3,
      net: -3,
      orders: 0,
    });
    const before = await report(`?to=${addDays(day, -1)}&limit=100`);
    expect(before.items.find((row) => row.sku === "RF-00005")).toMatchObject({
      returned: 0,
    });
    expect(before.range).toMatchObject({ from: null, to: addDays(day, -1) });

    // An order that is cancelled after all stops counting, and its return with it.
    db().orders.find((order) => order.orderNumber === "RF-1003")!.status =
      "cancelled";
    expect(await rowOfApi("RF-00005")).toMatchObject({
      dispatched: rice.dispatched - 3,
      returned: 0,
      returns: 0,
    });
  });

  it("filters by words in either language, by brands, by product and by pack size", async () => {
    const skus = async (query: string) =>
      (await report(`${query}&limit=100`)).items.map((row) => row.sku).sort();
    expect(await skus("?q=reis")).toEqual(
      expect.arrayContaining(["RF-00001", "RF-00005"]),
    );
    // Both spellings of an umlaut find "Kreuzkümmel".
    expect(await skus("?q=kreuzkummel")).toEqual(["RF-00016"]);
    expect(await skus("?q=kreuzkuemmel")).toEqual(["RF-00016"]);
    // Every word must be there: the brand and a word of the name.
    expect(await skus("?q=trs%20toor")).toEqual(["RF-00011", "RF-00012"]);
    expect(await skus("?q=RF-00008")).toEqual(["RF-00008"]);

    const heera = await skus("?brand=heera");
    expect(heera).toEqual(["RF-00014", "RF-00015"]);
    expect((await skus("?brand=Heera&brand=MDH")).length).toBe(
      heera.length + (await skus("?brand=MDH")).length,
    );

    const { product, variantId } = pack("RF-00008");
    expect(await skus(`?productId=${product.id}`)).toEqual([
      "RF-00007",
      "RF-00008",
    ]);
    expect(await skus(`?variantId=${variantId}`)).toEqual(["RF-00008"]);

    // The brands ignore the brand filter, and those without a brand come last.
    const brands = await api.request<FulfilmentBrands>(
      "GET",
      `${BASE}/brands?brand=Heera`,
    );
    expect(brands.items.length).toBeGreaterThan(2);
    expect(brands.items[brands.items.length - 1]).toMatchObject({
      brand: null,
      packSizes: 1,
    });
    const names = brands.items.slice(0, -1).map((entry) => entry.brand);
    expect(names).toEqual(
      [...names].sort((a, b) =>
        (a ?? "").localeCompare(b ?? "", "en", { sensitivity: "base" }),
      ),
    );
  });

  it("sorts as asked, largest first for numbers and A to Z for words without a direction", async () => {
    const order = async (sort: string) =>
      (await report(`?sort=${sort}&limit=100`)).items;
    const byNet = await order("net");
    expect(byNet.map((row) => row.net)).toEqual(
      [...byNet.map((row) => row.net)].sort((a, b) => b - a),
    );
    const bySku = await order("sku");
    expect(bySku.map((row) => row.sku)).toEqual(
      [...bySku.map((row) => row.sku)].sort(),
    );
    const reversed = await order("sku:desc");
    expect(reversed.map((row) => row.sku)).toEqual(
      [...bySku.map((row) => row.sku)].reverse(),
    );
  });

  it("refuses what the API refuses", async () => {
    for (const query of [
      "from=2026-02-30",
      "from=17.11.2026",
      "from=2026-11-17&to=2026-11-01",
      "sort=price",
      "sort=net:up",
      "q=d",
      "limit=101",
      "productId=abc",
    ]) {
      await expect(report(`?${query}`)).rejects.toThrow(/VALIDATION_FAILED/);
    }
    await expect(
      api.request("GET", `${BASE}/export?columns=sku,price`),
    ).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(
      api.request("GET", `${BASE}/export?columns=sku,sku`),
    ).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(
      api.request("GET", `${BASE}/variants/not-an-id`),
    ).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(
      api.request("GET", `${BASE}/variants/${"a".repeat(24)}`),
    ).rejects.toThrow(/PRODUCT_VARIANT_NOT_FOUND/);
  });

  it("answers the export with every row, the usual seven columns or the chosen ones, and a file name by the dates", async () => {
    const usual = await api.request<FulfilmentExport>("GET", `${BASE}/export`);
    const all = await report("?limit=100");
    expect(usual.columns.map((column) => column.key)).toEqual([
      "product_name",
      "brand",
      "sku",
      "pack_size",
      "dispatched",
      "returned",
      "net",
    ]);
    expect(usual.rows).toHaveLength(all.total);
    expect(usual.totals).toEqual(all.totals);
    expect(usual.rows[0]).toEqual({
      product_name: all.items[0]!.name.en,
      brand: all.items[0]!.brand,
      sku: all.items[0]!.sku,
      pack_size: all.items[0]!.packSize.label,
      dispatched: all.items[0]!.dispatched,
      returned: all.items[0]!.returned,
      net: all.items[0]!.net,
    });

    const chosen = await api.request<FulfilmentExport>(
      "GET",
      `${BASE}/export?columns=variant_id&columns=net,adjusted_dispatched&q=RF-00008`,
    );
    expect(chosen.columns).toEqual([
      { key: "variant_id", label: "Pack size ID" },
      { key: "net", label: "Net sold" },
      { key: "adjusted_dispatched", label: "Adjustment: dispatched" },
    ]);
    expect(chosen.rows).toEqual([
      {
        variant_id: pack("RF-00008").variantId,
        net: 10,
        adjusted_dispatched: 2,
      },
    ]);

    const name = async (query: string) =>
      (await api.request<FulfilmentExport>("GET", `${BASE}/export${query}`))
        .fileName;
    expect(await name("")).toBe("fulfilment-returns_all-dates.csv");
    expect(await name("?from=2026-11-01&to=2026-11-17")).toBe(
      "fulfilment-returns_2026-11-01_to_2026-11-17.csv",
    );
    expect(await name("?from=2026-11-17&to=2026-11-17")).toBe(
      "fulfilment-returns_2026-11-17.csv",
    );
    expect(await name("?from=2026-11-01")).toBe(
      "fulfilment-returns_from_2026-11-01.csv",
    );
    expect(await name("?to=2026-11-17")).toBe(
      "fulfilment-returns_until_2026-11-17.csv",
    );
  });

  it("lists the orders of a pack size: what they add up to, and the rest as adjustments", async () => {
    const { variantId } = pack("RF-00008");
    const detail = await api.request<FulfilmentVariantDetail>(
      "GET",
      `${BASE}/variants/${variantId}`,
    );
    expect(detail.row).toMatchObject({ dispatched: 11, returned: 1, net: 10 });
    expect(detail.fromOrders).toEqual({ dispatched: 9, returned: 0 });
    expect(detail.orders.items.map((order) => order.dispatched)).toEqual([
      3, 3, 3,
    ]);
    // Newest dispatch first.
    const moments = detail.orders.items.map((order) =>
      Date.parse(order.delivery.dispatchedAt!),
    );
    expect(moments).toEqual([...moments].sort((a, b) => b - a));
    expect(detail.adjustments.map((entry) => entry.returned)).toEqual([1, 0]);

    // Only the adjustments of the period, and a row of zeros when nothing happened.
    const day = detail.adjustments[0]!.date;
    const oneDay = await api.request<FulfilmentVariantDetail>(
      "GET",
      `${BASE}/variants/${variantId}?from=${day}&to=${day}`,
    );
    expect(oneDay.adjustments).toHaveLength(1);
    expect(oneDay.row).toMatchObject({ dispatched: 0, returned: 1, net: -1 });
    expect(oneDay.orders.total).toBe(0);
    const never = await api.request<FulfilmentVariantDetail>(
      "GET",
      `${BASE}/variants/${pack("RF-00013").variantId}`,
    );
    expect(never.row).toMatchObject({
      sku: "RF-00013",
      dispatched: 0,
      returned: 0,
      net: 0,
      inCatalogue: true,
    });
  });

  it("keeps an adjustment with the figures before and after, and refuses one that cannot be true", async () => {
    const { variantId } = pack("RF-00016");
    const before = await rowOfApi("RF-00016");
    const stock = pack("RF-00016").variant.stock.quantity;
    const result = await api.request<FulfilmentAdjustmentResult>(
      "POST",
      `${BASE}/adjustments`,
      {
        variantId,
        dispatched: 2,
        returned: 1,
        reason: "  Sold at the stall  ",
      },
    );
    expect(result.adjustment).toMatchObject({
      variantId,
      sku: "RF-00016",
      date: berlinDay(),
      dispatched: 2,
      returned: 1,
      net: 1,
      reason: "Sold at the stall",
      before: {
        dispatched: before.dispatched,
        returned: 0,
        net: before.dispatched,
      },
      after: {
        dispatched: before.dispatched + 2,
        returned: 1,
        net: before.dispatched + 1,
      },
      admin: { name: "Vrushabh Vasoya" },
    });
    expect(result.totals).toEqual(result.adjustment.after);
    expect(await rowOfApi("RF-00016")).toMatchObject({
      dispatched: before.dispatched + 2,
      returned: 1,
      adjusted: { dispatched: 2, returned: 1 },
    });
    // The report only: the stock stays as it is.
    expect(pack("RF-00016").variant.stock.quantity).toBe(stock);

    const refused = async (body: Record<string, unknown>, code: RegExp) =>
      expect(
        api.request("POST", `${BASE}/adjustments`, {
          variantId,
          reason: "A count that was wrong",
          ...body,
        }),
      ).rejects.toThrow(code);
    await refused({}, /FULFILMENT_ADJUSTMENT_INVALID.*at least one/);
    await refused(
      { dispatched: -(before.dispatched + 3) },
      /FULFILMENT_ADJUSTMENT_INVALID.*below zero/,
    );
    await refused({ returned: -2 }, /FULFILMENT_ADJUSTMENT_INVALID/);
    await refused(
      { returned: before.dispatched + 2 },
      new RegExp(
        `FULFILMENT_ADJUSTMENT_INVALID.*"current":\\{"dispatched":${before.dispatched + 2},"returned":1,"net":${before.dispatched + 1}\\}`,
      ),
    );
    await refused({ dispatched: 1.5 }, /VALIDATION_FAILED/);
    await refused({ dispatched: 1, reason: "oops" }, /VALIDATION_FAILED/);
    await refused(
      { dispatched: 1, date: addDays(berlinDay(), 1) },
      /VALIDATION_FAILED/,
    );
    await refused({ dispatched: 1, net: 1 }, /VALIDATION_FAILED/);
    await refused(
      { dispatched: 1, variantId: "a".repeat(24) },
      /PRODUCT_VARIANT_NOT_FOUND/,
    );

    // An earlier day counts for that day.
    const day = addDays(berlinDay(), -3);
    await api.request("POST", `${BASE}/adjustments`, {
      variantId,
      dispatched: 1,
      reason: "Found on the delivery note",
      date: day,
    });
    expect(
      (await rowOfApi("RF-00016", `?from=${day}&to=${day}`)).adjusted,
    ).toEqual({ dispatched: 1, returned: 0 });

    const history = await api.request<PageResult<FulfilmentAdjustment>>(
      "GET",
      `${BASE}/adjustments?variantId=${variantId}`,
    );
    expect(history.items.map((entry) => entry.reason)).toEqual([
      "Found on the delivery note",
      "Sold at the stall",
    ]);
    const everything = await api.request<PageResult<FulfilmentAdjustment>>(
      "GET",
      `${BASE}/adjustments?limit=2`,
    );
    expect(everything).toMatchObject({ total: 4, totalPages: 2, limit: 2 });
  });

  it("reads with orders.read and adjusts with orders.manage only", async () => {
    await api.signIn("viewer");
    await expect(report()).resolves.toBeTruthy();
    await expect(
      api.request("GET", `${BASE}/adjustments`),
    ).resolves.toBeTruthy();
    await expect(
      api.request("POST", `${BASE}/adjustments`, {
        variantId: pack("RF-00008").variantId,
        dispatched: 1,
        reason: "A count that was wrong",
      }),
    ).rejects.toThrow(/ADMIN_PERMISSION_DENIED/);
    await api.signIn("orders");
    await expect(
      api.request("POST", `${BASE}/adjustments`, {
        variantId: pack("RF-00008").variantId,
        dispatched: 1,
        reason: "A count that was wrong",
      }),
    ).resolves.toBeTruthy();
  });
});
