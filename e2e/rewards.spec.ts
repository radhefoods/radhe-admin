import { expect, signIn, test } from "./support";

// Points and rewards in a real browser: the rules saved as one document,
// coins adjusted by hand from an account, a reader who changes nothing.

test("the rules of the program are saved as one document", async ({ page }) => {
  await signIn(page, "owner", "/rewards?tab=settings");
  const field = page.getByLabel("Coins for signing up");
  await expect(field).toHaveValue("100");
  await field.fill("150");
  await page.getByRole("button", { name: "Save the rules" }).click();
  await expect(page.getByText("Rules of the program saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Coins for signing up")).toHaveValue("150");
});

test("coins are added by hand from the account page", async ({ page }) => {
  await signIn(page, "owner", "/rewards?tab=accounts");
  const table = page.getByRole("table", { name: /^Coin accounts/ });
  // The first link of a row is the customer; the row itself leads to the
  // account. Each navigation is waited for before the next one starts.
  await table.getByRole("row").nth(1).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f]{24}$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/rewards\?tab=accounts$/);
  await table.getByRole("row").nth(1).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^Coins of / }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Adjust coins" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("textbox", { name: /^Coins/ }).fill("10");
  await dialog.getByRole("button", { name: "Add 10 coins" }).click();
  await expect(page.getByText("Coins adjusted")).toBeVisible();
  // The row of the table: the cards of the phone layout hold the same
  // words and are hidden at this width.
  await expect(
    page.getByText("Adjusted by hand").filter({ visible: true }).first(),
  ).toBeVisible();
});

test("a viewer reads the coins and changes nothing", async ({ page }) => {
  await signIn(page, "viewer", "/rewards?tab=settings");
  await expect(page.getByLabel("Coins for signing up")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save the rules" }),
  ).toBeDisabled();
  await page.goto("/rewards?tab=accounts");
  await page
    .getByRole("table", { name: /^Coin accounts/ })
    .getByRole("row")
    .nth(1)
    .click();
  await expect(
    page.getByRole("button", { name: "Adjust coins" }),
  ).toBeDisabled();
});
