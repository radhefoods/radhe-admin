// @vitest-environment jsdom
import { configure, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { priceFromCost as mockPrice } from "../../../mocks/pricing.ts";
import { CategoriesView } from "@/features/catalogue/categories-view";
import { ProductNewView } from "@/features/catalogue/product-new-view";
import { ProductView } from "@/features/catalogue/product-view";
import { OrderCostsSection } from "@/features/settings/order-costs-section";
import { PricingSection } from "@/features/settings/pricing-section";
import { SettingsFrame } from "@/features/settings/settings-frame";
import type { PriceRule } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";

// The pages of a product and of the settings are long, and the machine may
// be busy with other work.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 40_000 });

let api: TestApi;

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
});

const SHOP: PriceRule = {
  fulfilmentPercent: 10,
  extraPercent: 0,
  extraAmount: 0,
  markupPercent: 35,
};

const writes = () => api.calls.filter((call) => call.method !== "GET");

function field(name: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!found) throw new Error(`No field "${name}" on the page`);
  return found;
}

/** A product of the demo data as the mock stores it. */
function record(name: string) {
  const found = api.mock.db().products.find((entry) => entry.name.en === name);
  if (!found) throw new Error(`No product "${name}" in the demo data`);
  return found;
}

function renderPricing(permissions?: string[]) {
  return renderPanel(
    <SettingsFrame>
      <PricingSection />
    </SettingsFrame>,
    { path: "/settings/pricing", permissions },
  );
}

function renderProduct(name: string) {
  const { id } = record(name);
  return renderPanel(<ProductView />, {
    path: `/catalogue/products/${id}`,
    params: { id },
  });
}

/** The row of a pack size in the form of a product. */
function packRow(label: string): HTMLElement {
  const table = screen.getByRole("list", { name: "Pack sizes" });
  const row = Array.from(table.children).find(
    (child) => child.getAttribute("aria-label") === label,
  );
  if (!(row instanceof HTMLElement)) throw new Error(`No pack size ${label}`);
  return row;
}

/** The amount next to a label of one of the lists of the pricing block. */
function valueOf(list: HTMLElement, label: string | RegExp): string {
  const term = within(list).getByText(label, { selector: "dt" });
  return term.closest("div")?.querySelector("dd")?.textContent ?? "";
}

