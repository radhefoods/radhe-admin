import { expect, signIn, test } from "./support";

// The wholesale catalogue in a real browser: a category moved with the
// keyboard and saved at once, and the stock of a SKU set from its product
// page, with the ledger following.

test("a wholesale category is moved with the keyboard and the order is saved at once", async ({
  page,
}) => {
  await signIn(page, "owner", "/wholesale/categories");
  const list = page.getByRole("list", {
    name: "Wholesale categories in display order",
  });
  const rows = list.getByRole("listitem");
  await expect(rows.first()).toContainText("Rice");

  let saved = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().endsWith("/categories/order")
    )
      saved += 1;
  });
  const handle = page.getByRole("button", { name: /^Move Rice,/ });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(rows.nth(1)).toContainText("Rice");
  await expect.poll(() => saved).toBe(1);

  await page.reload();
  await expect(rows.nth(1)).toContainText("Rice");
});

test("the stock of a SKU is set on the product page and the history follows", async ({
  page,
}) => {
  await signIn(page, "owner", "/wholesale/products");
  await page
    .getByRole("table", { name: "Wholesale products" })
    .getByRole("link", { name: "Chakki Atta" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Chakki Atta" }),
  ).toBeVisible();
  const row = page.getByRole("listitem", { name: "4 × 5 kg" });
  await expect(row).toContainText("18 cartons on hand");

  await row.getByRole("button", { name: "Set the stock of 4 × 5 kg" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Cartons on hand").fill("12");
  await dialog.getByLabel(/^Note/).fill("Counted after the delivery");
  await dialog.getByRole("button", { name: "Set the stock to 12" }).click();
  await expect(page.getByText(/is now 12$/)).toBeVisible();
  await expect(row).toContainText("12 cartons on hand");
  const history = page.getByRole("table", {
    name: "Stock history of Chakki Atta",
  });
  await expect(history).toContainText("Counted after the delivery");
  await expect(history).toContainText("18 → 12");
});

test("a viewer reads the wholesale catalogue and changes nothing", async ({
  page,
}) => {
  await signIn(page, "viewer", "/wholesale/products");
  await page
    .getByRole("table", { name: "Wholesale products" })
    .getByRole("link", { name: "Toor Dal" })
    .click();
  await expect(page.getByRole("heading", { name: "Toor Dal" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /^Set the stock of/ }).first(),
  ).toBeDisabled();
});
