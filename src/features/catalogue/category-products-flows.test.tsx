// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Category, ListResult, ProductSummary } from "@/lib/api/types";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel, testNavigation } from "@/test/render";
import { CategoriesView } from "./categories-view";
import { CategoryProductsView } from "./category-products-view";
import { ProductNewView } from "./product-new-view";

let api: TestApi;
let categories: Category[];
/** A category with several products directly in it and no sub-categories. */
let pulses: Category;
/** Its products, as the API orders them. */
let direct: ProductSummary[];

const READ_ONLY = ["catalog.read"];

/** The requests that change something. */
const writes = () => api.calls.filter((call) => call.method !== "GET");

function category(name: string): Category {
  const found = categories.find((entry) => entry.name.en === name);
  if (!found) throw new Error(`No category "${name}" in the demo data`);
  return found;
}

/** The products directly in a category, as the API orders them. */
const productsOf = async (id: string) =>
  (
    await api.request<ListResult<ProductSummary>>(
      "GET",
      `/v1/admin/categories/${id}/products`,
    )
  ).items;

/** `[name, position]` of the products directly in a category, by position. */
const positionsIn = (id: string) =>
  api.mock
    .db()
    .products.filter((product) => product.categoryId === id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((product) => [product.name.en, product.sortOrder]);

function renderOrder(id: string, permissions?: string[]) {
  return renderPanel(<CategoryProductsView />, {
    path: `/catalogue/categories/${id}/products`,
    params: { id },
    permissions,
  });
}

const rows = async (name = "Pulses") =>
  within(
    await screen.findByRole("list", {
      name: `Products of ${name} in display order`,
    }),
  ).getAllByRole("listitem");

const positionField = (name: string) =>
  screen.getByRole("textbox", { name: `Position of ${name}` });

function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  categories = (
    await api.request<ListResult<Category>>("GET", "/v1/admin/categories")
  ).items;
  pulses = category("Pulses");
  direct = await productsOf(pulses.id);
  expect(direct.length).toBeGreaterThan(2);
  api.calls.length = 0;
});

