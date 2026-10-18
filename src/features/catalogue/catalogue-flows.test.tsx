// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Category,
  ListResult,
  PageResult,
  ProductDetail,
  ProductSummary,
} from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { png } from "@/test/png";
import { renderPanel, testNavigation } from "@/test/render";
import { installUpload } from "@/test/upload";
import { CategoriesView } from "./categories-view";
import { ImageManager } from "./image-manager";
import type { SizeReader } from "./image-rules";
import { ProductNewView } from "./product-new-view";
import { ProductView } from "./product-view";
import { ProductsView } from "./products-view";
import { useProduct } from "./queries";

let api: TestApi;
let products: ProductSummary[];
let categories: Category[];

const READ_ONLY = ["catalog.read"];

// The page of a product is a long form with its panels: a query by role
// walks all of it, and a test makes many.
vi.setConfig({ testTimeout: 30_000 });

/** The save button of the product form, found by its words (quicker than by role). */
const saveButton = () =>
  screen.getByText("Save changes", { selector: "button" });

/** A product of the demo data by name: "Basmati Rice". */
function product(name: string): ProductSummary {
  const found = products.find((entry) => entry.name.en === name);
  if (!found) throw new Error(`No product "${name}" in the demo data`);
  return found;
}

/** A pack size of a product of the demo data: "Basmati Rice", "5 kg". */
function size(name: string, label: string) {
  const found = product(name).variants.find(
    (entry) => entry.packSize.label === label,
  );
  if (!found) throw new Error(`No pack size "${label}" of "${name}"`);
  return found;
}

function category(name: string): Category {
  const found = categories.find((entry) => entry.name.en === name);
  if (!found) throw new Error(`No category "${name}" in the demo data`);
  return found;
}

const record = (id: string) => {
  const found = api.mock.db().products.find((entry) => entry.id === id);
  if (!found) throw new Error(`No product ${id} in the mock`);
  return found;
};

/** The requests that change something. */
const writes = () => api.calls.filter((call) => call.method !== "GET");

/** A picture the API takes: a PNG of 640 × 480. */
const samplePicture = (name: string) =>
  new File([new Uint8Array(png(640, 480))], name, { type: "image/png" });
const okSize: SizeReader = async () => ({ width: 640, height: 480 });

/** Makes sure a delivered order of the demo data holds a pack size of the product. */
function putInAnOrder(productId: string, variantId?: string): void {
  const db = api.mock.db();
  const order = db.orders.find((entry) => entry.status === "delivered");
  if (!order) throw new Error("No delivered order in the demo data");
  const variant =
    record(productId).variants.find((entry) => entry.id === variantId) ??
    record(productId).variants[0];
  if (!variant) throw new Error("The product has no pack size");
  if (order.items.some((item) => item.variantId === variant.id)) return;
  const first = order.items[0];
  if (!first) throw new Error("The order has no items");
  order.items.push({
    ...first,
    productId,
    variantId: variant.id,
    sku: variant.sku,
  });
}

/** A field of a form by the name the form gives it (`name.en`, `regularPrice`). */
function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

function renderProduct(id: string, permissions?: string[]) {
  return renderPanel(<ProductView />, {
    path: `/catalogue/products/${id}`,
    params: { id },
    permissions,
  });
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  products = (
    await api.request<PageResult<ProductSummary>>(
      "GET",
      "/v1/admin/products?limit=100&sort=sku",
    )
  ).items;
  categories = (
    await api.request<ListResult<Category>>("GET", "/v1/admin/categories")
  ).items;
  api.calls.length = 0;
});

describe("the product list", () => {
  it("asks the API with the documented filters and nothing else", async () => {
    const rice = category("Rice & Grains");
    renderPanel(<ProductsView />, {
      path: `/catalogue/products?status=active&onSale=true&isAvailable=true&sort=price_asc&categoryId=${rice.id}&q=b`,
    });
    await screen.findByRole("table");
    const list = api.calls.find((call) =>
      call.path.startsWith("/v1/admin/products?"),
    );
    const query = new URLSearchParams(list?.path.split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({
      status: "active",
      onSale: "true",
      isAvailable: "true",
      sort: "price_asc",
      categoryId: rice.id,
      page: "1",
      limit: "25",
    });
    // One character is less than the API's search takes: it is not sent.
    expect(query.has("q")).toBe(false);
  });

  it("switches a product unavailable at once and tells the API", async () => {
    const dal = product("Toor Dal");
    const { user } = renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=toor",
    });
    const table = await screen.findByRole("table");
    const toggle = await within(table).findByRole("switch", {
      name: "Toor Dal is available",
    });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await waitFor(() =>
      expect(writes()).toContainEqual({
        method: "PATCH",
        path: `/v1/admin/products/${dal.id}`,
        body: { isAvailable: false },
      }),
    );
    expect(record(dal.id).isAvailable).toBe(false);
  });

  it("puts the switch back when the API refuses", async () => {
    // The session of the API is a read-only one: the change is refused.
    await api.signIn("viewer");
    const dal = product("Toor Dal");
    const { user, unhandled } = renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=toor",
    });
    const table = await screen.findByRole("table");
    const name = "Toor Dal is available";
    await user.click(await within(table).findByRole("switch", { name }));

    await waitFor(() => expect(unhandled).toHaveLength(1));
    await waitFor(() =>
      expect(within(table).getByRole("switch", { name })).toBeChecked(),
    );
    expect(record(dal.id).isAvailable).toBe(true);
  });

  it("shows the price of the pack size that stands for the product, a sale struck through, and every pack size", async () => {
    // Chakki Atta: the 10 kg is on sale, the 5 kg is shown as the default.
    renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=atta&sort=sku",
    });
    const table = await screen.findByRole("table");
    const atta = (
      await within(table).findByRole("link", { name: "Chakki Atta" })
    ).closest("tr");
    expect(atta).toHaveTextContent("2 pack sizes");
    expect(atta).toHaveTextContent("5 kg, 10 kg");
    expect(atta).toHaveTextContent("from €12.99");
    expect(atta?.querySelector("s")).toBeNull();
    expect(atta).toHaveTextContent("5 kg shown");

    // Basmati Rice: the 1 kg stands for it; its price has no sale.
    renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=basmati",
    });
    const basmati = (
      await screen.findByRole("link", { name: "Basmati Rice" })
    ).closest("tr");
    expect(basmati).toHaveTextContent("from €4.99");
  });

  it("keeps changes away from an admin without catalog.manage", async () => {
    renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=toor",
      permissions: READ_ONLY,
    });
    const table = await screen.findByRole("table");
    expect(
      await within(table).findByRole("switch", {
        name: "Toor Dal is available",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "New product" })).toBeDisabled();
    expect(
      screen.getByLabelText('Your role does not include "Catalogue: manage".'),
    ).toBeInTheDocument();
  });
});

