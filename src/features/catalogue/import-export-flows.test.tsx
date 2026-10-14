// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installTestApi, type TestApi } from "@/test/api";
import { renderPanel } from "@/test/render";
import { ImportExportDialog } from "./import-export-dialog";

let api: TestApi;

const csv = (name: string, lines: string[]) =>
  new File([lines.join("\n")], name, { type: "text/csv" });

/** The requests that change something. */
const writes = () => api.calls.filter((call) => call.method !== "GET");

const fileInput = () => screen.getByLabelText("Choose a .csv or .xlsx file");

function open(type: "categories" | "products", permissions?: string[]) {
  return renderPanel(
    <ImportExportDialog type={type} open onOpenChange={() => undefined} />,
    { path: `/catalogue/${type}`, permissions },
  );
}

beforeEach(async () => {
  api = installTestApi();
  await api.signIn();
  api.calls.length = 0;
});

describe("importing a spreadsheet", () => {
  it("checks the file as soon as it is chosen, lists the changes of an update, and writes on confirmation", async () => {
    const db = api.mock.db();
    const parent = db.categories.find((entry) => entry.parentId === null)!;
    const { user } = open("categories");

    await user.upload(
      fileInput(),
      csv("categories.csv", [
        "slug_en,name_en,name_de,parent_slug,colour",
        `sprouted-lentils,Sprouted Lentils,Gekeimte Linsen,${parent.slug.en},red`,
        `${parent.slug.en},${parent.name.en} and more,,,`,
        "no-name,,,,",
      ]),
    );
    expect(await screen.findByText("categories.csv")).toBeInTheDocument();
    expect(screen.getByText("3 rows, 5 columns")).toBeInTheDocument();

    // The preview runs by itself, with existing records left alone.
    const preview = await screen.findByRole("region", {
      name: "Categories: preview",
    });
    expect(writes().map((call) => call.path)).toEqual([
      "/v1/admin/catalog/import/preview",
    ]);
    expect(writes()[0]?.body).toMatchObject({ existing: "skip" });
    expect(preview).toHaveTextContent("Create 1");
    expect(preview).toHaveTextContent("Skip 1");
    expect(preview).toHaveTextContent("Problems 1");
    expect(preview).toHaveTextContent("Ignored: colour");
    expect(preview).toHaveTextContent("name_en is required for a new category");
    expect(
      db.categories.some((entry) => entry.slug.en === "sprouted-lentils"),
    ).toBe(false);

    // Choosing to update the matches previews again and names each change.
    await user.click(
      screen.getByRole("radio", { name: /Update them with the file/ }),
    );
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]?.body).toMatchObject({ existing: "update" });
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Categories: preview" }),
      ).toHaveTextContent("Update 1"),
    );
    const row = screen
      .getAllByRole("row")
      .find((entry) => entry.textContent?.includes(`${parent.slug.en}`));
    expect(row).toHaveTextContent("name");

    await user.click(
      screen.getByRole("button", { name: /^Import: create 1, update 1/ }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Import 2 rows?");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await screen.findByRole("region", { name: "Categories: result" });
    expect(
      writes()
        .map((call) => call.path)
        .at(-1),
    ).toBe("/v1/admin/catalog/import");
    const created = db.categories.find(
      (entry) => entry.slug.en === "sprouted-lentils",
    );
    expect(created?.parentId).toBe(parent.id);
    expect(created?.name.de).toBe("Gekeimte Linsen");
    expect(parent.name.en).toMatch(/and more$/);
    expect(screen.getAllByText("Categories imported").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByRole("button", { name: "Import another file" }),
    ).toBeInTheDocument();
  });

  it("writes products with their prices in cents and VAT in hundredths, and leaves a row with a problem out", async () => {
    const db = api.mock.db();
    const category = db.categories[0]!;
    const { user } = open("products");
    await user.upload(
      fileInput(),
      csv("products.csv", [
        "sku,name_en,category_slug,pack_value,pack_unit,regular_price,vat_rate,status",
        `RF-SPROUT-1,Sprouted Moong,${category.slug.en},1,kg,3.49,7,active`,
        `RF-SPROUT-BAD,Odd Sprouts,${category.slug.en},1,bag,2.00,7,`,
      ]),
    );
    const preview = await screen.findByRole("region", {
      name: "Products: preview",
    });
    expect(preview).toHaveTextContent(
      'pack_unit: "bag" must be one of g, kg, ml, l, pcs',
    );
    await user.click(screen.getByRole("button", { name: /^Import: create 1/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    await screen.findByRole("region", { name: "Products: result" });
    const moong = db.products.find((entry) => entry.sku === "RF-SPROUT-1");
    expect(moong?.categoryId).toBe(category.id);
    expect(moong?.regularPrice).toBe(349);
    expect(moong?.vatRate).toBe(700);
    expect(moong?.status).toBe("active");
    expect(db.products.some((entry) => entry.sku === "RF-SPROUT-BAD")).toBe(
      false,
    );
  });

  it("says where an import stopped, that the rows before are written, and that importing again is safe", async () => {
    const db = api.mock.db();
    const category = db.categories[0]!;
    const { user } = open("products");
    // Two different SKUs would get the same slug: the second fails while
    // writing, which the preview cannot see.
    await user.upload(
      fileInput(),
      csv("products.csv", [
        "sku,name_en,category_slug,pack_value,pack_unit,regular_price,vat_rate",
        `RF-TWIN-1,Twin Dal,${category.slug.en},1,kg,3.00,7`,
        `RF-TWIN-2,Twin Dal,${category.slug.en},1,kg,3.50,7`,
        `RF-AFTER-1,Later Dal,${category.slug.en},1,kg,4.00,7`,
      ]),
    );
    await screen.findByRole("region", { name: "Products: preview" });
    await user.click(screen.getByRole("button", { name: /^Import: create 3/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    const stopped = await screen.findByText(/The import stopped at row 2/, {
      selector: "p",
    });
    expect(stopped.closest("[role='alert']")).toHaveTextContent(
      /import it again/,
    );
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
    const { user } = open("categories");
    const lines = ["slug_en,name_en"];
    for (let index = 0; index < 2001; index += 1)
      lines.push(`c-${index},Category ${index}`);
    await user.upload(fileInput(), csv("many.csv", lines));
    expect(
      await screen.findByText(
        /2,001 rows: more than the 2,000 one import takes/,
      ),
    ).toBeInTheDocument();
    expect(writes()).toEqual([]);
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("offers only the export to an admin who may not manage the catalogue", async () => {
    open("products", ["catalog.read"]);
    expect(await screen.findByRole("tab", { name: "Export" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Import" })).toBeDisabled();
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
    const { user } = open("products");
    await user.click(await screen.findByRole("tab", { name: "Export" }));
    await user.click(screen.getByRole("radio", { name: /CSV/ }));
    await user.click(
      screen.getByRole("button", { name: "Download products as CSV" }),
    );
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
