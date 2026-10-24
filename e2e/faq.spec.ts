import { expect, signIn, test } from "./support";

// The FAQ in a real browser: a question is dragged to a new place by its
// handle and the order is saved at once.

test("a question is dragged to the top of its group and the order is saved", async ({
  page,
}) => {
  await signIn(page, "owner", "/content/faq");
  const orders = page.getByRole("list", { name: "Questions of Orders" });
  const rows = orders.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  const lastText = await rows.nth(2).innerText();

  let puts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().endsWith("/v1/admin/faqs/order")
    ) {
      puts += 1;
    }
  });

  const handle = rows.nth(2).getByRole("button", { name: /^Move / });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");

  await expect(rows.nth(0)).toContainText(lastText.split("\n")[0] ?? lastText);
  await expect.poll(() => puts).toBe(1);
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "Questions of Orders" })
      .getByRole("listitem")
      .nth(0),
  ).toContainText(lastText.split("\n")[0] ?? lastText);
});

test("the viewer reads the FAQ but cannot change it", async ({ page }) => {
  await signIn(page, "viewer", "/content/faq");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New question" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(
    0,
  );
});
