import { expect, signIn, test } from "./support";

// Fulfilment & Returns in a real browser: the report with its period in
// the address, the orders behind a row, a file that is really downloaded,
// an adjustment by hand, and a reader who changes nothing.

const TABLE = /^Fulfilment & Returns per pack size/;

test("the report is reached from the navigation, keeps its period and opens the orders of a row", async ({
  page,
}) => {
  await signIn(page, "owner", "/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Fulfilment & Returns" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Fulfilment & Returns" }),
  ).toBeVisible();
  const table = page.getByRole("table", { name: TABLE });
  await expect(table.getByRole("row").nth(1)).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: /^Dispatched/ }),
  ).toHaveAttribute("aria-sort", "descending");

  await page
    .getByRole("combobox", { name: "Period" })
    .selectOption("last_month");
  await expect(page).toHaveURL(/range=last_month/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue(
    "last_month",
  );

  await table
    .getByRole("row")
    .nth(1)
    .getByRole("button", { name: /^View orders/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: /^Orders of / }),
  ).toBeVisible();
  await expect(dialog.getByRole("table")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(dialog).toHaveCount(0);
});

test("the export hands a CSV file with every row to the browser", async ({
  page,
}) => {
  await signIn(page, "owner", "/fulfilment");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/rows will be exported$/)).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe(
    "fulfilment-returns_all-dates.csv",
  );
  await expect(page.getByText("CSV exported")).toBeVisible();
});

test("units are adjusted by hand and the row says so", async ({ page }) => {
  await signIn(page, "owner", "/fulfilment?sort=sku%3Aasc");
  const row = page.getByRole("table", { name: TABLE }).getByRole("row").nth(1);
  await row.getByRole("button", { name: /^Adjust/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Dispatched, all dates")).toBeVisible();
  await dialog.getByRole("button", { name: "Add one dispatched unit" }).click();
  await dialog.getByLabel(/^Reason/).fill("One pack sold at the market stall");
  await dialog.getByRole("button", { name: "Save the adjustment" }).click();
  await expect(page.getByText("Adjustment saved")).toBeVisible();
  await expect(row.getByText(/^adjusted/)).toBeVisible();

  await page.getByRole("button", { name: "Adjustment history" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("One pack sold at the market stall")
      .first(),
  ).toBeVisible();
});

test("a viewer reads the report and adjusts nothing", async ({ page }) => {
  await signIn(page, "viewer", "/fulfilment");
  const table = page.getByRole("table", { name: TABLE });
  await expect(
    table
      .getByRole("row")
      .nth(1)
      .getByRole("button", { name: /^View orders/ }),
  ).toBeVisible();
  await expect(table.getByRole("button", { name: /^Adjust/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Adjustment history" }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /^Take back/ }),
  ).toHaveCount(0);
});