describe("saving a product", () => {
  it("sends a changed price of a pack size to its own endpoint, and nothing else", async () => {
    const dal = product("Toor Dal");
    const kilo = size("Toor Dal", "1 kg");
    const { user } = renderProduct(dal.id);
    const price = await waitFor(() => field("variants.0.regularPrice"));
    expect(price).toHaveValue("4.49");
    expect(saveButton()).toBeDisabled();

    await user.clear(price);
    await user.type(price, "4,79");
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${dal.id}/variants/${kilo.id}`,
          body: { regularPrice: 479 },
        },
      ]),
    );
    expect(record(dal.id).variants[0]?.regularPrice).toBe(479);
    // Saved: the form is clean again.
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  it("ends a sale with salePrice: null", async () => {
    const rice = product("Basmati Rice");
    const five = size("Basmati Rice", "5 kg");
    const { user } = renderProduct(rice.id);
    const sale = await waitFor(() => field("variants.1.saleMode"));
    expect(sale).toHaveValue("price");
    await user.selectOptions(sale, "none");
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}/variants/${five.id}`,
          body: { salePrice: null },
        },
      ]),
    );
    expect(
      record(rice.id).variants.find((entry) => entry.id === five.id)?.salePrice,
    ).toBeNull();
    // The change shows up in the price history of that pack size.
    const history = screen.getByRole("region", { name: "Price history" });
    await user.selectOptions(
      within(history).getByRole("combobox", { name: "Pack size" }),
      five.id,
    );
    expect(
      await within(history).findByText("Sale of €19.99 ended"),
    ).toBeInTheDocument();
  });

  it("sends a discount as a percentage and no sale price with it", async () => {
    const rice = product("Basmati Rice");
    const five = size("Basmati Rice", "5 kg");
    const { user } = renderProduct(rice.id);
    const sale = await waitFor(() => field("variants.1.saleMode"));
    await user.selectOptions(sale, "percent");
    await user.type(field("variants.1.discountPercent"), "25");
    expect(screen.getByText(/Customers will pay about/)).toHaveTextContent(
      "€18.74",
    );
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}/variants/${five.id}`,
          body: { discountPercent: 25 },
        },
      ]),
    );
    expect(
      record(rice.id).variants.find((entry) => entry.id === five.id)?.salePrice,
    ).toBe(1874);
  });

  it("does not ask the API with a sale price that is not below the regular price", async () => {
    const rice = product("Basmati Rice");
    const { user } = renderProduct(rice.id);
    const sale = await waitFor(() => field("variants.1.salePrice"));
    await user.clear(sale);
    await user.type(sale, "24.99");
    await user.click(saveButton());

    expect(
      await screen.findByText(
        "The sale price must be below the regular price (€24.99).",
      ),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("shows an article number that is taken at its row and keeps what was typed", async () => {
    const dal = product("Toor Dal");
    const taken = size("Moong Dal", "1 kg");
    const { user, unhandled } = renderProduct(dal.id);
    const sku = await waitFor(() => field("variants.0.sku"));
    await user.clear(sku);
    await user.type(sku, taken.sku.toLowerCase());
    await user.clear(field("brand"));
    await user.type(field("brand"), "Heera");
    await user.click(saveButton());

    expect(
      await screen.findByText(
        "Another product already has this article number (SKU).",
      ),
    ).toBeInTheDocument();
    expect(field("variants.0.sku")).toHaveAttribute("aria-invalid", "true");
    // The product fields went through before the pack size was refused:
    // the form says so, and keeps what is still to be sent.
    expect(
      screen.getByText(/Saved: the product details\. Not saved: 1 kg\./),
    ).toBeInTheDocument();
    expect(record(dal.id).brand).toBe("Heera");
    expect(record(dal.id).variants[0]?.sku).toBe(size("Toor Dal", "1 kg").sku);
    expect(field("brand")).toHaveValue("Heera");
    expect(field("variants.0.sku")).toHaveValue(taken.sku.toLowerCase());
    expect(unhandled).toHaveLength(0);

    // Saving again sends only what is left: nothing twice.
    api.calls.length = 0;
    await user.clear(field("variants.0.sku"));
    await user.type(field("variants.0.sku"), "RF-DAL-1");
    await user.click(saveButton());
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${dal.id}/variants/${size("Toor Dal", "1 kg").id}`,
          body: { sku: "RF-DAL-1" },
        },
      ]),
    );
  });

  it("keeps what was typed when the product changes underneath, and sends only that", async () => {
    const rice = product("Basmati Rice");
    const { user } = renderProduct(rice.id);
    const name = await waitFor(() => field("name.en"));
    await user.clear(name);
    await user.type(name, "Basmati Rice Extra Long");

    // Meanwhile the product changes: someone renames the brand, and this
    // admin counts the shelf (which loads the product again).
    record(rice.id).brand = "Daawat";
    const panel = screen.getByRole("region", { name: "Stock" });
    await user.click(
      within(panel).getByRole("button", { name: "Change the stock" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Counted number" }),
      "90",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Set the stock to 90" }),
    );
    await waitFor(() => expect(field("brand")).toHaveValue("Daawat"));
    expect(field("name.en")).toHaveValue("Basmati Rice Extra Long");

    api.calls.length = 0;
    await user.click(saveButton());
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}`,
          body: { name: { en: "Basmati Rice Extra Long", de: "Basmati Reis" } },
        },
      ]),
    );
    // The brand nobody touched here was not sent back as the old value.
    expect(record(rice.id).brand).toBe("Daawat");
  });

  it("replaces the highlights of a language as a whole list", async () => {
    const dal = product("Toor Dal");
    const { user } = renderProduct(dal.id);
    const german = await waitFor(() => field("highlights.de"));
    await user.type(german, "{Enter}Reich an Eiweiß");
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${dal.id}`,
          body: {
            highlights: {
              en: ["Authentic quality", "Imported from India"],
              de: ["Authentische Qualität", "Reich an Eiweiß"],
            },
          },
        },
      ]),
    );
  });

  it("shows the form to an admin who may only read, without a way to save", async () => {
    const dal = product("Toor Dal");
    renderProduct(dal.id, READ_ONLY);
    const price = await waitFor(() => field("variants.0.regularPrice"));
    expect(price).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "More actions for this product" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Choose pictures to upload"),
    ).not.toBeInTheDocument();
  });
});

