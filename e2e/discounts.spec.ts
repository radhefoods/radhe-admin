import { expect, signIn, test } from "./support";

// Discount codes in a real browser: a code switched off from the list, a
// new code created and opened, and a reader who changes nothing.

test("a code is switched off from the list and the page says so", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/discounts");
  const table = page.getByRole("table", { name: "Discount codes" });
  const row = table.getByRole("row", { name: /DIWALI10/ });
  await expect(row).toContainText("Active");

  let patched = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/discounts/"))
      patched += 1;
  });
  await row.getByRole("switch", { name: "DIWALI10 is switched on" }).click();
  await expect(page.getByText("DIWALI10 is switched off")).toBeVisible();
  await expect(row).toContainText("Inactive");
  await expect.poll(() => patched).toBe(1);

  await page.reload();
  await expect(table.getByRole("row", { name: /DIWALI10/ })).toContainText(
    "Inactive",
  );
});

test("a new code is created with a typed text and its page shows no use yet", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/discounts/new");
  await page.getByLabel(/^Code/).fill("autumn-7");
  await page.getByLabel(/^Note/).fill("Autumn flyer");
  await page.getByLabel(/^Percentage/).fill("7");
  await page.getByRole("button", { name: "Create the code" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /AUTUMN-7/ }),
  ).toBeVisible();
  await expect(
    page.getByText("No order was made with this code yet."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toBeEnabled();
});

test("a viewer reads the codes and changes nothing", async ({ page }) => {
  await signIn(page, "viewer", "/catalogue/discounts");
  const table = page.getByRole("table", { name: "Discount codes" });
  await expect(
    table.getByRole("switch", { name: "DIWALI10 is switched on" }),
  ).toBeDisabled();
  await table.getByRole("link", { name: "DIWALI10" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /DIWALI10/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Switch off" })).toBeDisabled();
});
