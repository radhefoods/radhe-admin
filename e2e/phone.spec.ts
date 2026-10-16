import { expect, signIn, test } from "./support";

// The jobs of the road and the warehouse, on a phone: see the paid orders,
// mark one processing, dispatch it with the tracking number, mark it
// delivered, decide a refund, correct the stock.

test("a paid order is prepared, dispatched and delivered from a phone, then a refund is decided and the stock corrected", async ({
  page,
}) => {
  await signIn(page, "owner", "/orders?status=confirmed");
  // On a phone the list is cards, not a table.
  await expect(page.getByRole("table")).toBeHidden();
  await page
    .getByRole("list", { name: /Orders/ })
    .getByRole("link")
    .first()
    .click();

  const processing = page.getByRole("button", { name: "Mark processing" });
  await expect(processing).toBeVisible();
  // Large enough for a thumb.
  expect((await processing.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await processing.click();
  let dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Mark processing" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/is now processing/)).toBeVisible();

  await page.getByRole("button", { name: "Mark dispatched" }).click();
  dialog = page.getByRole("alertdialog");
  const tracking = dialog.getByLabel(/tracking number/);
  if ((await tracking.count()) > 0) await tracking.fill("H1004812345");
  await dialog.getByRole("button", { name: "Mark dispatched" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/is now dispatched/)).toBeVisible();

  await page.getByRole("button", { name: "Mark delivered" }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Mark delivered" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/is now delivered/)).toBeVisible();

  // A refund waits on a cancelled order: decided by hand.
  await page.goto("/orders?needsRefund=true");
  await page
    .getByRole("list", { name: /Orders/ })
    .getByRole("link")
    .first()
    .click();
  await page.getByRole("button", { name: "Decide the refund" }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Reason").selectOption("other");
  await dialog.getByLabel("Sent by").selectOption("bank_transfer");
  await dialog.getByRole("button", { name: /^Refund €/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/^Refund RF-\d{4}-RF\d+ decided$/)).toBeVisible();

  // The shelf was counted: the stock is set to what is there.
  await page.goto("/catalogue/products");
  await page
    .getByRole("list", { name: /Products/ })
    .getByRole("link")
    .first()
    .click();
  await page.getByRole("button", { name: "Change the stock" }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Counted number").fill("30");
  await dialog.getByRole("button", { name: "Set the stock to 30" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/^Stock of RF-\d{5} is now 30$/)).toBeVisible();
});

test("the navigation opens as a drawer and nothing scrolls sideways", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Open the navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Orders" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Orders" }),
  ).toBeVisible();
  for (const path of [
    "/",
    "/orders",
    "/payments",
    "/returns",
    "/customers",
    "/catalogue/products",
    "/catalogue/categories",
    "/communication/notifications",
    "/communication/announcements",
    "/settings/company",
    "/settings/delivery-fee",
    "/settings/legal",
    "/settings/team",
    "/settings/roles",
    "/profile",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
