// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { ImportExportView } from "./import-export-view";

let api: TestApi;

const csv = (name: string, lines: string[]) =>
  new File([lines.join("\n")], name, { type: "text/csv" });

/** The requests that change something. */
const writes = () => api.calls.filter((call) => call.method !== "GET");

const sheetInput = (label: string) =>
  screen.getByLabelText(new RegExp(`^${label} sheet`));

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  api.calls.length = 0;
});

describe("importing a spreadsheet", () => {
  it("previews with existing records skipped, then with updates, and writes on confirmation", async () => {
    const db = api.mock.db();
    const parent = db.categories.find((entry) => entry.parentId === null)!;
    const product = db.products[0]!;
    const { user } = renderPanel(<ImportExportView />, {
      path: "/catalogue/import-export",
    });

    await user.upload(
      sheetInput("Categories"),
      csv("categories.csv", [
        "slug_en,name_en,name_de,parent_slug,colour",
        `sprouted-lentils,Sprouted Lentils,Gekeimte Linsen,${parent.slug.en},red`,
        `${parent.slug.en},${parent.name.en} and more,,,`,
      ]),
    );
    await user.upload(
      sheetInput("Products"),
      csv("products.csv", [
        "sku,name_en,category_slug,pack_value,pack_unit,regular_price,vat_rate,status",
        "RF-SPROUT-1,Sprouted Moong,sprouted-lentils,1,kg,3.49,7,active",
        "RF-SPROUT-BAD,Odd Sprouts,sprouted-lentils,1,bag,2.00,7,",
        `${product.sku},,,,,,,`,
      ]),
    );
    expect(
      await screen.findByText(/categories\.csv: 2 rows, 5 columns/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/products\.csv: 3 rows, 8 columns/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview" }));
    const preview = await screen.findByRole("region", {
      name: "Categories: preview",
    });
    expect(writes().map((call) => call.path)).toEqual([
      "/v1/admin/catalog/import/preview",
    ]);
    expect(writes()[0]?.body).toMatchObject({ existing: "skip" });
    expect(preview).toHaveTextContent("Create 1");
    expect(preview).toHaveTextContent("Skip 1");
    expect(preview).toHaveTextContent("1 column the import does not know");
    expect(preview).toHaveTextContent("Ignored: colour");
    const products = screen.getByRole("region", { name: "Products: preview" });
    expect(products).toHaveTextContent("Create 1");
    expect(products).toHaveTextContent("Problems 1");
    expect(products).toHaveTextContent(
      'pack_unit: "bag" must be one of g, kg, ml, l, pcs',
    );
    expect(
      db.categories.some((entry) => entry.slug.en === "sprouted-lentils"),
    ).toBe(false);

    // The second preview lists what the file would change on the matches.
    await user.click(
      screen.getByRole("button", { name: /Preview with updates/ }),
    );
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]?.body).toMatchObject({ existing: "update" });
    const updated = await screen.findByRole("region", {
      name: "Categories: preview",
    });
    await waitFor(() => expect(updated).toHaveTextContent("Update 1"));
    const row = within(updated)
      .getAllByRole("row")
      .find((entry) => entry.textContent?.includes(parent.slug.en));
    expect(row).toHaveTextContent("name");
    const unchanged = screen.getByRole("region", { name: "Products: preview" });
    expect(unchanged).toHaveTextContent("Unchanged 1");

    await user.click(screen.getByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Import 3 rows?");
    expect(dialog).toHaveTextContent("Create 1, update 1, skip 0");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await screen.findByRole("region", { name: "Categories: result" });
    expect(
      writes()
        .map((call) => call.path)
        .at(-1),
    ).toBe("/v1/admin/catalog/import");
    const pulses = db.categories.find(
      (entry) => entry.slug.en === "sprouted-lentils",
    );
    expect(pulses?.parentId).toBe(parent.id);
    expect(parent.name.en).toMatch(/and more$/);
    const moong = db.products.find((entry) => entry.sku === "RF-SPROUT-1");
    expect(moong?.categoryId).toBe(pulses?.id);
    expect(moong?.regularPrice).toBe(349);
    expect(moong?.vatRate).toBe(700);
    expect(db.products.some((entry) => entry.sku === "RF-SPROUT-BAD")).toBe(
      false,
    );
    // The alert and the toast both say it.
    expect(screen.getAllByText("Imported").length).toBeGreaterThan(0);
  });

  it("says where an import stopped, that the rows before are written, and that importing again is safe", async () => {
    const db = api.mock.db();
    const category = db.categories[0]!;
    const { user } = renderPanel(<ImportExportView />, {
      path: "/catalogue/import-export",
    });
    // Two different SKUs would get the same slug: the second fails while
    // writing, which the preview cannot see.
    await user.upload(
      sheetInput("Products"),
      csv("products.csv", [
        "sku,name_en,category_slug,pack_value,pack_unit,regular_price,vat_rate",
        `RF-TWIN-1,Twin Dal,${category.slug.en},1,kg,3.00,7`,
        `RF-TWIN-2,Twin Dal,${category.slug.en},1,kg,3.50,7`,
        `RF-AFTER-1,Later Dal,${category.slug.en},1,kg,4.00,7`,
      ]),
    );
    await user.click(await screen.findByRole("button", { name: "Preview" }));
    await screen.findByRole("region", { name: "Products: preview" });
    await user.click(screen.getByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    const stopped = await screen.findByRole("alert");
    expect(stopped).toHaveTextContent(
      "The import stopped at row 2 of the products sheet",
    );
    expect(stopped).toHaveTextContent(/import it again/);
    expect(db.products.some((entry) => entry.sku === "RF-TWIN-1")).toBe(true);
    expect(db.products.some((entry) => entry.sku === "RF-TWIN-2")).toBe(false);
    expect(db.products.some((entry) => entry.sku === "RF-AFTER-1")).toBe(false);
    const result = screen.getByRole("region", { name: "Products: result" });
    expect(result).toHaveTextContent("Another product uses this slug.");
    expect(result).toHaveTextContent(
      "Not written: the import stopped earlier.",
    );
  });

  it("refuses a sheet with more rows than one import takes, before asking the API", async () => {
    const { user } = renderPanel(<ImportExportView />, {
      path: "/catalogue/import-export",
    });
    const lines = ["slug_en,name_en"];
    for (let index = 0; index < 2001; index += 1)
      lines.push(`c-${index},Category ${index}`);
    await user.upload(sheetInput("Categories"), csv("many.csv", lines));
    expect(
      await screen.findByText(
        /2,001 rows, more than the 2,000 one import takes/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(writes()).toEqual([]);
  });
});

describe("exporting", () => {
  it("asks the API for the rows and hands a CSV file to the browser", async () => {
    const saved: { name: string; text: string }[] = [];
    // jsdom has no object URLs: the file's text is caught on the way.
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        void blob.text().then((text) => saved.push({ name: "", text }));
        return "blob:test";
      },
      revokeObjectURL: () => undefined,
    });
    const clicks = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        const last = saved[saved.length - 1];
        if (last) last.name = this.download;
      });
    const { user } = renderPanel(<ImportExportView />, {
      path: "/catalogue/import-export",
    });
    const products = (
      await screen.findAllByRole("button", { name: "CSV" })
    )[1]!;
    await user.click(products);
    await waitFor(() =>
      expect(api.calls.map((call) => call.path)).toContain(
        "/v1/admin/catalog/export?type=products",
      ),
    );
    await waitFor(() => expect(clicks).toHaveBeenCalled());
    await waitFor(() => expect(saved[0]?.text).toContain("sku,gtin,name_en"));
    expect(
      (
        await screen.findAllByText(
          /radhe-products-\d{4}-\d{2}-\d{2}\.csv saved/,
        )
      ).length,
    ).toBeGreaterThan(0);
    clicks.mockRestore();
  });
});