describe("deleting and archiving a product", () => {
  async function chooseDelete(user: ReturnType<typeof renderPanel>["user"]) {
    await user.click(
      await screen.findByRole("button", {
        name: "More actions for this product",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    return screen.findByRole("alertdialog");
  }

  it("does not try to delete an active product: it explains and archives instead", async () => {
    const dal = product("Toor Dal");
    const { user } = renderProduct(dal.id);
    const dialog = await chooseDelete(user);
    expect(
      within(dialog).getByRole("heading", {
        name: "An active product cannot be deleted",
      }),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "Archive instead" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: `/v1/admin/products/${dal.id}`,
        body: { status: "archived" },
      },
    ]);
    expect(record(dal.id).status).toBe("archived");
  });

  it("deletes a draft that is not part of an order, after a confirmation", async () => {
    const paneer = product("Paneer");
    expect(paneer.status).toBe("draft");
    const { user } = renderProduct(paneer.id);
    const dialog = await chooseDelete(user);
    expect(
      within(dialog).getByRole("heading", {
        name: "Delete Paneer for good?",
      }),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "Delete the product" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/products/${paneer.id}`,
          body: undefined,
        },
      ]),
    );
    expect(api.mock.db().products.some((entry) => entry.id === paneer.id)).toBe(
      false,
    );
    await waitFor(() =>
      expect(testNavigation.location).toBe("/catalogue/products"),
    );
  });

  it("explains a product that is part of an order and offers to archive it, without asking the API", async () => {
    const dal = product("Toor Dal");
    // A draft again, but an order still refers to it: the product says so.
    record(dal.id).status = "draft";
    putInAnOrder(dal.id);
    const { user, unhandled } = renderProduct(dal.id);
    await chooseDelete(user);

    const refusal = await screen.findByRole("heading", {
      name: "Toor Dal cannot be deleted",
    });
    expect(refusal).toBeInTheDocument();
    expect(screen.getByText(/is part of an order/)).toBeInTheDocument();
    expect(writes().some((call) => call.method === "DELETE")).toBe(false);
    expect(api.mock.db().products.some((entry) => entry.id === dal.id)).toBe(
      true,
    );
    expect(unhandled).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(record(dal.id).status).toBe("archived"));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("says that an archived product of an order stays as it is", async () => {
    const dal = product("Toor Dal");
    record(dal.id).status = "archived";
    putInAnOrder(dal.id);
    const { user } = renderProduct(dal.id);
    await user.click(
      await screen.findByRole("button", {
        name: "More actions for this product",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(
      await screen.findByText(/It is archived already/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive instead" }),
    ).not.toBeInTheDocument();
    expect(record(dal.id).status).toBe("archived");
  });
});

describe("the pack sizes of a product", () => {
  it("lists them smallest first in the form, marks the default, and names the URL of each", async () => {
    const rice = product("Basmati Rice");
    renderProduct(rice.id);
    const table = await screen.findByRole("list", { name: "Pack sizes" });
    const rows = within(table).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "1 kg",
      "5 kg",
      "10 kg",
    ]);
    expect(rows[0]).toHaveTextContent("Default");
    expect(rows[0]).toHaveTextContent("/basmati-rice-1kg");
    expect(rows[1]).not.toHaveTextContent("Default");
    // The pack size that is not offered says so.
    expect(rows[2]).toHaveTextContent("Not offered");
    expect(
      screen.getByRole("heading", { level: 1, name: "Basmati Rice" }),
    ).toBeInTheDocument();
  });

  it("adds a pack size with its opening stock through its own request, after the product", async () => {
    const dal = product("Moong Dal");
    const { user } = renderProduct(dal.id);
    await waitFor(() => field("variants.0.regularPrice"));
    await user.click(screen.getByRole("button", { name: "Add a pack size" }));
    const rows = within(
      screen.getByRole("list", { name: "Pack sizes" }),
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("Not saved yet");
    // The unit follows the pack sizes the product has.
    expect(field("variants.1.packSize.unit")).toHaveValue("kg");

    await user.type(field("variants.1.packSize.value"), "2");
    await user.type(field("variants.1.regularPrice"), "8.49");
    await user.clear(field("variants.1.stockQuantity"));
    await user.type(field("variants.1.stockQuantity"), "30");
    await user.clear(field("brand"));
    await user.type(field("brand"), "Heera");
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${dal.id}`,
          body: { brand: "Heera" },
        },
        {
          method: "POST",
          path: `/v1/admin/products/${dal.id}/variants`,
          body: {
            packSize: { value: 2, unit: "kg" },
            regularPrice: 849,
            stockQuantity: 30,
          },
        },
      ]),
    );
    const added = record(dal.id).variants.find(
      (entry) => entry.packSize.value === 2,
    );
    expect(added).toMatchObject({ regularPrice: 849, isEnabled: true });
    expect(added?.stock.quantity).toBe(30);
    // The opening stock is the first line of its history, with the admin.
    const opening = api.mock
      .db()
      .stockMovements.find((entry) => entry.variantId === added?.id);
    expect(opening).toMatchObject({ reason: "restock", delta: 30 });
    expect(opening?.adminId).not.toBeNull();
    // The new row is a saved one now: it shows its article number.
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Pack sizes" })).getAllByRole(
          "listitem",
        )[1],
      ).toHaveTextContent(added?.sku ?? "-"),
    );
    expect(saveButton()).toBeDisabled();
  });

  it("refuses a second pack of the same size and a mixed unit family before asking the API", async () => {
    const dal = product("Moong Dal");
    const { user } = renderProduct(dal.id);
    await waitFor(() => field("variants.0.regularPrice"));
    await user.click(screen.getByRole("button", { name: "Add a pack size" }));
    await user.type(field("variants.1.packSize.value"), "1000");
    await user.selectOptions(field("variants.1.packSize.unit"), "g");
    await user.type(field("variants.1.regularPrice"), "4.49");
    await user.click(saveButton());
    expect(
      await screen.findByText("The same pack as row 1. Each pack only once."),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);

    await user.selectOptions(field("variants.1.packSize.unit"), "ml");
    await user.click(saveButton());
    expect(
      await screen.findByText(
        /All pack sizes of a product are of one unit family/,
      ),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("removes a pack size only after a confirmation, and never the last one", async () => {
    const rice = product("Basmati Rice");
    const ten = size("Basmati Rice", "10 kg");
    const view = renderProduct(rice.id);
    const { user } = view;
    await waitFor(() => field("variants.0.regularPrice"));
    await user.click(
      screen.getByRole("button", { name: "Remove the pack size 10 kg" }),
    );
    expect(
      screen.getByText(/Removed for good when you save/),
    ).toBeInTheDocument();
    await user.click(saveButton());
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Remove the pack size 10 kg?",
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Stay").nextSibling).toHaveTextContent(
      "1 kg, 5 kg",
    );
    expect(writes()).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "Save and remove 10 kg" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/products/${rice.id}/variants/${ten.id}`,
          body: undefined,
        },
      ]),
    );
    expect(
      record(rice.id).variants.map((entry) => entry.packSize.label),
    ).toEqual(["1 kg", "5 kg"]);
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Pack sizes" })).getAllByRole(
          "listitem",
        ),
      ).toHaveLength(2),
    );

    // A product with one pack size offers no removal: disable it instead.
    view.unmount();
    const dal = product("Moong Dal");
    renderProduct(dal.id);
    await waitFor(() => field("variants.0.regularPrice"));
    expect(
      screen.queryByRole("button", { name: /^Remove the pack size/ }),
    ).not.toBeInTheDocument();
  });

  it("offers to disable a pack size an order holds when the API refuses to remove it", async () => {
    const rice = product("Basmati Rice");
    const five = size("Basmati Rice", "5 kg");
    putInAnOrder(rice.id, five.id);
    const { user, unhandled } = renderProduct(rice.id);
    await waitFor(() => field("variants.0.regularPrice"));
    await user.click(
      screen.getByRole("button", { name: "Remove the pack size 5 kg" }),
    );
    await user.click(saveButton());
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Save and remove 5 kg",
      }),
    );
    expect(
      await screen.findByText(
        "The pack size is part of an order and cannot be removed. Disable it instead.",
      ),
    ).toBeInTheDocument();
    expect(record(rice.id).variants).toHaveLength(3);
    expect(unhandled).toHaveLength(0);

    api.calls.length = 0;
    await user.click(
      screen.getByRole("button", { name: "Disable it instead" }),
    );
    await user.click(saveButton());
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}/variants/${five.id}`,
          body: { isEnabled: false },
        },
      ]),
    );
    expect(
      record(rice.id).variants.find((entry) => entry.id === five.id)?.isEnabled,
    ).toBe(false);
  });

  it("changes two pack sizes in two requests and stops at the first refusal, keeping the rest", async () => {
    const rice = product("Basmati Rice");
    const one = size("Basmati Rice", "1 kg");
    const five = size("Basmati Rice", "5 kg");
    const taken = size("Moong Dal", "1 kg");
    const { user } = renderProduct(rice.id);
    const first = await waitFor(() => field("variants.0.regularPrice"));
    await user.clear(first);
    await user.type(first, "5.49");
    await user.clear(field("variants.1.sku"));
    await user.type(field("variants.1.sku"), taken.sku);
    const third = field("variants.2.regularPrice");
    await user.clear(third);
    await user.type(third, "44.99");
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}/variants/${one.id}`,
          body: { regularPrice: 549 },
        },
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}/variants/${five.id}`,
          body: { sku: taken.sku },
        },
      ]),
    );
    // The first went through, the second was refused, the third was not sent.
    expect(
      await screen.findByText(/Saved: the pack size 1 kg\. Not saved: 5 kg\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 further change was not sent/),
    ).toBeInTheDocument();
    expect(field("variants.0.regularPrice")).toHaveValue("5.49");
    expect(field("variants.2.regularPrice")).toHaveValue("44.99");
    expect(
      record(rice.id).variants.find((entry) => entry.id === one.id)
        ?.regularPrice,
    ).toBe(549);
    expect(
      record(rice.id).variants.find((entry) => entry.id === five.id)?.sku,
    ).toBe(five.sku);
  });
});

