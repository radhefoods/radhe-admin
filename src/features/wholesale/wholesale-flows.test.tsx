// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ListResult,
  PageResult,
  ProductSummary,
  WholesaleCategory,
  WholesaleProductSummary,
} from "@/lib/api/types";
import { ImportExportDialog } from "@/features/catalogue/import-export-dialog";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { CategoriesView } from "./categories-view";
import { CategoryNewView, CategoryView } from "./category-view";
import { ProductNewView } from "./product-new-view";
import { ProductView } from "./product-view";
import { ProductsView } from "./products-view";
import { WHOLESALE_SHEETS } from "./sheets";

let api: TestApi;
let products: WholesaleProductSummary[];
let categories: WholesaleCategory[];

// The page of a product is a long form with its panels: a query by role
// walks all of it, and a test makes many.
vi.setConfig({ testTimeout: 30_000 });

const READ_ONLY = ["wholesale.read", "catalog.read"];

/** The requests that change something. */
const writes = () => api.calls.filter((call) => call.method !== "GET");

function product(name: string): WholesaleProductSummary {
  const found = products.find((entry) => entry.name.en === name);
  if (!found)
    throw new Error(`No wholesale product "${name}" in the demo data`);
  return found;
}

function category(name: string): WholesaleCategory {
  const found = categories.find((entry) => entry.name.en === name);
  if (!found)
    throw new Error(`No wholesale category "${name}" in the demo data`);
  return found;
}

const record = (id: string) => {
  const found = api.mock
    .db()
    .wholesaleProducts.find((entry) => entry.id === id);
  if (!found) throw new Error(`No wholesale product ${id} in the mock`);
  return found;
};

/** A field of a form by the name the form gives it (`name.en`, `skus.0.sku`). */
function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

/** The save button of the product form, found by its words. */
const saveButton = () =>
  screen.getByText("Save changes", { selector: "button" });

function renderProduct(id: string, permissions?: string[]) {
  return renderPanel(<ProductView />, {
    path: `/wholesale/products/${id}`,
    params: { id },
    permissions,
  });
}

async function openMenu(
  user: ReturnType<typeof renderPanel>["user"],
  name: string,
  entry: string,
) {
  await user.click(
    await screen.findByRole("button", { name: `Actions for ${name}` }),
  );
  await user.click(await screen.findByRole("menuitem", { name: entry }));
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  products = (
    await api.request<PageResult<WholesaleProductSummary>>(
      "GET",
      "/v1/admin/wholesale/products?limit=100&sort=name",
    )
  ).items;
  categories = (
    await api.request<ListResult<WholesaleCategory>>(
      "GET",
      "/v1/admin/wholesale/categories",
    )
  ).items;
  api.calls.length = 0;
});

