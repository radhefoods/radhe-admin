// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductRecord } from "../../../mocks/db.ts";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { ProductView } from "./product-view";
import { ProductsView } from "./products-view";

let api: TestApi;

vi.setConfig({ testTimeout: 30_000 });

function find(
  predicate: (product: ProductRecord) => boolean,
  what: string,
): ProductRecord {
  const product = api.mock.db().products.find(predicate);
  if (!product) throw new Error(`The demo data has no ${what}`);
  return product;
}
const fresh = (id: string) => find((product) => product.id === id, "product");
/** An active product with a comfortable count and no threshold. */
const plenty = (product: ProductRecord) =>
  product.status === "active" &&
  product.stock.quantity >= 20 &&
  product.stock.lowStockThreshold === null;

const writes = () => api.calls.filter((call) => call.method !== "GET");

/** A field of a form by the name the form gives it. */
function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

async function open(product: ProductRecord, permissions?: string[]) {
  const view = renderPanel(<ProductView />, {
    path: `/catalogue/products/${product.id}`,
    params: { id: product.id },
    permissions,
  });
  await screen.findByRole("region", { name: "Stock" });
  api.calls.length = 0;
  return view;
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the stock panel (documentation, 8)", () => {
  it("shows the count and the history, and sets the counted number", async () => {
    const product = find(plenty, "product with plenty of stock");
    const before = product.stock.quantity;
    const { user } = await open(product);
    const panel = screen.getByRole("region", { name: "Stock" });
    expect(within(panel).getByText(String(before))).toBeInTheDocument();
    expect(within(panel).getByText("None: never warned")).toBeInTheDocument();
    // The opening stock is the oldest line of the history.
    const history = await within(panel).findByRole("list", {
      name: "Stock history",
    });
    expect(history).toHaveTextContent("Units added");

    await user.click(
      within(panel).getByRole("button", { name: "Change the stock" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("radio", { name: "Set the counted number" }),
    ).toBeChecked();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Counted number" }),
      "30",
    );
    expect(
      within(dialog).getByText("In stock afterwards").nextSibling,
    ).toHaveTextContent("30 units");
    expect(writes()).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: "Set the stock to 30" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/products/${product.id}/stock`,
          body: { quantity: 30 },
        },
      ]),
    );
    expect(fresh(product.id).stock.quantity).toBe(30);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    // The new line of the ledger, newest first.
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("list", { name: "Stock history" }),
        ).getAllByRole("listitem")[0],
      ).toHaveTextContent("Count corrected"),
    );
  });

  it("adds units with a note, as `delta`", async () => {
    const product = find(plenty, "product with plenty of stock");
    const before = product.stock.quantity;
    const { user } = await open(product);
    await user.click(screen.getByRole("button", { name: "Change the stock" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("radio", { name: "Add or remove units" }),
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Units in or out" }),
      "+12",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /Note for the history/ }),
      "Delivery from the importer",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add 12 units" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/products/${product.id}/stock`,
          body: { delta: 12, note: "Delivery from the importer" },
        },
      ]),
    );
    expect(fresh(product.id).stock.quantity).toBe(before + 12);
    const movement = api.mock
      .db()
      .stockMovements.filter((entry) => entry.productId === product.id)
      .at(-1);
    expect(movement?.reason).toBe("restock");
    expect(movement?.note).toBe("Delivery from the importer");
  });

  it("refuses to remove more than there is before asking the API", async () => {
    const product = find(plenty, "product with plenty of stock");
    const { user } = await open(product);
    await user.click(screen.getByRole("button", { name: "Change the stock" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("radio", { name: "Add or remove units" }),
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Units in or out" }),
      "-9999",
    );
    expect(
      within(dialog).getByText(
        `Only ${product.stock.quantity} units are in stock; 9999 cannot be removed.`,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save the stock" }),
    ).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("keeps the change visible but disabled for a read-only role", async () => {
    const product = find(plenty, "product with plenty of stock");
    await open(product, ["catalog.read"]);
    const panel = screen.getByRole("region", { name: "Stock" });
    expect(
      within(panel).getByRole("button", { name: "Change the stock" }),
    ).toBeDisabled();
    expect(
      within(panel).getByLabelText(
        'Your role does not include "Catalogue: manage".',
      ),
    ).toBeInTheDocument();
  });
});

describe("the threshold in the form", () => {
  it("saves the threshold, and sends null when it is emptied", async () => {
    const product = find(
      (entry) =>
        entry.status === "active" && entry.stock.lowStockThreshold !== null,
      "product with a threshold",
    );
    const { user } = await open(product);
    const threshold = field("lowStockThreshold");
    expect(threshold).toHaveValue(String(product.stock.lowStockThreshold));
    await user.clear(threshold);
    await user.type(threshold, "25");
    await user.click(screen.getByText("Save changes", { selector: "button" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${product.id}`,
          body: { lowStockThreshold: 25 },
        },
      ]),
    );
    expect(fresh(product.id).stock.lowStockThreshold).toBe(25);

    api.calls.length = 0;
    await user.clear(field("lowStockThreshold"));
    await user.click(screen.getByText("Save changes", { selector: "button" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${product.id}`,
          body: { lowStockThreshold: null },
        },
      ]),
    );
    expect(fresh(product.id).stock.lowStockThreshold).toBeNull();
  });
});

describe("the product list", () => {
  it("shows the count with the low state and filters the products running low", async () => {
    const low = api.mock
      .db()
      .products.filter(
        (entry) =>
          entry.stock.lowStockThreshold !== null &&
          entry.stock.quantity <= entry.stock.lowStockThreshold,
      );
    expect(low.length).toBeGreaterThan(0);
    renderPanel(<ProductsView />, {
      path: "/catalogue/products?lowStock=true",
    });
    const table = await screen.findByRole("table");
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/products?lowStock=true&page=1&limit=25",
      ),
    );
    for (const product of low) {
      // The article number names the row: two pack sizes share a name.
      const row = (await within(table).findByText(product.sku)).closest("tr");
      expect(row).toHaveTextContent(String(product.stock.quantity));
      expect(row).toHaveTextContent(
        product.stock.quantity === 0 ? "Sold out" : "Low stock",
      );
    }
    // The filter shows as chosen, so it can be taken off again.
    expect(screen.getByRole("button", { name: /^Stock/ })).toHaveTextContent(
      "Running low",
    );
  });
});