describe("the pictures of a product", () => {
  const sizes: Record<string, { width: number; height: number }> = {
    "small.jpg": { width: 120, height: 900 },
  };
  const readSize: SizeReader = async (file) =>
    sizes[file.name] ?? { width: 1200, height: 900 };

  function Pictures({ id }: { id: string }) {
    const loaded = useProduct(id).data;
    return loaded ? (
      <ImageManager product={loaded} readSize={readSize} />
    ) : null;
  }

  const picture = (name: string, type = "image/jpeg") =>
    new File(["x"], name, { type });

  /** Hands files over the way a drop from the desktop does. */
  function drop(files: File[]) {
    const zone = screen
      .getByText(/Drop pictures here/)
      .closest("div") as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"] } });
  }

  it("checks the files before anything is sent and names each one it refuses", async () => {
    const rice = product("Basmati Rice");
    renderPanel(<Pictures id={rice.id} />);
    await screen.findByRole("list", { name: "Pictures of Basmati Rice" });

    drop([
      picture("ok.jpg"),
      picture("anim.gif", "image/gif"),
      picture("small.jpg"),
    ]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("2 files cannot be uploaded");
    expect(alert).toHaveTextContent(
      "anim.gif: Not a JPEG, PNG or WebP picture.",
    );
    expect(alert).toHaveTextContent(
      "small.jpg: 120 × 900 px: each side needs at least 200 px.",
    );
    expect(alert).toHaveTextContent("Nothing was uploaded yet");
    // The file that passes can go on its own.
    expect(
      within(alert).getByRole("button", { name: "Upload the other 1 picture" }),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("says how many pictures still fit", async () => {
    const rice = product("Basmati Rice");
    const stored = record(rice.id);
    const first = stored.images[0];
    if (!first) throw new Error("The demo product has no picture");
    stored.images = Array.from({ length: 11 }, (_, index) => ({
      ...first,
      id: index.toString(16).padStart(24, "a"),
      isPrimary: index === 0,
    }));
    renderPanel(<Pictures id={rice.id} />);
    await screen.findByRole("list", { name: "Pictures of Basmati Rice" });

    drop([picture("a.jpg"), picture("b.jpg"), picture("c.jpg")]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "There is room for 1 more picture, and you chose 3. A product holds 12 at most.",
    );
    expect(writes()).toEqual([]);
  });

  it("says that an upload is stored as a whole or not at all", async () => {
    const rice = product("Basmati Rice");
    renderPanel(<Pictures id={rice.id} />);
    expect(
      await screen.findByText(
        /if the API refuses one file of an upload, it stores none of them/,
      ),
    ).toBeInTheDocument();
  });

  it("moves a picture with the menu and sends every id in the new order", async () => {
    const rice = product("Basmati Rice");
    const before = record(rice.id).images.map((image) => image.id);
    expect(before).toHaveLength(2);
    const { user } = renderPanel(<Pictures id={rice.id} />);
    await user.click(
      await screen.findByRole("button", { name: "Actions for picture 1" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Move later" }),
    );

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: `/v1/admin/products/${rice.id}/images/order`,
          body: { orderedIds: [before[1], before[0]] },
        },
      ]),
    );
    expect(record(rice.id).images.map((image) => image.id)).toEqual([
      before[1],
      before[0],
    ]);
    // The handles take the keyboard: each picture can be picked up.
    expect(
      screen.getByRole("button", { name: "Move picture 1, place 1 of 2" }),
    ).toHaveAttribute("aria-roledescription", "sortable");
  });

  it("loads the product again when the pictures changed in the meantime", async () => {
    const rice = product("Basmati Rice");
    const { user, unhandled } = renderPanel(<Pictures id={rice.id} />);
    await screen.findByRole("button", { name: "Actions for picture 2" });
    // Someone else deletes a picture: the order this page knows is stale.
    const stored = record(rice.id);
    stored.images = stored.images.slice(0, 1);

    await user.click(
      screen.getByRole("button", { name: "Actions for picture 1" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Move later" }),
    );

    await waitFor(() => expect(unhandled).toHaveLength(1));
    expect((unhandled[0] as { code?: string }).code).toBe(
      "IMAGE_ORDER_INVALID",
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: /Pictures of/ })).getAllByRole(
          "listitem",
        ),
      ).toHaveLength(1),
    );
  });

  it("deletes a picture only after a confirmation", async () => {
    const rice = product("Basmati Rice");
    const [main, second] = record(rice.id).images;
    const { user } = renderPanel(<Pictures id={rice.id} />);
    await user.click(
      await screen.findByRole("button", { name: "Actions for picture 1" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "It is the main picture: the first remaining one takes its place.",
    );
    expect(writes()).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "Delete the picture" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/products/${rice.id}/images/${main?.id}`,
          body: undefined,
        },
      ]),
    );
    expect(record(rice.id).images.map((image) => image.id)).toEqual([
      second?.id,
    ]);
  });

  it("makes another picture the main one", async () => {
    const rice = product("Basmati Rice");
    const second = record(rice.id).images[1];
    const { user } = renderPanel(<Pictures id={rice.id} />);
    await user.click(
      await screen.findByRole("button", { name: "Actions for picture 2" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Make it the main picture" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}/images/${second?.id}`,
          body: { isPrimary: true },
        },
      ]),
    );
  });

  it("marks a missing description and saves both languages, clearing an emptied one", async () => {
    const rice = product("Basmati Rice");
    const [first, second] = record(rice.id).images;
    const { user } = renderPanel(<Pictures id={rice.id} />);
    // The second picture of the demo data has no German description.
    await user.click(
      await screen.findByRole("button", {
        name: "Describe picture 2: the German description is missing",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(field("alt.de"), "Basmati Reis in der Schale");
    await user.click(
      within(dialog).getByRole("button", { name: "Save description" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}/images/${second?.id}`,
          body: {
            alt: { en: "Basmati Rice", de: "Basmati Reis in der Schale" },
          },
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    api.calls.length = 0;
    await user.click(
      await screen.findByRole("button", {
        name: "Describe picture 1: described in English and German",
      }),
    );
    await user.clear(field("alt.de"));
    await user.click(screen.getByRole("button", { name: "Save description" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}/images/${first?.id}`,
          body: { alt: { en: "Basmati Rice", de: null } },
        },
      ]),
    );
  });
});