describe("the wholesale categories", () => {
  it("lists them in display order with their counts, and moves one with the whole list", async () => {
    const { user } = renderPanel(<CategoriesView />, {
      path: "/wholesale/categories",
    });
    const list = await screen.findByRole("list", {
      name: "Wholesale categories in display order",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(categories.length);
    expect(rows[0]).toHaveTextContent("Rice");
    expect(rows[0]).toHaveTextContent("3 products");
    expect(rows[rows.length - 1]).toHaveTextContent("Coming soon");
    expect(rows[rows.length - 1]).toHaveTextContent("Hidden");

    await openMenu(user, "Rice", "Move down");
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/v1/admin/wholesale/categories/order",
      body: {
        orderedIds: [
          categories[1]!.id,
          categories[0]!.id,
          ...categories.slice(2).map((c) => c.id),
        ],
      },
    });
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent(
        "Rice",
      ),
    );
    expect(
      api.mock.db().wholesaleCategories.find((c) => c.name.en === "Rice")
        ?.sortOrder,
    ).toBe(1);
  });

  it("hides a category only after saying what it means, and deletes only an empty one", async () => {
    const rice = category("Rice");
    const { user } = renderPanel(<CategoriesView />, {
      path: "/wholesale/categories",
    });
    await user.click(
      await screen.findByRole("switch", {
        name: "Rice is visible on the wholesale site",
      }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Hide Rice from the wholesale site?");
    expect(confirm).toHaveTextContent("3");
    await user.click(
      within(confirm).getByRole("button", { name: "Hide the category" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/wholesale/categories/${rice.id}`,
          body: { isVisible: false },
        },
      ]),
    );

    await openMenu(user, "Rice", "Delete");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Rice cannot be deleted yet");
    expect(dialog).toHaveTextContent("still holds 3 products");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    api.calls.length = 0;

    const empty = category("Coming soon");
    await openMenu(user, "Coming soon", "Delete");
    const remove = await screen.findByRole("alertdialog");
    await user.click(
      within(remove).getByRole("button", { name: "Delete the category" }),
    );
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        `DELETE /v1/admin/wholesale/categories/${empty.id}`,
      ]),
    );
    expect(
      api.mock.db().wholesaleCategories.some((c) => c.id === empty.id),
    ).toBe(false);
  });

  it("saves the changed fields of a category on its page, and its products in a typed order", async () => {
    const rice = category("Rice");
    const { user } = renderPanel(<CategoryView />, {
      path: `/wholesale/categories/${rice.id}`,
      params: { id: rice.id },
    });
    await screen.findByRole("heading", { name: "Rice" });
    expect(field("name.en")).toHaveValue("Rice");
    await user.clear(field("description.en"));
    await user.type(field("description.en"), "Rice by the sack.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/wholesale/categories/${rice.id}`,
          body: { description: { en: "Rice by the sack.", de: null } },
        },
      ]),
    );
    expect(await screen.findByText("Rice saved")).toBeInTheDocument();
    api.calls.length = 0;

    const list = await screen.findByRole("list", {
      name: "Products of Rice in display order",
    });
    const names = () =>
      within(list)
        .getAllByRole("listitem")
        .map((row) => within(row).getByRole("link").textContent);
    expect(names()).toEqual([
      "Daawat Basmati Rice",
      "Sona Masoori Rice",
      "Idli Rice",
    ]);
    const position = screen.getByRole("textbox", {
      name: "Position of Idli Rice",
    });
    await user.clear(position);
    await user.type(position, "1{Enter}");
    expect(names()[0]).toBe("Idli Rice");
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const idli = product("Idli Rice");
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: `/v1/admin/wholesale/categories/${rice.id}/products/order`,
      body: {
        orderedIds: [
          idli.id,
          product("Daawat Basmati Rice").id,
          product("Sona Masoori Rice").id,
        ],
      },
    });
    expect(record(idli.id).sortOrder).toBe(0);
  });

  it("creates a category and opens its page", async () => {
    const { user } = renderPanel(<CategoryNewView />, {
      path: "/wholesale/categories/new",
    });
    await screen.findByRole("heading", { name: "New wholesale category" });
    await user.type(field("name.en"), "Oils");
    await user.click(screen.getByRole("button", { name: "Create category" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: "/v1/admin/wholesale/categories",
          body: { name: { en: "Oils", de: null }, isVisible: true },
        },
      ]),
    );
    const created = api.mock
      .db()
      .wholesaleCategories.find((c) => c.name.en === "Oils")!;
    expect(created.slug).toEqual({ en: "oils", de: "oils" });
    await waitFor(() =>
      expect(testNavigation.history.at(-1)).toBe(
        `/wholesale/categories/${created.id}`,
      ),
    );
  });
});

