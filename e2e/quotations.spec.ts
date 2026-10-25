import { expect, signIn, test } from "./support";

// Wholesale quotations in a real browser: the half-priced request gets its
// last price, the totals appear, the quotation goes out, and the list and
// the start page follow.

test("a draft is priced, saved and sent", async ({ page }) => {
  await signIn(page, "owner", "/quotations?status=draft");
  const table = page.getByRole("table", { name: "Wholesale quotations" });
  const row = table.getByRole("row").filter({ hasText: "Curry House Mainz" });
  await expect(row).toContainText("2 of 3 priced");
  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/quotations\/[0-9a-f]{24}$/);

  const send = page.getByRole("button", { name: "Send quotation" });
  await expect(send).toBeDisabled();
  // The third line of this request has no price yet.
  const price = page
    .getByRole("textbox", { name: /^Price per carton of / })
    .nth(2);
  await expect(price).toHaveValue("");
  await price.fill("48,50");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText("Prices saved")).toBeVisible();
  await expect(page.getByText("Total incl. VAT").first()).toBeVisible();
  await expect(send).toBeEnabled();

  await send.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("ravi@curryhouse-mainz.de");
  await dialog.getByRole("button", { name: "Send the quotation" }).click();
  await expect(page.getByText("The quotation is on its way")).toBeVisible();
  await expect(page.getByText("Revision 1").first()).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Emails" }).getByText("Quotation sent"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark accepted" }),
  ).toBeVisible();
});

test("the start page counts the new requests and the viewer only reads", async ({
  page,
}) => {
  await signIn(page, "viewer", "/");
  const tile = page.getByRole("link", { name: /Quotation requests/ });
  await expect(tile).toContainText("2");
  await tile.click();
  await expect(page).toHaveURL(/\/quotations\?status=new$/);
  const table = page.getByRole("table", { name: "Wholesale quotations" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await table.getByRole("link").first().click();
  await expect(page.getByRole("button", { name: "PDF" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Send quotation" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save prices" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("textbox")).toHaveCount(0);
});