describe("the categories", () => {
  const actionsFor = async (
    user: ReturnType<typeof renderPanel>["user"],
    name: string,
    action: string,
  ) => {
    await user.click(
      await screen.findByRole("button", { name: `Actions for ${name}` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: action }));
  };

  it("shows the tree of the flat list, each parent with its sub-categories", async () => {
    renderPanel(<CategoriesView />);
    const main = await screen.findByRole("list", { name: "Main categories" });
    expect(main.children).toHaveLength(
      categories.filter((entry) => entry.level === 1).length,
    );
    const below = screen.getByRole("list", {
      name: "Sub-categories of Rice & Grains",
    });
    expect(
      within(below)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining("Basmati Rice"),
      expect.stringContaining("Everyday Rice"),
    ]);
  });

  it("links the product count to the product list of that category", async () => {
    const rice = category("Rice & Grains");
    renderPanel(<CategoriesView />);
    expect(
      await screen.findByRole("link", {
        name: `${rice.productCount} products in Rice & Grains: open the list`,
      }),
    ).toHaveAttribute("href", `/catalogue/products?categoryId=${rice.id}`);
  });

  it("moves a main category and sends every category of that level", async () => {
    const main = categories
      .filter((entry) => entry.parentId === null)
      .map((entry) => entry.id);
    const { user } = renderPanel(<CategoriesView />);
    await actionsFor(user, "Rice & Grains", "Move down");
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: "/v1/admin/categories/order",
          body: {
            parentId: null,
            orderedIds: [main[1], main[0], ...main.slice(2)],
          },
        },
      ]),
    );
    // The tree follows at once.
    const list = screen.getByRole("list", { name: "Main categories" });
    expect(list.children[0]).toHaveTextContent("Flour");
    expect(list.children[1]).toHaveTextContent("Rice & Grains");
  });

  it("orders the sub-categories of one parent among themselves", async () => {
    const rice = category("Rice & Grains");
    const { user } = renderPanel(<CategoriesView />);
    await actionsFor(user, "Everyday Rice", "Move up");
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: "/v1/admin/categories/order",
          body: {
            parentId: rice.id,
            orderedIds: [
              category("Everyday Rice").id,
              category("Basmati Rice").id,
            ],
          },
        },
      ]),
    );
  });

  it("loads the tree again when the categories changed in the meantime", async () => {
    const { user, unhandled } = renderPanel(<CategoriesView />);
    await screen.findByRole("button", { name: "Actions for Flour" });
    // Someone else adds a main category: the order this page knows is incomplete.
    await api.request("POST", "/v1/admin/categories", {
      name: { en: "Beverages" },
    });
    api.calls.length = 0;

    await actionsFor(user, "Rice & Grains", "Move down");
    await waitFor(() => expect(unhandled).toHaveLength(1));
    expect((unhandled[0] as { code?: string }).code).toBe(
      "CATEGORY_ORDER_INVALID",
    );
    expect(
      await screen.findByRole("button", { name: "Beverages" }),
    ).toBeInTheDocument();
  });

  it("says what hiding means, with the number of products, before it hides", async () => {
    const rice = category("Rice & Grains");
    const { user } = renderPanel(<CategoriesView />);
    await user.click(
      await screen.findByRole("switch", {
        name: "Rice & Grains is visible in the shop",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Hide Rice & Grains from the shop?",
      }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "A hidden category and its products disappear from the shop",
    );
    expect(
      within(dialog).getByText("Products in it and below").nextSibling,
    ).toHaveTextContent(String(rice.productCount));
    expect(
      within(dialog).getByText("Sub-categories").nextSibling,
    ).toHaveTextContent("2");
    expect(writes()).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "Hide the category" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/categories/${rice.id}`,
          body: { isVisible: false },
        },
      ]),
    );
  });

  it("leaves the category visible when the admin steps back", async () => {
    const { user } = renderPanel(<CategoriesView />);
    const name = "Rice & Grains is visible in the shop";
    await user.click(await screen.findByRole("switch", { name }));
    await user.click(
      await screen.findByRole("button", { name: "Keep it visible" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("switch", { name })).toBeChecked();
    expect(writes()).toEqual([]);
  });

  it("shows a hidden category again without asking", async () => {
    const frozen = category("Frozen");
    expect(frozen.isVisible).toBe(false);
    const { user } = renderPanel(<CategoriesView />);
    await user.click(
      await screen.findByRole("switch", {
        name: "Frozen is visible in the shop",
      }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/categories/${frozen.id}`,
          body: { isVisible: true },
        },
      ]),
    );
  });

  it("does not delete a category that is not empty, and says what to do", async () => {
    const { user } = renderPanel(<CategoriesView />);
    await actionsFor(user, "Rice & Grains", "Delete");
    let dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Rice & Grains still has 2 sub-categories",
    );
    expect(dialog).toHaveTextContent("Move them to another category");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    const pulses = category("Pulses");
    await actionsFor(user, "Pulses", "Delete");
    dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      `Pulses still holds ${pulses.productCount} products`,
    );
    expect(
      within(dialog).getByRole("link", { name: "Open the products" }),
    ).toHaveAttribute("href", `/catalogue/products?categoryId=${pulses.id}`);
    expect(
      within(dialog).getByRole("button", { name: "Hide it instead" }),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("deletes an empty category after a confirmation", async () => {
    const created = await api.request<{ category: Category }>(
      "POST",
      "/v1/admin/categories",
      {
        name: { en: "Seasonal" },
      },
    );
    api.calls.length = 0;
    const { user } = renderPanel(<CategoriesView />);
    await actionsFor(user, "Seasonal", "Delete");
    const dialog = await screen.findByRole("alertdialog");
    expect(writes()).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: "Delete the category" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/categories/${created.category.id}`,
          body: undefined,
        },
      ]),
    );
  });

  it("creates a sub-category under the category it was started from", async () => {
    const pulses = category("Pulses");
    const { user } = renderPanel(<CategoriesView />);
    await actionsFor(user, "Pulses", "Add a sub-category");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Parent")).toHaveValue(pulses.id);
    await user.type(field("name.en"), "Lentils");
    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: "/v1/admin/categories",
          body: {
            name: { en: "Lentils", de: null },
            isVisible: true,
            parentId: pulses.id,
          },
        },
      ]),
    );
    expect(
      await screen.findByRole("list", { name: "Sub-categories of Pulses" }),
    ).toHaveTextContent("Lentils");
  });

  it("moves a category to another parent through its form, and offers no parent that goes too deep", async () => {
    const mangoes = category("Mangoes");
    const pantry = category("Pantry");
    const { user } = renderPanel(<CategoriesView />);
    await user.click(await screen.findByRole("button", { name: "Mangoes" }));
    let dialog = await screen.findByRole("dialog");
    const parent = within(dialog).getByLabelText("Parent");
    const offered = within(parent)
      .getAllByRole("option")
      .map((option) => option.textContent?.trim());
    expect(offered).toContain("Ghee & Oil");
    expect(offered).not.toContain("Mangoes");

    await user.selectOptions(parent, pantry.id);
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/categories/${mangoes.id}`,
          body: { parentId: pantry.id },
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // A category with sub-categories fits under a main category only: below a
    // sub-category its own sub-categories would be on a fourth level.
    await user.click(screen.getByRole("button", { name: "Spices" }));
    dialog = await screen.findByRole("dialog");
    const forSpices = within(within(dialog).getByLabelText("Parent"))
      .getAllByRole("option")
      .map((option) => option.textContent?.trim());
    expect(forSpices).toContain("None: a main category");
    expect(forSpices).toContain("Flour");
    expect(forSpices).not.toContain("Spices");
    expect(forSpices).not.toContain("Atta");
    expect(forSpices).not.toContain("Whole Spices");
  });

  it("shows an address that is taken at its field", async () => {
    const { user, unhandled } = renderPanel(<CategoriesView />);
    await user.click(await screen.findByRole("button", { name: "Mangoes" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(field("slug.en"));
    await user.type(field("slug.en"), "pantry");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await within(dialog).findByText(
        "Another category already uses this address (slug).",
      ),
    ).toBeInTheDocument();
    expect(field("slug.en")).toHaveAttribute("aria-invalid", "true");
    expect(unhandled).toHaveLength(0);
  });

  it("adds a picture to a category in its form at once, then saves its description with the category", async () => {
    installUpload("works");
    const pulses = category("Everyday Rice");
    expect(pulses.image).toBeNull();
    const { user } = renderPanel(<CategoriesView readSize={okSize} />);
    await actionsFor(user, "Everyday Rice", "Add a picture");
    const dialog = await screen.findByRole("dialog");
    const section = within(dialog).getByRole("region", { name: "Picture" });
    expect(section).toHaveTextContent("Everyday Rice has no picture yet.");
    expect(
      within(dialog).queryByLabelText(/^Picture description/),
    ).not.toBeInTheDocument();

    await user.upload(
      within(section).getByLabelText("Choose the picture"),
      samplePicture("pulses.png"),
    );
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        `PUT /v1/admin/categories/${pulses.id}/image`,
      ]),
    );
    const stored = api.mock
      .db()
      .categories.find((entry) => entry.id === pulses.id);
    expect(stored?.image).not.toBeNull();
    // The form follows the list: the picture and its description are there.
    await within(section).findByText("Delete the picture");
    await user.type(field("alt.en"), "Lentils and beans");
    api.calls.length = 0;
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/categories/${pulses.id}/image`,
          body: { alt: { en: "Lentils and beans", de: null } },
        },
      ]),
    );
    expect(stored?.image?.alt).toEqual({ en: "Lentils and beans", de: null });
  });

  it("deletes the picture of a category only after a confirmation", async () => {
    const rice = category("Rice & Grains");
    expect(rice.image).not.toBeNull();
    const { user } = renderPanel(<CategoriesView readSize={okSize} />);
    await actionsFor(user, "Rice & Grains", "Edit");
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete the picture" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: "Delete the picture of Rice & Grains?",
      }),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
    await user.click(
      within(confirm).getByRole("button", { name: "Delete the picture" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "DELETE",
          path: `/v1/admin/categories/${rice.id}/image`,
          body: undefined,
        },
      ]),
    );
    expect(
      api.mock.db().categories.find((entry) => entry.id === rice.id)?.image,
    ).toBeNull();
    await within(dialog).findByText("Rice & Grains has no picture yet.");
  });

  it("creates a category with its picture: created first, then the upload, then the description", async () => {
    installUpload("works");
    const { user } = renderPanel(<CategoriesView readSize={okSize} />);
    await user.click(
      await screen.findByRole("button", { name: "New category" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(field("name.en"), "Snacks (test)");
    await user.upload(
      within(dialog).getByLabelText("Choose the picture"),
      samplePicture("snacks.png"),
    );
    expect(dialog).toHaveTextContent("snacks.png");
    expect(dialog).toHaveTextContent("uploaded when the category is created");
    await user.type(field("alt.en"), "Crisps and nuts");
    expect(writes()).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "Create category" }),
    );
    await waitFor(() =>
      expect(
        writes().map((call) => `${call.method} ${call.path}`),
      ).toHaveLength(3),
    );
    const created = api.mock
      .db()
      .categories.find((entry) => entry.name.en === "Snacks (test)");
    expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /v1/admin/categories",
      `PUT /v1/admin/categories/${created?.id}/image`,
      `PATCH /v1/admin/categories/${created?.id}/image`,
    ]);
    expect(created?.image?.alt).toEqual({ en: "Crisps and nuts", de: null });
    expect(
      await screen.findByRole("list", { name: "Main categories" }),
    ).toHaveTextContent("Snacks (test)");
  });

  it("keeps changes away from an admin without catalog.manage", async () => {
    renderPanel(<CategoriesView />, { permissions: READ_ONLY });
    expect(
      await screen.findByRole("switch", {
        name: "Rice & Grains is visible in the shop",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "New category" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /^Actions for/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Move / }),
    ).not.toBeInTheDocument();
  });
});

describe("the product a page is opened for", () => {
  it("says so when it does not exist", async () => {
    renderProduct("0123456789abcdef01234567");
    expect(
      await screen.findByText("This product does not exist"),
    ).toBeInTheDocument();
  });

  it("offers the shop only for an active product", async () => {
    const dal = product("Toor Dal");
    const detail = (
      await api.request<{ product: ProductDetail }>(
        "GET",
        `/v1/admin/products/${dal.id}`,
      )
    ).product;
    const view = renderProduct(dal.id);
    expect(
      await screen.findByRole("link", { name: /Open in the shop/ }),
    ).toHaveAttribute(
      "href",
      `http://localhost:3001/products/${detail.slug.en}`,
    );
    view.unmount();

    renderProduct(product("Paneer").id);
    await waitFor(() => field("variants.0.regularPrice"));
    expect(
      screen.queryByRole("link", { name: /Open in the shop/ }),
    ).not.toBeInTheDocument();
  });
});