describe("the wholesale products", () => {
  it("lists them with their cartons and the shortage, and filters through the API", async () => {
    const { user } = renderPanel(<ProductsView />, {
      path: "/wholesale/products",
    });
    const table = await screen.findByRole("table", {
      name: "Wholesale products",
    });
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(
        products.length + 1,
      ),
    );
    const row = (name: string) =>
      within(table).getByRole("link", { name }).closest("tr")!;
    expect(row("Daawat Basmati Rice")).toHaveTextContent(
      "20 × 1 kg, 4 × 5 kg, 1 × 20 kg",
    );
    expect(row("Sona Masoori Rice")).toHaveTextContent("1 SKU short");
    expect(row("Idli Rice")).toHaveTextContent("Draft");

    await user.click(screen.getByRole("button", { name: /^Status/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Draft" }));
    expect(testNavigation.location).toBe("/wholesale/products?status=draft");
    await waitFor(() =>
      expect(within(table).getAllByRole("row")).toHaveLength(2),
    );
    expect(
      api.calls.some((call) =>
        call.path.startsWith("/v1/admin/wholesale/products?status=draft"),
      ),
    ).toBe(true);
  });

  it("switches a product unavailable at once and tells the API", async () => {
    const toor = product("Toor Dal");
    const { user } = renderPanel(<ProductsView />, {
      path: "/wholesale/products",
    });
    const table = await screen.findByRole("table", {
      name: "Wholesale products",
    });
    const toggle = await within(table).findByRole("switch", {
      name: "Toor Dal is available",
    });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/wholesale/products/${toor.id}`,
          body: { isAvailable: false },
        },
      ]),
    );
    expect(record(toor.id).isAvailable).toBe(false);
  });

  it("shows a product with its SKUs and saves a changed carton to the SKU's own endpoint", async () => {
    const daawat = product("Daawat Basmati Rice");
    const { user } = renderProduct(daawat.id);
    await screen.findByRole("heading", { name: "Daawat Basmati Rice" });
    const rows = within(
      screen.getByRole("list", { name: "SKUs" }),
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "20 × 1 kg",
      "4 × 5 kg",
      "1 × 20 kg",
    ]);
    expect(rows[0]).toHaveTextContent("a carton is 20 × 1 kg, 20 kg");
    expect(rows[0]).toHaveTextContent("37 cartons on hand");
    expect(saveButton()).toBeDisabled();

    await user.clear(field("skus.0.unitsPerCarton"));
    await user.type(field("skus.0.unitsPerCarton"), "24");
    await user.click(saveButton());
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/wholesale/products/${daawat.id}/skus/${daawat.skus[0]!.id}`,
          body: { unitsPerCarton: 24 },
        },
      ]),
    );
    expect(
      await screen.findByText("Daawat Basmati Rice saved"),
    ).toBeInTheDocument();
    expect(
      record(daawat.id).skus.find((s) => s.id === daawat.skus[0]!.id)
        ?.unitsPerCarton,
    ).toBe(24);
    await waitFor(() =>
      expect(
        screen.getByRole("listitem", { name: "24 × 1 kg" }),
      ).toHaveTextContent("a carton is 24 × 1 kg, 24 kg"),
    );
  });

  it("adds a SKU with its opening stock through its own request, and refuses a mixed unit family first", async () => {
    const toor = product("Toor Dal");
    const { user } = renderProduct(toor.id);
    await screen.findByRole("heading", { name: "Toor Dal" });
    await user.click(screen.getByRole("button", { name: "Add a SKU" }));
    const index = toor.skus.length;
    await user.type(field(`skus.${index}.packSize.value`), "10");
    await user.selectOptions(field(`skus.${index}.packSize.unit`), "l");
    await user.type(field(`skus.${index}.unitsPerCarton`), "2");
    await user.click(saveButton());
    expect(
      await screen.findByText(/All SKUs of a product are of one unit family/),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);

    await user.selectOptions(field(`skus.${index}.packSize.unit`), "kg");
    await user.clear(field(`skus.${index}.stock`));
    await user.type(field(`skus.${index}.stock`), "5");
    await user.click(saveButton());
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/wholesale/products/${toor.id}/skus`,
          body: {
            packSize: { value: 10, unit: "kg" },
            unitsPerCarton: 2,
            stock: 5,
          },
        },
      ]),
    );
    const added = record(toor.id).skus.find((s) => s.packSize.value === 10)!;
    expect(added.stock).toBe(5);
    expect(added.sku).toMatch(/^RFW-\d{5}$/);
    expect(
      api.mock.db().wholesaleStockMovements.find((m) => m.skuId === added.id),
    ).toMatchObject({ reason: "adjustment", delta: 5, note: "Opening stock" });
  });

  it("shows an article number another product has at its row, and a SKU set the API refuses at the table", async () => {
    const toor = product("Toor Dal");
    const moong = product("Moong Dal");
    const { user } = renderProduct(toor.id);
    await screen.findByRole("heading", { name: "Toor Dal" });
    await user.clear(field("skus.0.sku"));
    await user.type(field("skus.0.sku"), moong.skus[0]!.sku);
    await user.click(saveButton());
    expect(
      await screen.findByText(
        "Another wholesale product has this article number.",
      ),
    ).toBeInTheDocument();
    expect(field("skus.0.sku")).toHaveAttribute("aria-invalid", "true");
    expect(writes().map((call) => call.method)).toEqual(["PATCH"]);
    api.calls.length = 0;

    // The API is the last word on the set: a second SKU with the same pack
    // and carton as another appeared in the meantime, so no change goes
    // through until that is sorted out.
    const stored = record(toor.id);
    stored.skus.push({
      ...stored.skus[1]!,
      id: "671200000000000000000099",
      sku: "RFW-DOUBLE",
    });
    await user.clear(field("skus.0.sku"));
    await user.type(field("skus.0.sku"), toor.skus[0]!.sku);
    await user.clear(field("skus.0.unitsPerCarton"));
    await user.type(field("skus.0.unitsPerCarton"), "12");
    await user.click(saveButton());
    expect(
      await screen.findByText("The SKUs do not fit together"),
    ).toBeInTheDocument();
    expect(writes().map((call) => call.method)).toEqual(["PATCH"]);
  });

  it("sets the stock through the ledger: an exact count, or cartons in and out, below zero allowed", async () => {
    const daawat = product("Daawat Basmati Rice");
    const first = daawat.skus[0]!;
    const { user } = renderProduct(daawat.id);
    await screen.findByRole("heading", { name: "Daawat Basmati Rice" });
    await user.click(
      screen.getByRole("button", { name: "Set the stock of 20 × 1 kg" }),
    );
    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("37 cartons");
    await user.type(within(dialog).getByLabelText("Cartons on hand"), "35");
    expect(dialog).toHaveTextContent("−2 cartons");
    await user.type(
      within(dialog).getByLabelText(/^Note/),
      "Counted on Monday",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Set the stock to 35" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: `/v1/admin/wholesale/products/${daawat.id}/skus/${first.id}/stock`,
          body: { quantity: 35, note: "Counted on Monday" },
        },
      ]),
    );
    expect(
      await screen.findByText(`Stock of ${first.sku} is now 35`),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("listitem", { name: "20 × 1 kg" }),
      ).toHaveTextContent("35 cartons on hand"),
    );
    api.calls.length = 0;

    await user.click(
      screen.getByRole("button", { name: "Set the stock of 20 × 1 kg" }),
    );
    dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("radio", { name: "Add or remove" }),
    );
    await user.type(within(dialog).getByLabelText("Cartons in or out"), "-50");
    expect(dialog).toHaveTextContent("-15 cartons");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove 50 cartons" }),
    );
    await waitFor(() => expect(writes()[0]?.body).toEqual({ delta: -50 }));
    await waitFor(() =>
      expect(
        screen.getByRole("listitem", { name: "20 × 1 kg" }),
      ).toHaveTextContent("Short"),
    );
    expect(record(daawat.id).skus.find((s) => s.id === first.id)?.stock).toBe(
      -15,
    );
    const history = screen.getByRole("table", {
      name: "Stock history of Daawat Basmati Rice",
    });
    await waitFor(() => expect(history).toHaveTextContent("Counted on Monday"));
    expect(history).toHaveTextContent("37 → 35");
  });

  it("links an entry of the stock history to the quotation that was accepted", async () => {
    const sona = product("Sona Masoori Rice");
    renderProduct(sona.id);
    const history = await screen.findByRole("table", {
      name: "Stock history of Sona Masoori Rice",
    });
    const link = await within(history).findByRole("link", {
      name: /^Q-\d{4}-0001$/,
    });
    const quotation = api.mock
      .db()
      .quotations.find((q) => q.number === link.textContent)!;
    expect(link).toHaveAttribute("href", `/quotations/${quotation.id}`);
    expect(link.closest("tr")).toHaveTextContent("0 → -2");
    expect(link.closest("tr")).toHaveTextContent("−2");
  });

  it("creates a product with its SKUs in one request and opens its page", async () => {
    const pulses = category("Pulses");
    const { user } = renderPanel(<ProductNewView />, {
      path: "/wholesale/products/new",
    });
    await screen.findByRole("heading", { name: "New wholesale product" });
    await user.type(field("name.en"), "Urad Dal");
    await user.selectOptions(field("categoryId"), pulses.id);
    await user.type(field("vatRate"), "7");
    await user.type(field("skus.0.packSize.value"), "5");
    await user.clear(field("skus.0.unitsPerCarton"));
    await user.type(field("skus.0.unitsPerCarton"), "4");
    await user.clear(field("skus.0.stock"));
    await user.type(field("skus.0.stock"), "10");
    await user.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/wholesale/products",
      body: {
        name: { en: "Urad Dal", de: null },
        categoryId: pulses.id,
        skus: [
          { packSize: { value: 5, unit: "kg" }, unitsPerCarton: 4, stock: 10 },
        ],
        vatRate: 700,
        status: "draft",
        isAvailable: true,
        storageType: "ambient",
      },
    });
    const created = api.mock
      .db()
      .wholesaleProducts.find((p) => p.name.en === "Urad Dal")!;
    expect(created.skus[0]?.stock).toBe(10);
    await waitFor(() =>
      expect(testNavigation.history.at(-1)).toBe(
        `/wholesale/products/${created.id}`,
      ),
    );
  });

  it("copies a retail product with the cartons chosen, as a draft, and opens the copy", async () => {
    const retail = (
      await api.request<PageResult<ProductSummary>>(
        "GET",
        "/v1/admin/products?q=basmati&limit=5",
      )
    ).items.find((entry) => entry.name.en === "Basmati Rice")!;
    const rice = category("Rice");
    api.calls.length = 0;
    const { user } = renderPanel(<ProductsView />, {
      path: "/wholesale/products",
    });
    await user.click(
      await screen.findByRole("button", { name: "Copy from retail" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Retail product"), "basmati");
    const found = await within(dialog).findByRole("list", {
      name: "Retail products found",
    });
    await user.click(
      within(found).getByRole("button", { name: /^Basmati Rice/ }),
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Wholesale category"),
      rice.id,
    );
    const [first, second] = retail.variants;
    const units = within(dialog).getByRole("textbox", {
      name: `Packs per carton of ${first!.packSize.label}`,
    });
    await user.clear(units);
    await user.type(units, "20");
    if (second) {
      await user.click(
        within(dialog).getByRole("checkbox", {
          name: `Include ${second.packSize.label}`,
        }),
      );
    }
    await user.click(
      within(dialog).getByRole("button", { name: "Copy as a wholesale draft" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/v1/admin/wholesale/products/from-retail",
      body: {
        productId: retail.id,
        categoryId: rice.id,
        skus: [
          ...[
            {
              packSize: {
                value: first!.packSize.value,
                unit: first!.packSize.unit,
              },
              unitsPerCarton: 20,
            },
          ],
          ...retail.variants.slice(2).map((variant) => ({
            packSize: {
              value: variant.packSize.value,
              unit: variant.packSize.unit,
            },
            unitsPerCarton: 1,
          })),
        ],
        status: "draft",
        copyImages: true,
      },
    });
    const copy = api.mock
      .db()
      .wholesaleProducts.find((p) => p.retailProductId === retail.id)!;
    expect(copy.status).toBe("draft");
    expect(copy.skus.every((sku) => sku.stock === 0)).toBe(true);
    expect(copy.images.length).toBe(retail.imageCount);
    await waitFor(() =>
      expect(testNavigation.history.at(-1)).toBe(
        `/wholesale/products/${copy.id}`,
      ),
    );
  });

  it("deletes a product in any status after a confirmation", async () => {
    const daawat = product("Daawat Basmati Rice");
    expect(daawat.status).toBe("active");
    const { user } = renderProduct(daawat.id);
    await screen.findByRole("heading", { name: "Daawat Basmati Rice" });
    await user.click(
      screen.getByRole("button", { name: "More actions for this product" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete Daawat Basmati Rice for good?");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete the product" }),
    );
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        `DELETE /v1/admin/wholesale/products/${daawat.id}`,
      ]),
    );
    expect(
      api.mock.db().wholesaleProducts.some((p) => p.id === daawat.id),
    ).toBe(false);
    await waitFor(() =>
      expect(testNavigation.history.at(-1)).toBe("/wholesale/products"),
    );
  });

  it("shows everything to a reader and lets them change nothing", async () => {
    const daawat = product("Daawat Basmati Rice");
    renderProduct(daawat.id, READ_ONLY);
    await screen.findByRole("heading", { name: "Daawat Basmati Rice" });
    expect(field("name.en")).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Set the stock of 20 × 1 kg" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "More actions for this product" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("table", {
        name: "Stock history of Daawat Basmati Rice",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the section from an admin without wholesale.read", async () => {
    renderPanel(<ProductsView />, {
      path: "/wholesale/products",
      permissions: ["catalog.read"],
    });
    expect(
      await screen.findByText("Your role does not open this page"),
    ).toBeInTheDocument();
    expect(api.calls).toEqual([]);
  });
});

describe("the wholesale sheets", () => {
  const csv = (name: string, lines: string[]) =>
    new File([lines.join("\n")], name, { type: "text/csv" });

  it("previews and imports products against the wholesale endpoints, the stock through the ledger", async () => {
    const { user } = renderPanel(
      <ImportExportDialog
        type="products"
        catalogue={WHOLESALE_SHEETS}
        open
        onOpenChange={() => undefined}
      />,
      { path: "/wholesale/products" },
    );
    await user.upload(
      screen.getByLabelText("Choose a .csv or .xlsx file"),
      csv("wholesale.csv", [
        "sku,name_en,category_slug,pack_value,pack_unit,units_per_carton,stock,vat_rate,status",
        "RFW-SPROUT-1,Sprouted Moong,pulses,1,kg,10,7,7,active",
        ",Odd Sprouts,pulses,1,bag,10,,7,",
      ]),
    );
    const preview = await screen.findByRole("region", {
      name: "Wholesale products: preview",
    });
    expect(writes().map((call) => call.path)).toEqual([
      "/v1/admin/wholesale/import/preview",
    ]);
    expect(preview).toHaveTextContent("Create 1");
    expect(preview).toHaveTextContent("Problems 1");
    await user.click(screen.getByRole("button", { name: /^Import: create 1/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    await screen.findByRole("region", { name: "Wholesale products: result" });
    expect(
      writes()
        .map((call) => call.path)
        .at(-1),
    ).toBe("/v1/admin/wholesale/import");
    const created = api.mock
      .db()
      .wholesaleProducts.find((p) => p.slug.en === "sprouted-moong")!;
    expect(created.status).toBe("active");
    expect(created.skus[0]).toMatchObject({
      sku: "RFW-SPROUT-1",
      unitsPerCarton: 10,
      stock: 7,
    });
    expect(
      api.mock
        .db()
        .wholesaleStockMovements.find((m) => m.skuId === created.skus[0]!.id),
    ).toMatchObject({ reason: "import", delta: 7 });
  });
});
