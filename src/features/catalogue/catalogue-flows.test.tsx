// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { File as NodeFile } from "node:buffer";
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

/** A product of the demo data by name and pack size: "Basmati Rice 5 kg". */
function product(label: string): ProductSummary {
  const found = products.find(
    (entry) => `${entry.name.en} ${entry.packSize.label}` === label,
  );
  if (!found) throw new Error(`No product "${label}" in the demo data`);
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
    const dal = product("Toor Dal 1 kg");
    const { user } = renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=toor",
    });
    const table = await screen.findByRole("table");
    const toggle = await within(table).findByRole("switch", {
      name: "Toor Dal 1 kg is available",
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
    const dal = product("Toor Dal 1 kg");
    const { user, unhandled } = renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=toor",
    });
    const table = await screen.findByRole("table");
    const name = "Toor Dal 1 kg is available";
    await user.click(await within(table).findByRole("switch", { name }));

    await waitFor(() => expect(unhandled).toHaveLength(1));
    await waitFor(() =>
      expect(within(table).getByRole("switch", { name })).toBeChecked(),
    );
    expect(record(dal.id).isAvailable).toBe(true);
  });

  it("shows a sale with the regular price struck through and the percentage", async () => {
    renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=basmati&sort=sku",
    });
    const table = await screen.findByRole("table");
    await within(table).findByText("RF-00002", { exact: false });
    const sale = within(table)
      .getAllByRole("row")
      .find((entry) => entry.textContent?.includes("RF-00002"));
    const plain = within(table)
      .getAllByRole("row")
      .find((entry) => entry.textContent?.includes("RF-00001"));
    expect(plain?.querySelector("s")).toBeNull();
    expect(sale).toHaveTextContent("−20 %");
    expect(sale).toHaveTextContent("€19.99");
    expect(sale?.querySelector("s")).toHaveTextContent("€24.99");
  });

  it("keeps changes away from an admin without catalog.manage", async () => {
    renderPanel(<ProductsView />, {
      path: "/catalogue/products?q=toor",
      permissions: READ_ONLY,
    });
    const table = await screen.findByRole("table");
    expect(
      await within(table).findByRole("switch", {
        name: "Toor Dal 1 kg is available",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "New product" })).toBeDisabled();
    expect(
      screen.getByLabelText('Your role does not include "Catalogue: manage".'),
    ).toBeInTheDocument();
  });
});

