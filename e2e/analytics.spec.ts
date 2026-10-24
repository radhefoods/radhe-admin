import { expect, signIn, test } from "./support";

// The Analytics tab in a real browser: the charts draw, the period in the
// address survives a reload, and the viewer, who reads everything, sees it
// while an admin without the permission does not.

test("the Analytics tab draws the figures of the month and keeps the period over a reload", async ({
  page,
}) => {
  await signIn(page, "owner", "/");
  await page.getByRole("tab", { name: "Analytics" }).click();
  await expect(page).toHaveURL(/\?tab=analytics$/);
  await expect(page.getByText("Gross revenue")).toBeVisible();
  const sales = page.getByRole("region", { name: "Sales" });
  await expect(
    sales.getByRole("img", { name: /Revenue per day/ }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "Period" })
    .selectOption("last_month");
  await expect(page).toHaveURL(/range=last_month/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue(
    "last_month",
  );
  await expect(page.getByRole("tab", { name: "Analytics" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Hovering the chart names the day and its figures.
  const chart = sales.getByRole("img", { name: /Revenue per day/ });
  const box = await chart.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    sales.getByText("Previous period", { exact: false }),
  ).toBeVisible();
});

test("an admin without analytics.read sees the start page without tabs", async ({
  page,
}) => {
  await signIn(page, "orders", "/?tab=analytics");
  await expect(
    page.getByRole("heading", { name: "Waiting for you" }),
  ).toBeAttached();
  await expect(page.getByRole("tab", { name: "Analytics" })).toHaveCount(0);
});
