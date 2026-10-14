import path from "node:path";
import { expect, signIn, test } from "./support";

// The templates of the panel go through the whole import: chosen in the
// browser, previewed, written; the new product then shows in the list.

const templates = path.join(process.cwd(), "public", "templates");

test("the template sheets import through preview and confirmation, and the export comes back as a file", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/import-export");

  await page
    .getByLabel(/^Categories sheet/)
    .setInputFiles(path.join(templates, "categories-example.csv"));
  await page
    .getByLabel(/^Products sheet/)
    .setInputFiles(path.join(templates, "products-example.csv"));
  await expect(
    page.getByText(/categories-example\.csv: 6 rows, 15 columns/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const products = page.getByRole("region", { name: "Products: preview" });
  await expect(products).toContainText("Create 5");
  await expect(
    page.getByRole("region", { name: "Categories: preview" }),
  ).toContainText("Create 6");

  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Import 11 rows?");
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("region", { name: "Products: result" })).toContainText(
    "Created 5",
  );

  await page.goto("/catalogue/products?q=banana");
  await expect(
    page.getByRole("table").getByRole("row").filter({ hasText: "Banana Chips" }),
  ).toHaveCount(1);

  await page.goto("/catalogue/import-export");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).nth(1).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^radhe-products-\d{4}-\d{2}-\d{2}\.csv$/);
});
