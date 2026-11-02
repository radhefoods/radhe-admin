import { expect, signIn, test } from "./support";

// Guests, closed accounts, referrals, reviews and problem reports in a real
// browser: a report taken on and refunded, a review published, a closed
// account shown as such, a reader who changes nothing.

test("an open report is taken on and refunded, and the order shows the credit", async ({
  page,
}) => {
  await signIn(page, "owner", "/issues");
  const table = page.getByRole("table", { name: /^Problem reports/ });
  const first = table.getByRole("row").nth(1);
  const number = (await first.getByRole("link").first().textContent()) ?? "";
  await first.getByRole("link", { name: number }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: number }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Take on" }).click();
  await page.getByRole("button", { name: "Take it on" }).click();
  await expect(page.getByRole("button", { name: "Resolve" })).toBeEnabled();

  await page.getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("radio", { name: /Refund the units/ }).check();
  await dialog.getByRole("button", { name: /^Refund €/ }).click();
  await expect(page.getByText(/was credited on RF-\d+/)).toBeVisible();
  await expect(page.getByText("Resolved").first()).toBeVisible();
});

test("a pending review is published from its page", async ({ page }) => {
  await signIn(page, "owner", "/reviews");
  const table = page.getByRole("table", { name: /^Reviews/ });
  await table.getByRole("row").nth(1).locator('a[href^="/reviews/"]').click();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Publish the review" }).click();
  await expect(page.getByText("Published").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Take off the shop" }),
  ).toBeVisible();
});

test("a closed account is shown without personal details and cannot be blocked", async ({
  page,
}) => {
  await signIn(page, "owner", "/customers?status=deleted");
  await page.getByRole("link", { name: "Deleted account" }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Deleted account" }),
  ).toBeVisible();
  await expect(
    page.getByText(/This account was closed by the customer/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Block the account/ }),
  ).toHaveCount(0);
});

test("a viewer reads reports and reviews and changes nothing", async ({
  page,
}) => {
  await signIn(page, "viewer", "/reviews");
  const table = page.getByRole("table", { name: /^Reviews/ });
  await table.getByRole("row").nth(1).locator('a[href^="/reviews/"]').click();
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject" })).toBeDisabled();
  await page.goto("/issues");
  await page
    .getByRole("table", { name: /^Problem reports/ })
    .getByRole("row")
    .nth(1)
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Take on" })).toBeDisabled();
});
