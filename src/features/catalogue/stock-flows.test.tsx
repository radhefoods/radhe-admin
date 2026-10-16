// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductRecord, VariantRecord } from "../../../mocks/db.ts";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { ProductView } from "./product-view";
import { ProductsView } from "./products-view";

let api: TestApi;

vi.setConfig({ testTimeout: 30_000 });

type Size = { product: ProductRecord; variant: VariantRecord };

/** Every pack size of the demo data with its product. */
const sizes = (): Size[] =>
  api.mock
    .db()
    .products.flatMap((product) =>
      product.variants.map((variant) => ({ product, variant })),
    );

function find(predicate: (size: Size) => boolean, what: string): Size {
  const found = sizes().find(predicate);
  if (!found) throw new Error(`The demo data has no ${what}`);
  return found;
}
const fresh = (variantId: string) =>
  find(({ variant }) => variant.id === variantId, "pack size").variant;
/** An active product with one pack size, a comfortable count and no threshold. */
const plenty = ({ product, variant }: Size) =>
  product.status === "active" &&
  product.variants.length === 1 &&
  variant.stock.quantity >= 20 &&
  variant.stock.lowStockThreshold === null;

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

const stockPath = (size: Size) =>
  `/v1/admin/products/${size.product.id}/variants/${size.variant.id}/stock`;

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

describe("the stock panel (documentation, 8)", () => {
  it("shows the count and the history of the pack size, and sets the counted number", async () => {
    const size = find(plenty, "product with plenty of stock");
    const before = size.variant.stock.quantity;
    const { user } = await open(size.product);
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
        { method: "POST", path: stockPath(size), body: { quantity: 30 } },
      ]),
    );
    expect(fresh(size.variant.id).stock.quantity).toBe(30);
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
    const size = find(plenty, "product with plenty of stock");
    const before = size.variant.stock.quantity;
    const { user } = await open(size.product);
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
          path: stockPath(size),
          body: { delta: 12, note: "Delivery from the importer" },
        },
      ]),
    );
    expect(fresh(size.variant.id).stock.quantity).toBe(before + 12);
    const movement = api.mock
      .db()
      .stockMovements.filter((entry) => entry.variantId === size.variant.id)
      .at(-1);
    expect(movement?.reason).toBe("restock");
    expect(movement?.note).toBe("Delivery from the importer");
    expect(movement?.sku).toBe(size.variant.sku);
  });

  it("refuses to remove more than there is before asking the API", async () => {
    const size = find(plenty, "product with plenty of stock");
    const { user } = await open(size.product);
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
        `Only ${size.variant.stock.quantity} units are in stock; 9999 cannot be removed.`,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save the stock" }),
    ).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("shows one pack size at a time of a product with several, and changes the one chosen", async () => {
    const size = find(
      ({ product }) =>
        product.status === "active" && product.variants.length > 1,
      "product with several pack sizes",
    );
    const { product } = size;
    const { user } = await open(product);
    const panel = screen.getByRole("region", { name: "Stock" });
    const chooser = within(panel).getByRole("combobox", { name: "Pack size" });
    // The pack size that stands for the product is shown first.
    const shown = product.variants.find(
      (entry) => entry.id === (chooser as HTMLSelectElement).value,
    );
    expect(shown).toBeDefined();
    const other = product.variants.find((entry) => entry.id !== shown?.id)!;
    await user.selectOptions(chooser, other.id);
    expect(
      within(panel).getByText(`In stock, ${other.packSize.label}`),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContainEqual(
        expect.stringContaining(`/variants/${other.id}/stock/movements`),
      ),
    );

    await user.click(
      within(panel).getByRole("button", { name: "Change the stock" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      `Change the stock of ${product.name.en} ${other.packSize.label}`,
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Counted number" }),
      "77",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Set the stock to 77" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          path: `/v1/admin/products/${product.id}/variants/${other.id}/stock`,
          body: { quantity: 77 },
        },
      ]),
    );
    expect(fresh(other.id).stock.quantity).toBe(77);
    // The other pack sizes are not touched.
    expect(fresh(shown!.id).stock.quantity).toBe(shown!.stock.quantity);
  });

  it("opens the same dialog from the row of the pack-size table", async () => {
    const size = find(plenty, "product with plenty of stock");
    const { user } = await open(size.product);
    const table = screen.getByRole("list", { name: "Pack sizes" });
    await user.click(
      within(table).getByRole("button", {
        name: `Change the stock of ${size.variant.packSize.label}`,
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Counted number" }),
      "41",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Set the stock to 41" }),
    );
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "POST", path: stockPath(size), body: { quantity: 41 } },
      ]),
    );
    await waitFor(() => expect(table).toHaveTextContent("41"));
  });

  it("keeps the change visible but disabled for a read-only role", async () => {
    const size = find(plenty, "product with plenty of stock");
    await open(size.product, ["catalog.read"]);
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

describe("the threshold in the pack-size table", () => {
  it("saves the threshold of the pack size, and sends null when it is emptied", async () => {
    const size = find(
      ({ product, variant }) =>
        product.status === "active" &&
        product.variants.length === 1 &&
        variant.stock.lowStockThreshold !== null,
      "product with a threshold",
    );
    const { user } = await open(size.product);
    const threshold = field("variants.0.lowStockThreshold");
    expect(threshold).toHaveValue(String(size.variant.stock.lowStockThreshold));
    await user.clear(threshold);
    await user.type(threshold, "25");
    await user.click(screen.getByText("Save changes", { selector: "button" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${size.product.id}/variants/${size.variant.id}`,
          body: { lowStockThreshold: 25 },
        },
      ]),
    );
    expect(fresh(size.variant.id).stock.lowStockThreshold).toBe(25);

    api.calls.length = 0;
    await user.clear(field("variants.0.lowStockThreshold"));
    await user.click(screen.getByText("Save changes", { selector: "button" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `/v1/admin/products/${size.product.id}/variants/${size.variant.id}`,
          body: { lowStockThreshold: null },
        },
      ]),
    );
    expect(fresh(size.variant.id).stock.lowStockThreshold).toBeNull();
  });
});

describe("the product list", () => {
  it("shows the count over the pack sizes with the low state and filters the products running low", async () => {
    const low = api.mock
      .db()
      .products.filter((product) =>
        product.variants.some(
          (variant) =>
            variant.stock.lowStockThreshold !== null &&
            variant.stock.quantity <= variant.stock.lowStockThreshold,
        ),
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
      const row = (
        await within(table).findByRole("link", { name: product.name.en })
      ).closest("tr");
      const total = product.variants.reduce(
        (sum, variant) => sum + variant.stock.quantity,
        0,
      );
      const lowSizes = product.variants.filter(
        (variant) =>
          variant.stock.lowStockThreshold !== null &&
          variant.stock.quantity <= variant.stock.lowStockThreshold,
      ).length;
      expect(row).toHaveTextContent(String(total));
      expect(row).toHaveTextContent(
        total === 0
          ? "Sold out"
          : lowSizes === 1
            ? "Low stock"
            : `${lowSizes} sizes low`,
      );
    }
    // The filter shows as chosen, so it can be taken off again.
    expect(screen.getByRole("button", { name: /^Stock/ })).toHaveTextContent(
      "Running low",
    );
  });
});