describe("saving a product", () => {
  it("sends only the price that changed", async () => {
    const dal = product("Toor Dal 1 kg");
    const { user } = renderProduct(dal.id);
    const price = await screen.findByLabelText(/^Regular price/);
    expect(price).toHaveValue("4.49");
    expect(saveButton()).toBeDisabled();

    await user.clear(price);
    await user.type(price, "4,79");
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${dal.id}`,
          body: { regularPrice: 479 },
        },
      ]),
    );
    expect(record(dal.id).regularPrice).toBe(479);
    // Saved: the form is clean again.
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  it("ends a sale with salePrice: null", async () => {
    const rice = product("Basmati Rice 5 kg");
    const { user } = renderProduct(rice.id);
    await user.click(await screen.findByRole("radio", { name: "No sale" }));
    expect(screen.getByText(/Saving ends the sale of/)).toHaveTextContent(
      "€19.99",
    );
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}`,
          body: { salePrice: null },
        },
      ]),
    );
    expect(record(rice.id).salePrice).toBeNull();
    // The change shows up in the price history, with who made it.
    const history = screen.getByRole("region", { name: "Price history" });
    expect(
      await within(history).findByText("Sale of €19.99 ended"),
    ).toBeInTheDocument();
  });

  it("sends a discount as a percentage and no sale price with it", async () => {
    const rice = product("Basmati Rice 5 kg");
    const { user } = renderProduct(rice.id);
    await user.click(
      await screen.findByRole("radio", { name: "Discount in percent" }),
    );
    await user.type(field("discountPercent"), "25");
    expect(screen.getByText(/Customers will pay about/)).toHaveTextContent(
      "€18.74",
    );
    await user.click(saveButton());

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}`,
          body: { discountPercent: 25 },
        },
      ]),
    );
    expect(record(rice.id).salePrice).toBe(1874);
  });

  it("does not ask the API with a sale price that is not below the regular price", async () => {
    const rice = product("Basmati Rice 5 kg");
    const { user } = renderProduct(rice.id);
    const sale = await waitFor(() => field("salePrice"));
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

  it("shows an article number that is taken at its field and keeps what was typed", async () => {
    const dal = product("Toor Dal 1 kg");
    const taken = product("Moong Dal 1 kg");
    const { user, unhandled } = renderProduct(dal.id);
    const sku = await screen.findByLabelText(/^Article number/);
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
    expect(sku).toHaveAttribute("aria-invalid", "true");
    expect(field("brand")).toHaveValue("Heera");
    expect(record(dal.id).sku).toBe(dal.sku);
    // The field shows the error: no second report as a toast.
    expect(unhandled).toHaveLength(0);
  });

  it("keeps what was typed when the product changes underneath, and sends only that", async () => {
    const rice = product("Basmati Rice 5 kg");
    const { user } = renderProduct(rice.id);
    const name = await waitFor(() => field("name.en"));
    await user.clear(name);
    await user.type(name, "Basmati Rice Extra Long");

    // Meanwhile the product changes: someone renames the brand, and this
    // admin makes another pack size the default (which loads it again).
    record(rice.id).brand = "Daawat";
    await user.click(
      screen.getByRole("button", { name: "Make 1 kg the default pack size" }),
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
    const dal = product("Toor Dal 1 kg");
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
              en: ["Authentic quality", "Imported with each cargo"],
              de: ["Authentische Qualität", "Reich an Eiweiß"],
            },
          },
        },
      ]),
    );
  });

  it("shows the form to an admin who may only read, without a way to save", async () => {
    const dal = product("Toor Dal 1 kg");
    renderProduct(dal.id, READ_ONLY);
    const price = await screen.findByLabelText(/^Regular price/);
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
    const dal = product("Toor Dal 1 kg");
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

  it("deletes a draft that was never part of a cargo, after a confirmation", async () => {
    const paneer = product("Paneer 400 g");
    expect(paneer.status).toBe("draft");
    const { user } = renderProduct(paneer.id);
    const dialog = await chooseDelete(user);
    expect(
      within(dialog).getByRole("heading", {
        name: "Delete Paneer 400 g for good?",
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

  it("explains a product that was part of a cargo and offers to archive it", async () => {
    const dal = product("Toor Dal 1 kg");
    // A draft again, but cargos still refer to it.
    record(dal.id).status = "draft";
    const { user, unhandled } = renderProduct(dal.id);
    const dialog = await chooseDelete(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Delete the product" }),
    );

    const refusal = await screen.findByRole("heading", {
      name: "Toor Dal 1 kg cannot be deleted",
    });
    expect(refusal).toBeInTheDocument();
    expect(screen.getByText(/It was part of a cargo/)).toBeInTheDocument();
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

  it("says that an archived product of a cargo stays as it is", async () => {
    const dal = product("Toor Dal 1 kg");
    record(dal.id).status = "archived";
    const { user } = renderProduct(dal.id);
    const dialog = await chooseDelete(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Delete the product" }),
    );

    expect(
      await screen.findByText(/It is archived already/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive instead" }),
    ).not.toBeInTheDocument();
    expect(record(dal.id).status).toBe("archived");
  });
});

describe("the pack sizes of an article", () => {
  it("lists the group smallest first and marks the default", async () => {
    const rice = product("Basmati Rice 5 kg");
    renderProduct(rice.id);
    const panel = await screen.findByRole("region", { name: "Pack sizes" });
    const rows = await within(panel).findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("1 kg"),
      expect.stringContaining("5 kg"),
      expect.stringContaining("10 kg"),
    ]);
    expect(rows[1]).toHaveTextContent("Default");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(
      within(rows[0] as HTMLElement).getByRole("link", { name: "1 kg" }),
    ).toHaveAttribute(
      "href",
      `/catalogue/products/${product("Basmati Rice 1 kg").id}`,
    );
  });

  it("makes another pack size the default", async () => {
    const rice = product("Basmati Rice 5 kg");
    const small = product("Basmati Rice 1 kg");
    const { user } = renderProduct(rice.id);
    await user.click(
      await screen.findByRole("button", {
        name: "Make 1 kg the default pack size",
      }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/products/${small.id}/make-default`,
          body: undefined,
        },
      ]),
    );
    expect(record(small.id).isDefaultVariant).toBe(true);
    expect(record(rice.id).isDefaultVariant).toBe(false);
  });

  it("adds a pack size as a copy with its own size and price", async () => {
    const rice = product("Basmati Rice 5 kg");
    const { user } = renderProduct(rice.id);
    await user.click(
      await screen.findByRole("button", { name: "Add a pack size" }),
    );
    const dialog = await screen.findByRole("dialog");

    // A size the article has already is refused before the API is asked.
    await user.type(within(dialog).getByLabelText(/^Pack size/), "10");
    await user.type(within(dialog).getByLabelText(/^Regular price/), "9.49");
    await user.click(
      within(dialog).getByRole("button", { name: "Create the draft" }),
    );
    expect(
      await within(dialog).findByText(
        "Basmati Rice has this pack size already.",
      ),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);

    await user.clear(within(dialog).getByLabelText(/^Pack size/));
    await user.type(within(dialog).getByLabelText(/^Pack size/), "2");
    await user.click(
      within(dialog).getByRole("button", { name: "Create the draft" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/products/${rice.id}/duplicate`,
          body: {
            packSize: { value: 2, unit: "kg" },
            regularPrice: 949,
            asVariant: true,
            copyImages: true,
          },
        },
      ]),
    );
    const copy = api.mock
      .db()
      .products.find(
        (entry) =>
          entry.name.en === "Basmati Rice" && entry.packSize.value === 2,
      );
    expect(copy).toMatchObject({
      status: "draft",
      variantGroupId: record(rice.id).variantGroupId,
    });
  });

  it("separates a pack size only after a confirmation", async () => {
    const rice = product("Basmati Rice 5 kg");
    const { user } = renderProduct(rice.id);
    await user.click(await screen.findByRole("button", { name: "Separate" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Stay linked").nextSibling,
    ).toHaveTextContent("1 kg, 10 kg");
    expect(writes()).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "Separate 5 kg" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${rice.id}`,
          body: { variantOf: null },
        },
      ]),
    );
    expect(record(rice.id).variantGroupId).toBeNull();
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
    const rice = product("Basmati Rice 5 kg");
    renderPanel(<Pictures id={rice.id} />);
    await screen.findByRole("list", { name: "Pictures of Basmati Rice 5 kg" });

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
    const rice = product("Basmati Rice 5 kg");
    const stored = record(rice.id);
    const first = stored.images[0];
    if (!first) throw new Error("The demo product has no picture");
    stored.images = Array.from({ length: 11 }, (_, index) => ({
      ...first,
      id: index.toString(16).padStart(24, "a"),
      isPrimary: index === 0,
    }));
    renderPanel(<Pictures id={rice.id} />);
    await screen.findByRole("list", { name: "Pictures of Basmati Rice 5 kg" });

    drop([picture("a.jpg"), picture("b.jpg"), picture("c.jpg")]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "There is room for 1 more picture, and you chose 3. A product holds 12 at most.",
    );
    expect(writes()).toEqual([]);
  });

  it("says that an upload is stored as a whole or not at all", async () => {
    const rice = product("Basmati Rice 5 kg");
    renderPanel(<Pictures id={rice.id} />);
    expect(
      await screen.findByText(
        /if the API refuses one file of an upload, it stores none of them/,
      ),
    ).toBeInTheDocument();
  });

  it("moves a picture with the menu and sends every id in the new order", async () => {
    const rice = product("Basmati Rice 1 kg");
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
    const rice = product("Basmati Rice 1 kg");
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
    const rice = product("Basmati Rice 1 kg");
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
    const rice = product("Basmati Rice 1 kg");
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
    const rice = product("Basmati Rice 1 kg");
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
    const dal = product("Toor Dal 1 kg");
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

    renderProduct(product("Paneer 400 g").id);
    await screen.findByLabelText(/^Regular price/);
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
  function installUpload(mode: "works" | "fails") {
    class FakeUpload {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
        onprogress: null,
      };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 0;
      responseText = "";
      withCredentials = false;
      responseType = "";
      private method = "GET";
      private url = "";
      private headers: Record<string, string> = {};
      private response: Response | null = null;

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      }
      getResponseHeader(name: string) {
        return this.response?.headers.get(name) ?? null;
      }
      abort() {
        this.onabort?.();
      }
      send(body: FormData) {
        void (async () => {
          if (mode === "fails") {
            this.onerror?.();
            return;
          }
          const boundary = "----panel-test-upload";
          const encoder = new TextEncoder();
          const parts: Uint8Array[] = [];
          for (const [name, value] of body.entries()) {
            if (typeof value === "string") continue;
            parts.push(
              encoder.encode(
                `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\nContent-Type: ${value.type}\r\n\r\n`,
              ),
            );
            parts.push(new Uint8Array(await value.arrayBuffer()));
            parts.push(encoder.encode("\r\n"));
          }
          parts.push(encoder.encode(`--${boundary}--\r\n`));
          const bytes = new Uint8Array(
            parts.reduce((sum, part) => sum + part.length, 0),
          );
          let offset = 0;
          for (const part of parts) {
            bytes.set(part, offset);
            offset += part.length;
          }
          // Node's multipart parser makes its files with the page's `File`
          // (jsdom's here) and then does not recognise them: it gets Node's
          // own class while the mock reads the request.
          const pageFile = globalThis.File;
          globalThis.File = NodeFile as unknown as typeof File;
          let response: Response;
          try {
            response = await fetch(this.url, {
              method: this.method,
              headers: {
                ...this.headers,
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
              },
              body: bytes,
            });
          } finally {
            globalThis.File = pageFile;
          }
          this.response = response;
          this.status = response.status;
          this.responseText = await response.text();
          this.onload?.();
        })();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeUpload);
  }

  async function fillNewProduct(user: ReturnType<typeof renderPanel>["user"]) {
    await screen.findByText("Create product", { selector: "button" });
    await user.type(field("name.en"), "Moong Dal");
    const select = document.querySelector<HTMLSelectElement>(
      '[name="categoryId"]',
    );
    const option = select?.options[1];
    if (!select || !option) throw new Error("No category to choose");
    await user.selectOptions(select, option.value);
    await user.type(field("packSize.value"), "500");
    await user.type(field("regularPrice"), "3.49");
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
        "2 pictures stored. It is a draft: set it active when it is ready.",
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