describe("Settings: pricing and supplier", () => {
  it("shows the rule of the shop with an example that follows the inputs", async () => {
    const { user } = renderPricing();
    await screen.findByRole("button", { name: "Save the pricing" });
    expect(field("fulfilmentPercent")).toHaveValue("10");
    expect(field("extraPercent")).toHaveValue("0");
    expect(field("extraAmount")).toHaveValue("0.00");
    expect(field("markupPercent")).toHaveValue("35");
    expect(field("safetyUnits")).toHaveValue("5");

    // The example of the documentation: 1.38 at 7 % gives 2.19.
    const example = screen.getByLabelText("Example of a calculated price");
    expect(valueOf(example, "Buying price")).toBe("€1.38");
    expect(valueOf(example, "Fulfilment cost (10 %)")).toBe("€0.138");
    expect(valueOf(example, "Markup (35 %)")).toBe("€0.5313");
    expect(valueOf(example, "Price before VAT")).toBe("€2.0493");
    expect(valueOf(example, "VAT (7 %)")).toBe("€0.1435");
    expect(valueOf(example, "Selling price")).toBe("€2.19");
    expect(within(example).queryByText("Other expenses")).toBeNull();

    await user.clear(field("markupPercent"));
    await user.type(field("markupPercent"), "50");
    await user.clear(field("extraAmount"));
    await user.type(field("extraAmount"), "0.10");
    const typed = mockPrice(
      138,
      { ...SHOP, markupPercent: 50, extraAmount: 10 },
      700,
    );
    const now = screen.getByLabelText("Example of a calculated price");
    expect(valueOf(now, "Markup (50 %)")).toBe("€0.809");
    expect(valueOf(now, "Other expenses")).toBe("€0.10");
    expect(valueOf(now, "Selling price")).toBe(formatMoney(typed.price));
    expect(writes()).toEqual([]);
  });

  it("asks before a changed rule is saved, and says how many prices changed", async () => {
    const masala = record("Garam Masala").variants[0]!;
    expect(masala.priceMode).toBe("auto");
    const before = masala.regularPrice;
    const byHand = record("Basmati Rice").variants[0]!;
    const byHandPrice = byHand.regularPrice;

    const { user } = renderPricing();
    const save = await screen.findByRole("button", {
      name: "Save the pricing",
    });
    await user.clear(field("markupPercent"));
    await user.type(field("markupPercent"), "40");
    await user.click(save);

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Change the price rule of the shop?",
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Markup").nextSibling).toHaveTextContent(
      "35 % → 40 %",
    );
    // Only what changed is listed.
    expect(within(dialog).queryByText("Fulfilment cost")).toBeNull();
    expect(writes()).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", {
        name: "Save and recalculate the prices",
      }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    // The brand list is not sent: it stays as it is.
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/v1/admin/supply/settings",
      body: {
        safetyUnits: 5,
        pricing: { ...SHOP, markupPercent: 40 },
        publishCheck: true,
      },
    });
    // The three demo products whose price follows the buying price.
    expect(
      await screen.findByText("3 calculated prices changed."),
    ).toBeInTheDocument();
    expect(masala.regularPrice).toBe(
      mockPrice(masala.cost!, { ...SHOP, markupPercent: 40 }, 700).price,
    );
    expect(masala.regularPrice).not.toBe(before);
    // A price set by hand stays.
    expect(byHand.regularPrice).toBe(byHandPrice);
    await waitFor(() => expect(save).toBeDisabled());
  });

  it("saves the safety buffer and the check before activation without asking", async () => {
    const { user } = renderPricing();
    const save = await screen.findByRole("button", {
      name: "Save the pricing",
    });
    await user.clear(field("safetyUnits"));
    await user.type(field("safetyUnits"), "8");
    await user.click(
      screen.getByRole("switch", { name: "Check before activation" }),
    );
    await user.click(save);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(writes()[0]?.body).toEqual({
      safetyUnits: 8,
      pricing: SHOP,
      publishCheck: false,
    });
    expect(
      await screen.findByText("No calculated price changed."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Applies from the next upload of the supplier's file/),
    ).toBeInTheDocument();
  });

  it("does not send a value the API would refuse", async () => {
    const { user } = renderPricing();
    const save = await screen.findByRole("button", {
      name: "Save the pricing",
    });
    await user.clear(field("markupPercent"));
    await user.type(field("markupPercent"), "1001");
    await user.click(save);
    expect(
      await screen.findByText(
        "A percentage from 0 to 1000 with at most two decimals. Example: 35",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The example follows once the four values are complete.",
      ),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("saves the brand list by itself, with the rule as it is saved", async () => {
    const { user } = renderPricing();
    const save = await screen.findByRole("button", {
      name: "Save the brand list",
    });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Prefix of AB")).toHaveValue("AB");
    expect(screen.getByLabelText("Brand of AB")).toHaveValue("AliBaba");
    // An empty brand says the prefix is not a brand.
    expect(screen.getByLabelText("Brand of NW Pooja")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Add a prefix" }));
    await user.type(screen.getByLabelText("Prefix of the new prefix"), "ab");
    expect(
      screen.getByText("This prefix is in the list already."),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();

    const prefix = screen.getByLabelText("Prefix of ab");
    await user.clear(prefix);
    await user.type(prefix, "Hald");
    await user.type(screen.getByLabelText("Brand of Hald"), "Haldiram");
    await user.click(screen.getByRole("button", { name: "Remove KRG" }));
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/v1/admin/supply/settings",
      body: {
        safetyUnits: 5,
        pricing: SHOP,
        brands: [
          { prefix: "Hald", name: "Haldiram" },
          { prefix: "AB", name: "AliBaba" },
          { prefix: "Britania", name: "Britannia" },
          { prefix: "NW Pooja", name: "" },
        ],
      },
    });
    expect(await screen.findByText("Brand list saved")).toBeInTheDocument();
    await waitFor(() => expect(save).toBeDisabled());
  });

  it("is read-only for a role that may only read the catalogue, with its tab alone", async () => {
    renderPricing(["catalog.read"]);
    const save = await screen.findByRole("button", {
      name: "Save the pricing",
    });
    expect(save).toBeDisabled();
    expect(field("markupPercent")).toBeDisabled();
    expect(
      screen.getAllByLabelText(
        'Your role does not include "Catalogue: manage".',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Add a prefix" }),
    ).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", {
      name: "Sections of the shop settings",
    });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/settings/pricing"]);
    expect(api.calls.map((call) => call.path)).toEqual([
      "/v1/admin/supply/settings",
    ]);
  });

  it("stays shut without the right to read the catalogue", async () => {
    renderPricing(["settings.read", "finance.read"]);
    expect(
      await screen.findByText("Your role does not open this page"),
    ).toBeInTheDocument();
    expect(
      api.calls.some((call) => call.path.startsWith("/v1/admin/supply")),
    ).toBe(false);
  });

  it("is linked from the order costs", async () => {
    renderPanel(
      <SettingsFrame>
        <OrderCostsSection />
      </SettingsFrame>,
      { path: "/settings/order-costs" },
    );
    await screen.findByRole("button", { name: "Save the order costs" });
    // The sentence under the form, not the tab of the same name.
    const sentence = screen
      .getByText(/Product prices are calculated on the page/)
      .closest("li") as HTMLElement;
    expect(
      within(sentence).getByRole("link", { name: "Pricing & supplier" }),
    ).toHaveAttribute("href", "/settings/pricing");
  });
});

describe("the pricing of a product", () => {
  it("shows how the price of a pack size is calculated and what it earns", async () => {
    const masala = record("Garam Masala").variants[0]!;
    const steps = mockPrice(masala.cost!, SHOP, 700);
    expect(steps.price).toBe(masala.regularPrice);
    renderProduct("Garam Masala");
    const panel = await screen.findByRole("region", { name: "Pricing" });
    const calculation = await within(panel).findByLabelText(
      "How the price is calculated",
    );
    expect(
      within(panel).getByText("Follows the buying price"),
    ).toBeInTheDocument();
    expect(valueOf(calculation, "Fulfilment cost (10 %, the shop)")).not.toBe(
      "",
    );
    expect(valueOf(calculation, "Markup (35 %, the shop)")).not.toBe("");
    expect(valueOf(calculation, "VAT (7 %)")).not.toBe("");
    expect(valueOf(calculation, "Calculated price")).toBe(
      formatMoney(masala.regularPrice),
    );
    const earns = within(panel).getByLabelText(
      "What customers pay and what it earns",
    );
    expect(valueOf(earns, "Customers pay now")).toBe(
      formatMoney(masala.regularPrice),
    );
    // 35 % on the costs, give or take the rounding to the cent.
    expect(valueOf(earns, "As a markup on the costs")).toMatch(
      /^3[45](\.\d+)? %$/,
    );
    expect(valueOf(earns, "As a margin of the price")).toMatch(
      /^2[56](\.\d+)? %$/,
    );
    expect(writes()).toEqual([]);
  });

  it("says when a price is set by hand, and when no buying price is known", async () => {
    const view = renderProduct("Basmati Rice");
    let panel = await screen.findByRole("region", { name: "Pricing" });
    expect(
      await within(panel).findByText("Price set by hand"),
    ).toBeInTheDocument();
    view.unmount();

    renderProduct("Jaggery Powder");
    panel = await screen.findByRole("region", { name: "Pricing" });
    expect(
      await within(panel).findByText(/No buying price is known/),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByLabelText("How the price is calculated"),
    ).toBeNull();
  });

  it("lets a product set its own markup, and the calculated price follows", async () => {
    const product = record("Garam Masala");
    const masala = product.variants[0]!;
    const { user } = renderProduct("Garam Masala");
    const panel = await screen.findByRole("region", { name: "Pricing" });
    const form = await within(panel).findByRole("form", {
      name: "Price rule of this product",
    });
    // Under an empty field: what counts instead, and who sets it.
    expect(
      await within(form).findByText("Empty: 35 % from the shop."),
    ).toBeInTheDocument();
    const save = within(form).getByRole("button", {
      name: "Save the price rule",
    });
    expect(save).toBeDisabled();

    await user.type(field("markupPercent"), "50");
    await user.click(save);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/products/${product.id}`,
      body: { pricing: { markupPercent: 50 } },
    });
    const price = mockPrice(
      masala.cost!,
      { ...SHOP, markupPercent: 50 },
      700,
    ).price;
    expect(masala.regularPrice).toBe(price);
    // The block is loaded again with the product.
    await waitFor(() =>
      expect(
        valueOf(
          within(panel).getByLabelText("How the price is calculated"),
          "Markup (50 %, this product)",
        ),
      ).not.toBe(""),
    );
    expect(
      valueOf(
        within(panel).getByLabelText("How the price is calculated"),
        "Calculated price",
      ),
    ).toBe(formatMoney(price));

    // Emptied again: the override is removed with `null`.
    api.calls.length = 0;
    await user.clear(field("markupPercent"));
    await user.click(save);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({ pricing: null });
    expect(product.pricing).toBeNull();
  });
});

describe("the buying price and the price mode of a pack size", () => {
  const saveButton = () =>
    screen.getByText("Save changes", { selector: "button" });

  it("hands a price set by hand to the calculation, without sending a price", async () => {
    const product = record("Basmati Rice");
    const one = product.variants.find(
      (entry) => entry.packSize.label === "1 kg",
    )!;
    expect(one.priceMode).toBe("manual");
    const { user } = renderProduct("Basmati Rice");
    await waitFor(() => field("variants.0.regularPrice"));
    const row = packRow("1 kg");
    expect(field("variants.0.regularPrice")).not.toHaveAttribute("readonly");

    await user.click(
      within(row).getByRole("switch", {
        name: "Price follows the buying price",
      }),
    );
    // The price is the calculation's now: shown, not typed.
    expect(field("variants.0.regularPrice")).toHaveAttribute("readonly");
    const price = mockPrice(one.cost!, SHOP, 700).price;
    expect(
      await within(row).findByText(
        `Calculated. After saving: about ${formatMoney(price)}.`,
      ),
    ).toBeInTheDocument();

    await user.click(saveButton());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/products/${product.id}/variants/${one.id}`,
      body: { priceMode: "auto" },
    });
    expect(one.regularPrice).toBe(price);
    await waitFor(() =>
      expect(field("variants.0.regularPrice")).toHaveValue(
        (price / 100).toFixed(2),
      ),
    );
  });

  it("sends a new buying price alone, and the API calculates the price", async () => {
    const product = record("Garam Masala");
    const masala = product.variants[0]!;
    const { user } = renderProduct("Garam Masala");
    await waitFor(() => field("variants.0.cost"));
    expect(field("variants.0.regularPrice")).toHaveAttribute("readonly");

    await user.clear(field("variants.0.cost"));
    await user.type(field("variants.0.cost"), "1.50");
    const price = mockPrice(150, SHOP, 700).price;
    expect(
      await screen.findByText(
        `Calculated. After saving: about ${formatMoney(price)}.`,
      ),
    ).toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/products/${product.id}/variants/${masala.id}`,
      body: { cost: 150 },
    });
    expect(masala.regularPrice).toBe(price);
  });

  it("takes the pack size back from the calculation with the price as typed", async () => {
    const product = record("Garam Masala");
    const masala = product.variants[0]!;
    const { user } = renderProduct("Garam Masala");
    await waitFor(() => field("variants.0.cost"));
    await user.click(
      screen.getByRole("switch", { name: "Price follows the buying price" }),
    );
    expect(field("variants.0.regularPrice")).not.toHaveAttribute("readonly");
    await user.clear(field("variants.0.regularPrice"));
    await user.type(field("variants.0.regularPrice"), "3.49");
    await user.click(saveButton());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({
      priceMode: "manual",
      regularPrice: 349,
    });
    expect(masala.priceMode).toBe("manual");
    expect(masala.regularPrice).toBe(349);
  });

  it("creates a pack size whose price is calculated from its buying price", async () => {
    const { user } = renderPanel(<ProductNewView />, {
      path: "/catalogue/products/new",
    });
    await screen.findByText("Create product", { selector: "button" });
    await user.type(field("name.en"), "Fennel Seeds");
    const select = document.querySelector<HTMLSelectElement>(
      '[name="categoryId"]',
    );
    const option = select?.options[1];
    if (!select || !option) throw new Error("No category to choose");
    await user.selectOptions(select, option.value);
    await user.type(field("variants.0.packSize.value"), "100");
    await user.type(field("vatRate"), "7");
    await user.type(field("variants.0.cost"), "1.38");
    await user.click(
      screen.getByRole("switch", { name: "Price follows the buying price" }),
    );
    // The rule of the shop: 1.38 at 7 % gives 2.19.
    await waitFor(() =>
      expect(field("variants.0.regularPrice")).toHaveValue("2.19"),
    );
    expect(field("variants.0.regularPrice")).toHaveAttribute("readonly");

    await user.click(
      screen.getByText("Create product", { selector: "button" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = writes()[0]?.body as { variants: unknown[] };
    expect(body.variants).toEqual([
      {
        packSize: { value: 100, unit: "g" },
        regularPrice: 219,
        cost: 138,
        priceMode: "auto",
      },
    ]);
    const created = record("Fennel Seeds").variants[0]!;
    expect(created.priceMode).toBe("auto");
    expect(created.cost).toBe(138);
    expect(created.regularPrice).toBe(219);
  });
});

describe("the price rule of a category", () => {
  it("sets a markup and the kind of goods for a category, and the prices below follow", async () => {
    const category = api.mock
      .db()
      .categories.find((entry) => entry.name.en === "Ground Spices");
    if (!category) throw new Error("No category Ground Spices");
    const masala = record("Garam Masala").variants[0]!;
    expect(record("Garam Masala").categoryId).toBe(category.id);

    const { user } = renderPanel(<CategoriesView />);
    await user.click(
      await screen.findByRole("button", { name: "Actions for Ground Spices" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const section = within(dialog).getByRole("region", {
      name: "Prices and kind of goods",
    });
    expect(
      await within(section).findByText("Empty: 35 % from the shop."),
    ).toBeInTheDocument();
    await user.type(field("pricing.markupPercent"), "40");
    await user.click(
      within(section).getByRole("switch", { name: "Goods that are not food" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/categories/${category.id}`,
      body: { nonFood: true, pricing: { markupPercent: 40 } },
    });
    expect(category.nonFood).toBe(true);
    expect(category.pricing).toEqual({ markupPercent: 40 });
    expect(masala.regularPrice).toBe(
      mockPrice(masala.cost!, { ...SHOP, markupPercent: 40 }, 700).price,
    );
    expect(
      await screen.findByText(
        "The prices below it that follow a buying price were calculated again.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the price rule of a pack size", () => {
  const saveButton = () =>
    screen.getByText("Save changes", { selector: "button" });

  /** A field of the price rule in the row of a pack size. */
  function ruleField(row: HTMLElement, name: string): HTMLInputElement {
    const found = row.querySelector<HTMLInputElement>(
      `[name$=".priceRule.${name}"]`,
    );
    if (!found) throw new Error(`No field "${name}" in the row`);
    return found;
  }

  it("lets a pack size set its own fulfilment cost and markup, and its price follows", async () => {
    const product = record("Garam Masala");
    const masala = product.variants[0]!;
    expect(masala.priceRule).toBeNull();
    const { user } = renderProduct("Garam Masala");
    await waitFor(() => field("variants.0.priceRule.markupPercent"));
    const row = packRow(masala.packSize.label);
    // Under an empty field: what the pack size follows, and who sets it.
    expect(
      await within(row).findByText("Empty: 35 % from the shop."),
    ).toBeInTheDocument();
    expect(
      within(row).getByText("Empty: 10 % from the shop."),
    ).toBeInTheDocument();
    expect(within(row).queryByText("Own price rule")).toBeNull();
    expect(
      within(row).queryByRole("button", { name: /Follow the product/ }),
    ).toBeNull();

    await user.type(ruleField(row, "fulfilmentPercent"), "12");
    await user.type(ruleField(row, "markupPercent"), "40");
    const own = { ...SHOP, fulfilmentPercent: 12, markupPercent: 40 };
    const price = mockPrice(masala.cost!, own, 700).price;
    expect(price).not.toBe(masala.regularPrice);
    // The price is still the calculation's: shown, with what it will be.
    expect(field("variants.0.regularPrice")).toHaveAttribute("readonly");
    expect(
      await within(row).findByText(
        `Calculated. After saving: about ${formatMoney(price)}.`,
      ),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);

    await user.click(saveButton());
    await waitFor(() => expect(writes()).toHaveLength(1));
    // The rule alone: no price is sent for a pack size in auto.
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/products/${product.id}/variants/${masala.id}`,
      body: { priceRule: { fulfilmentPercent: 12, markupPercent: 40 } },
    });
    expect(masala.priceRule).toEqual({
      fulfilmentPercent: 12,
      markupPercent: 40,
    });
    expect(masala.regularPrice).toBe(price);
    await waitFor(() =>
      expect(field("variants.0.regularPrice")).toHaveValue(
        (price / 100).toFixed(2),
      ),
    );
    expect(
      await within(packRow(masala.packSize.label)).findByText("Own price rule"),
    ).toBeInTheDocument();

    // The pricing block is loaded again and names the pack size as the source.
    const panel = screen.getByRole("region", { name: "Pricing" });
    await waitFor(() =>
      expect(
        valueOf(
          within(panel).getByLabelText("How the price is calculated"),
          "Markup (40 %, this pack size)",
        ),
      ).not.toBe(""),
    );
    const calculation = within(panel).getByLabelText(
      "How the price is calculated",
    );
    expect(
      valueOf(calculation, "Fulfilment cost (12 %, this pack size)"),
    ).not.toBe("");
    expect(valueOf(calculation, "Calculated price")).toBe(formatMoney(price));
    expect(within(panel).getByText("Own price rule")).toBeInTheDocument();

    // "Follow the product" empties the four fields; saving removes the rule.
    api.calls.length = 0;
    await user.click(
      within(packRow(masala.packSize.label)).getByRole("button", {
        name: `Follow the product: ${masala.packSize.label}`,
      }),
    );
    expect(field("variants.0.priceRule.fulfilmentPercent")).toHaveValue("");
    expect(field("variants.0.priceRule.markupPercent")).toHaveValue("");
    await user.click(saveButton());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({ priceRule: null });
    expect(masala.priceRule).toBeNull();
    expect(masala.regularPrice).toBe(mockPrice(masala.cost!, SHOP, 700).price);
    await waitFor(() =>
      expect(
        within(packRow(masala.packSize.label)).queryByText("Own price rule"),
      ).toBeNull(),
    );
  });

  it("says that the rule of a price set by hand only changes the profit shown", async () => {
    const product = record("Basmati Rice");
    const big = product.variants.find(
      (entry) => entry.packSize.label === "10 kg",
    )!;
    expect(big.priceMode).toBe("manual");
    expect(big.priceRule).toEqual({ fulfilmentPercent: 12, markupPercent: 40 });
    const priceBefore = big.regularPrice;

    const { user } = renderProduct("Basmati Rice");
    await waitFor(() => field("variants.0.priceRule.markupPercent"));
    const row = packRow("10 kg");
    expect(within(row).getByText("Own price rule")).toBeInTheDocument();
    expect(ruleField(row, "fulfilmentPercent")).toHaveValue("12");
    expect(ruleField(row, "markupPercent")).toHaveValue("40");
    expect(ruleField(row, "extraPercent")).toHaveValue("");
    expect(
      within(row).getByText(
        "The price of this pack size is set by hand. Its rule does not change the price, only the profit shown.",
      ),
    ).toBeInTheDocument();
    // The other pack sizes follow the product and say nothing of the kind.
    expect(within(packRow("1 kg")).queryByText("Own price rule")).toBeNull();
    expect(
      within(packRow("1 kg")).queryByText(/Its rule does not change the price/),
    ).toBeNull();

    // The pricing block shows the rule of the pack size that is chosen.
    const panel = await screen.findByRole("region", { name: "Pricing" });
    await within(panel).findByLabelText("How the price is calculated");
    expect(within(panel).queryByText("Own price rule")).toBeNull();
    await user.selectOptions(within(panel).getByLabelText("Pack size"), big.id);
    const calculation = await within(panel).findByLabelText(
      "How the price is calculated",
    );
    expect(
      valueOf(calculation, "Fulfilment cost (12 %, this pack size)"),
    ).not.toBe("");
    expect(valueOf(calculation, "Markup (40 %, this pack size)")).not.toBe("");
    expect(within(panel).getByText("Own price rule")).toBeInTheDocument();
    expect(
      within(panel).getByText(/its price is set by\s+hand/),
    ).toBeInTheDocument();

    // One value emptied: the value the pack size keeps is sent, the price stays.
    await user.clear(ruleField(row, "markupPercent"));
    await user.click(saveButton());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `/v1/admin/products/${product.id}/variants/${big.id}`,
      body: { priceRule: { fulfilmentPercent: 12 } },
    });
    expect(big.priceRule).toEqual({ fulfilmentPercent: 12 });
    expect(big.regularPrice).toBe(priceBefore);
    expect(big.priceMode).toBe("manual");
  });

  it("creates a pack size with a rule of its own, priced by it", async () => {
    const { user } = renderPanel(<ProductNewView />, {
      path: "/catalogue/products/new",
    });
    await screen.findByText("Create product", { selector: "button" });
    await user.type(field("name.en"), "Fennel Seeds");
    const select = document.querySelector<HTMLSelectElement>(
      '[name="categoryId"]',
    );
    const option = select?.options[1];
    if (!select || !option) throw new Error("No category to choose");
    await user.selectOptions(select, option.value);
    await user.type(field("variants.0.packSize.value"), "100");
    await user.type(field("vatRate"), "7");
    await user.type(field("variants.0.cost"), "1.38");
    await user.click(
      screen.getByRole("switch", { name: "Price follows the buying price" }),
    );
    await waitFor(() =>
      expect(field("variants.0.regularPrice")).toHaveValue("2.19"),
    );
    await user.type(field("variants.0.priceRule.markupPercent"), "40");
    const price = mockPrice(138, { ...SHOP, markupPercent: 40 }, 700).price;
    await waitFor(() =>
      expect(field("variants.0.regularPrice")).toHaveValue(
        (price / 100).toFixed(2),
      ),
    );

    await user.click(
      screen.getByText("Create product", { selector: "button" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = writes()[0]?.body as { variants: unknown[] };
    expect(body.variants).toEqual([
      {
        packSize: { value: 100, unit: "g" },
        regularPrice: price,
        cost: 138,
        priceMode: "auto",
        priceRule: { markupPercent: 40 },
      },
    ]);
    const created = record("Fennel Seeds").variants[0]!;
    expect(created.priceRule).toEqual({ markupPercent: 40 });
    expect(created.regularPrice).toBe(price);
  });

  it("does not send a value the API would refuse", async () => {
    const { user } = renderProduct("Garam Masala");
    await waitFor(() => field("variants.0.priceRule.markupPercent"));
    await user.type(field("variants.0.priceRule.markupPercent"), "1001");
    await user.click(saveButton());
    expect(
      await screen.findByText(
        "A percentage from 0 to 1000 with at most two decimals, or empty. Example: 35",
      ),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("is read-only for a role that may only read the catalogue", async () => {
    const { id } = record("Basmati Rice");
    renderPanel(<ProductView />, {
      path: `/catalogue/products/${id}`,
      params: { id },
      permissions: ["catalog.read"],
    });
    await waitFor(() => field("variants.0.priceRule.markupPercent"));
    const row = packRow("10 kg");
    expect(ruleField(row, "markupPercent")).toHaveValue("40");
    expect(ruleField(row, "markupPercent")).toBeDisabled();
    expect(
      within(row).queryByRole("button", { name: /Follow the product/ }),
    ).toBeNull();
  });
});
