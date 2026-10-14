import { expect, signIn, test } from "./support";

// The lists after the API's answers of 14 October 2026: search by words,
// the count next to "load more", sorting, and acting on chosen orders.

test("orders are found by a word of the customer's name, counted, sorted, and chosen for an action", async ({
  page,
}) => {
  await signIn(page, "owner", "/orders");
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(1)).toBeVisible();
  await expect(page.getByText(/^Showing 25 of \d+ orders$/)).toBeVisible();

  await page.getByRole("searchbox", { name: "Find orders" }).fill("priya");
  await expect(page).toHaveURL(/\/orders\?q=priya$/);
  await expect(rows.nth(1)).toContainText(/Priya/);
  await expect(
    page.getByText(/^(Showing \d+ of \d+ orders|\d+ orders?, that is all)$/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitem", { name: "Highest bill first" }).click();
  await expect(page).toHaveURL(/sort=total%3Adesc/);
  await expect(
    page.getByRole("table", { name: /highest bill first/ }),
  ).toBeVisible();

  const first = page
    .getByRole("checkbox", { name: /^Choose RF-\d{4}$/ })
    .first();
  await first.check();
  const bar = page.getByRole("region", { name: "Chosen orders" });
  await expect(bar).toContainText("1 order chosen");
  await bar.getByRole("button", { name: "Clear the choice" }).click();
  await expect(bar).toBeHidden();
});

test("customers are searched by name and counted; a viewer sees no choice on orders", async ({
  page,
}) => {
  await signIn(page, "owner", "/customers");
  await expect(
    page.getByText(/of \d+ customers|customers, that is all/),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search customers" })
    .fill("schmidt");
  await expect(page).toHaveURL(/\/customers\?q=schmidt$/);
  await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText(
    /Schmidt/i,
  );

  await page.getByRole("button", { name: /Account of/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(page, "viewer", "/orders");
  await expect(page.getByRole("table").getByRole("row").nth(1)).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});
