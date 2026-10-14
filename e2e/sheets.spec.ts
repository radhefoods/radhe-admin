import { expect, signIn, test } from "./support";

// A spreadsheet goes through the dialog on the list page: chosen, checked,
// written; the new records show in the lists, and the export comes back
// as a file.

const csv = (name: string, lines: string[]) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(lines.join("\n"), "utf8"),
});

test("categories and products are imported from the list pages, and products are exported", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/categories");
  await page.getByRole("button", { name: "Import & export" }).click();
  let dialog = page.getByRole("dialog", {
    name: "Import and export categories",
  });
  await dialog
    .getByLabel("Choose a .csv or .xlsx file")
    .setInputFiles(
      csv("categories.csv", [
        "slug_en,name_en,name_de",
        "e2e-sprouts,Sprouts (test),Sprossen (Test)",
      ]),
    );
  await expect(
    dialog.getByRole("region", { name: "Categories: preview" }),
  ).toContainText("Create 1");
  await dialog.getByRole("button", { name: /^Import: create 1/ }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Import" })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Categories: result" }),
  ).toContainText("Created 1");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Sprouts (test)")).toBeVisible();

  await page.goto("/catalogue/products");
  await page.getByRole("button", { name: "Import & export" }).click();
  dialog = page.getByRole("dialog", { name: "Import and export products" });
  await dialog
    .getByLabel("Choose a .csv or .xlsx file")
    .setInputFiles(
      csv("products.csv", [
        "sku,name_en,category_slug,pack_value,pack_unit,regular_price,vat_rate,status",
        "RF-E2E-1,Sprouted Moong (test),e2e-sprouts,500,g,2.49,7,active",
      ]),
    );
  await expect(
    dialog.getByRole("region", { name: "Products: preview" }),
  ).toContainText("Create 1");
  await dialog.getByRole("button", { name: /^Import: create 1/ }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Import" })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Products: result" }),
  ).toContainText("Created 1");
  await page.keyboard.press("Escape");

  await page.goto("/catalogue/products?q=RF-E2E-1");
  await expect(
    page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: "Sprouted Moong (test)" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Import & export" }).click();
  dialog = page.getByRole("dialog", { name: "Import and export products" });
  await dialog.getByRole("tab", { name: "Export" }).click();
  await dialog.getByRole("radio", { name: /CSV/ }).click();
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download products as CSV" })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^radhe-products-\d{4}-\d{2}-\d{2}\.csv$/,
  );
});