describe("creating a product with pictures", () => {
  const readSize: SizeReader = async () => ({ width: 640, height: 480 });
  const picture = (name: string) =>
    new File([new Uint8Array(png(640, 480))], name, { type: "image/png" });

  /**
   * The browser's upload (`XMLHttpRequest`, for its progress), routed to the
   * mock API behind `fetch` like every other call of the panel; or failing,
   * as it does when the API cannot be reached.
   */

  async function fillNewProduct(user: ReturnType<typeof renderPanel>["user"]) {
    await screen.findByText("Create product", { selector: "button" });
    await user.type(field("name.en"), "Horse Gram");
    const select = document.querySelector<HTMLSelectElement>(
      '[name="categoryId"]',
    );
    const option = select?.options[1];
    if (!select || !option) throw new Error("No category to choose");
    await user.selectOptions(select, option.value);
    await user.type(field("variants.0.packSize.value"), "500");
    await user.type(field("variants.0.regularPrice"), "3.49");
    await user.type(field("vatRate"), "7");
  }

  const createdId = () => {
    const last = testNavigation.history.at(-1) ?? "";
    const match = /^\/catalogue\/products\/([0-9a-f]{24})$/.exec(last);
    if (!match?.[1]) throw new Error(`Not on a product page: ${last}`);
    return match[1];
  };

  it("creates the product first, then sends its pictures, and opens its page", async () => {
    installUpload("works");
    const { user } = renderPanel(<ProductNewView readSize={readSize} />, {
      path: "/catalogue/products/new",
    });
    await fillNewProduct(user);
    await user.upload(screen.getByLabelText("Choose pictures to upload"), [
      picture("front.png"),
      picture("back.png"),
    ]);
    const chosen = await screen.findByRole("list", {
      name: "Pictures chosen for the new product",
    });
    expect(within(chosen).getAllByRole("listitem")).toHaveLength(2);
    expect(writes()).toEqual([]);

    await user.click(
      screen.getByText("Create product", { selector: "button" }),
    );
    await waitFor(() => createdId());
    const id = createdId();
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /v1/admin/products",
        `POST /v1/admin/products/${id}/images`,
      ]),
    );
    expect(record(id).images).toHaveLength(2);
    expect(record(id).images[0]?.isPrimary).toBe(true);
    expect(
      await screen.findByText(
        "2 pictures stored. 1 pack size. It is a draft: set it active when it is ready.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the product when the upload fails, says so, and opens the page that takes the pictures", async () => {
    installUpload("fails");
    const { user } = renderPanel(<ProductNewView readSize={readSize} />, {
      path: "/catalogue/products/new",
    });
    await fillNewProduct(user);
    await user.upload(
      screen.getByLabelText("Choose pictures to upload"),
      picture("front.png"),
    );
    await screen.findByRole("list", {
      name: "Pictures chosen for the new product",
    });

    await user.click(
      screen.getByText("Create product", { selector: "button" }),
    );
    await waitFor(() => createdId());
    const id = createdId();
    expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /v1/admin/products",
    ]);
    expect(record(id).images).toHaveLength(0);
    // The toast: its title and, under it, what the API said.
    expect(
      (await screen.findAllByText(/created without its pictures/)).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(/The API could not be reached/)).length,
    ).toBeGreaterThan(0);
  });

  it("refuses a file that breaks a rule before the product exists and keeps the others", async () => {
    const small: SizeReader = async (file) =>
      file.name === "tiny.png"
        ? { width: 120, height: 120 }
        : { width: 640, height: 480 };
    const { user } = renderPanel(<ProductNewView readSize={small} />, {
      path: "/catalogue/products/new",
    });
    await screen.findByText("Create product", { selector: "button" });
    await user.upload(screen.getByLabelText("Choose pictures to upload"), [
      picture("tiny.png"),
      picture("front.png"),
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("One file cannot be uploaded");
    expect(alert).toHaveTextContent(
      "tiny.png: 120 × 120 px: each side needs at least 200 px.",
    );
    expect(alert).toHaveTextContent("1 other picture was added.");
    const chosen = screen.getByRole("list", {
      name: "Pictures chosen for the new product",
    });
    expect(within(chosen).getAllByRole("listitem")).toHaveLength(1);
    expect(writes()).toEqual([]);
  });
});
