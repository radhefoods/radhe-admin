import { expect, signIn, test } from "./support";

// The jobs of the road, on a phone: find the order, mark it delivered,
// record the cash.

test("an order is marked delivered from a phone", async ({ page }) => {
  await signIn(page, "owner", "/orders?status=dispatched");
  // On a phone the list is cards, not a table.
  await expect(page.getByRole("table")).toBeHidden();
  await page
    .getByRole("list", { name: /Orders/ })
    .getByRole("link")
    .first()
    .click();

  const deliver = page.getByRole("button", { name: "Mark delivered" });
  await expect(deliver).toBeVisible();
  // Large enough for a thumb.
  expect((await deliver.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await deliver.click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Mark delivered" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Delivered").first()).toBeVisible();
});

test("the navigation opens as a drawer and nothing scrolls sideways", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Open the navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Cargos" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Cargos" }),
  ).toBeVisible();
  for (const path of [
    "/",
    "/cargos",
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