describe("the product order of a category", () => {
  it("lists the products directly in the category with their place, status and pack sizes", async () => {
    renderOrder(pulses.id);
    expect(
      await screen.findByRole("heading", { name: "Product order: Pulses" }),
    ).toBeInTheDocument();
    const items = await rows();
    expect(items).toHaveLength(direct.length);
    direct.forEach((product, index) => {
      const row = items[index]!;
      expect(row).toHaveTextContent(product.name.en);
      expect(
        within(row).getByRole("textbox", {
          name: `Position of ${product.name.en}`,
        }),
      ).toHaveValue(String(index + 1));
      expect(row).toHaveTextContent(product.variants[0]!.packSize.label);
    });
    expect(positionsIn(pulses.id).map(([, position]) => position)).toEqual(
      direct.map((_, index) => index),
    );
    expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled();
    expect(
      screen.queryByText(/Sub-categories have an order of their own/),
    ).not.toBeInTheDocument();
  });

  it("links the sub-categories, each with an order of its own, where the products are below", async () => {
    const rice = category("Rice & Grains");
    expect(await productsOf(rice.id)).toEqual([]);
    renderOrder(rice.id);
    expect(
      await screen.findByRole("heading", {
        name: "Product order: Rice & Grains",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Sub-categories have an order of their own"),
    ).toBeInTheDocument();
    const child = categories.find((entry) => entry.parentId === rice.id)!;
    expect(screen.getByRole("link", { name: child.name.en })).toHaveAttribute(
      "href",
      `/catalogue/categories/${child.id}/products`,
    );
    expect(
      await screen.findByText("No products directly in Rice & Grains"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save order" }),
    ).not.toBeInTheDocument();
  });

  it("moves a product by its typed place and saves the whole list, which the API answers in its new order", async () => {
    const last = direct[direct.length - 1]!;
    const { user } = renderOrder(pulses.id);
    await rows();

    const input = positionField(last.name.en);
    await user.clear(input);
    await user.type(input, "1{Enter}");
    expect((await rows())[0]).toHaveTextContent(last.name.en);
    expect(input).toHaveValue("1");
    expect(
      screen.getByText(/The new order is not saved yet\./),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Save order" }));
    const expected = [last.id, ...direct.slice(0, -1).map((p) => p.id)];
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          path: `/v1/admin/categories/${pulses.id}/products/order`,
          body: { orderedIds: expected },
        },
      ]),
    );
    expect(await screen.findByText("Order saved")).toBeInTheDocument();
    expect(positionsIn(pulses.id)).toEqual([
      [last.name.en, 0],
      ...direct.slice(0, -1).map((p, index) => [p.name.en, index + 1]),
    ]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled(),
    );
    expect((await rows())[0]).toHaveTextContent(last.name.en);
  });

  it("puts a typed place that does not exist back, and lets the admin discard the draft", async () => {
    const first = direct[0]!;
    const { user } = renderOrder(pulses.id);
    await rows();
    const input = positionField(first.name.en);
    await user.clear(input);
    await user.type(input, "99{Enter}");
    expect(input).toHaveValue("1");
    expect((await rows())[0]).toHaveTextContent(first.name.en);

    await user.clear(input);
    await user.type(input, "2");
    fireEvent.blur(input);
    expect((await rows())[1]).toHaveTextContent(first.name.en);
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect((await rows())[0]).toHaveTextContent(first.name.en);
    expect(writes()).toEqual([]);
  });

  it("tells the admin which product left the category in the meantime and loads the list again", async () => {
    const tea = category("Tea & Beverages");
    const moved = direct[1]!;
    const { user } = renderOrder(pulses.id);
    await rows();
    // Another admin moves a product to another category while the order is being edited.
    await api.request("PATCH", `/v1/admin/products/${moved.id}`, {
      categoryId: tea.id,
    });
    api.calls.length = 0;

    const input = positionField(moved.name.en);
    await user.clear(input);
    await user.type(input, "1{Enter}");
    await user.click(screen.getByRole("button", { name: "Save order" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The order was not saved");
    expect(alert).toHaveTextContent(
      `${moved.name.en} is no longer in Pulses: moved or deleted in the meantime.`,
    );
    await waitFor(async () =>
      expect(await rows()).toHaveLength(direct.length - 1),
    );
    expect(screen.queryByText(moved.name.en)).not.toBeInTheDocument();
    // The moved product took the last place of its new category.
    const inTea = positionsIn(tea.id);
    expect(inTea[inTea.length - 1]).toEqual([moved.name.en, inTea.length - 1]);
  });

  it("accepts a partial order from the API's side: the named products first, the rest keeps its order", async () => {
    const third = direct[2]!;
    const answer = await api.request<ListResult<ProductSummary>>(
      "PUT",
      `/v1/admin/categories/${pulses.id}/products/order`,
      { orderedIds: [third.id] },
    );
    expect(answer.items.map((p) => p.id)).toEqual([
      third.id,
      ...direct.filter((p) => p.id !== third.id).map((p) => p.id),
    ]);
    expect(answer.items.map((p) => p.sortOrder)).toEqual(
      direct.map((_, index) => index),
    );
  });

  it("shows the order without handles or fields to an admin without catalog.manage", async () => {
    renderOrder(pulses.id, READ_ONLY);
    const items = await rows();
    expect(items).toHaveLength(direct.length);
    expect(items[0]).toHaveTextContent("1");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Move / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save order" }),
    ).not.toBeInTheDocument();
  });

  it("is reached from the actions of a category", async () => {
    const { user } = renderPanel(<CategoriesView />);
    await user.click(
      await screen.findByRole("button", { name: "Actions for Pulses" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Product order" }),
    );
    expect(testNavigation.history).toEqual([
      `/catalogue/categories/${pulses.id}/products`,
    ]);
  });
});

describe("how the shop lists the pack sizes", () => {
  it("is chosen on the category form and saved with the category", async () => {
    const { user } = renderPanel(<CategoriesView />);
    await user.click(
      await screen.findByRole("button", { name: "Actions for Rice & Grains" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByRole("combobox", {
      name: "How the shop lists the pack sizes",
    });
    expect(select).toHaveValue("variants_by_size");
    expect(select).toHaveAccessibleDescription(/rounds/);
    await user.selectOptions(select, "variants_by_product");
    expect(select).toHaveAccessibleDescription(
      /the sizes of a product together/,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    const rice = category("Rice & Grains");
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/categories/${rice.id}`,
          body: { listingView: "variants_by_product" },
        },
      ]),
    );
    expect(
      api.mock.db().categories.find((entry) => entry.id === rice.id)
        ?.listingView,
    ).toBe("variants_by_product");
  });
});

describe("the position of a product in its category", () => {
  it("is optional on a new product: without one the API puts it last", async () => {
    const { user } = renderPanel(<ProductNewView />, {
      path: "/catalogue/products/new",
    });
    const position = await screen.findByLabelText(/^Position in its category/);
    expect(position).toHaveValue("");
    expect(position).toHaveAttribute("placeholder", "Last");
    await user.type(field("name.en"), "Horse Gram");
    await user.selectOptions(field("categoryId"), pulses.id);
    await user.type(field("variants.0.packSize.value"), "500");
    await user.type(field("variants.0.regularPrice"), "3.49");
    await user.type(field("vatRate"), "7");
    await user.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() =>
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /v1/admin/products",
      ]),
    );
    expect(
      (writes()[0]!.body as { sortOrder?: number }).sortOrder,
    ).toBeUndefined();
    const after = positionsIn(pulses.id);
    expect(after[after.length - 1]).toEqual(["Horse Gram", direct.length]);
  });
});
