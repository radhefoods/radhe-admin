import { alerts, expect, signIn, test } from "./support";

// The way of an order in the shop that sells from stock: paid at checkout,
// prepared, dispatched with a tracking number, delivered; and the one
// decision about money that is the admin's, the refund.

test.describe("the way of a paid order", () => {
  test("a confirmed order is processed, dispatched with its tracking number and delivered", async ({
    page,
  }) => {
    await signIn(page, "owner", "/orders?status=confirmed&deliveryMethod=dhl");
    await page
      .getByRole("table")
      .getByRole("link", { name: /^RF-\d{4}$/ })
      .first()
      .click();
    const heading = page.getByRole("heading", { level: 1, name: /RF-\d{4}/ });
    await expect(heading).toBeVisible();
    const number = (await heading.innerText()).match(/RF-\d{4}/)?.[0] ?? "";

    // The next step is the primary button; nothing else moves money.
    await page.getByRole("button", { name: "Mark processing" }).click();
    let dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByText("The customer is not told about this step."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Mark processing" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`${number} is now processing`)).toBeVisible();

    await page.getByRole("button", { name: "Mark dispatched" }).click();
    dialog = page.getByRole("alertdialog");
    await dialog.getByLabel(/DHL tracking number/).fill("00340434161094015902");
    await dialog.getByRole("button", { name: "Mark dispatched" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`${number} is now dispatched`)).toBeVisible();
    await expect(page.getByText("00340434161094015902").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^Track/ })).toBeVisible();

    await page.getByRole("button", { name: "Mark delivered" }).click();
    dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Mark delivered" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`${number} is now delivered`)).toBeVisible();
    // Only the step back is left: the way forward from here is a return.
    await expect(page.getByRole("button", { name: /^Mark / })).toHaveCount(0);
  });

  test("a pending order has no step: the payment confirms it", async ({
    page,
  }) => {
    await signIn(page, "owner", "/orders?status=pending_payment");
    await page
      .getByRole("table")
      .getByRole("link", { name: /^RF-\d{4}$/ })
      .first()
      .click();
    await expect(
      page.getByText("Waiting for the payment: it confirms the order."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Mark / })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: "Payment" }),
    ).toBeVisible();
  });
});

test.describe("the refund decision", () => {
  test("a cancelled paid order waits for a refund, which is decided by hand and completed", async ({
    page,
  }) => {
    await signIn(page, "owner", "/payments");
    // The payments page opens on the orders that wait for a decision.
    await expect(
      page.getByRole("button", { name: /Waiting for a refund/ }),
    ).toHaveAttribute("aria-current", "page");
    await page
      .getByRole("table")
      .getByRole("link", { name: /^RF-\d{4}$/ })
      .first()
      .click();

    await expect(page.getByText(/waits for a refund$/)).toBeVisible();
    await page.getByRole("button", { name: "Decide the refund" }).click();
    let dialog = page.getByRole("alertdialog");
    // Stripe is not connected: only a refund by hand is offered.
    await expect(
      dialog.getByRole("option", { name: /Through Stripe/ }),
    ).toHaveCount(0);
    const suggested = await dialog
      .getByText("Waits for a refund")
      .locator("xpath=following-sibling::*[1]")
      .innerText();
    expect(suggested).toMatch(/^€\d/);
    await dialog.getByLabel("Reason").selectOption("other");
    await dialog.getByLabel("Sent by").selectOption("bank_transfer");
    await dialog.getByRole("button", { name: `Refund ${suggested}` }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText(/^Refund RF-\d{4}-RF\d+ decided$/),
    ).toBeVisible();

    // The refund is pending until the money is sent by hand.
    await page.getByRole("link", { name: /-RF\d+$/ }).click();
    await expect(page.getByText("Waiting for you")).toBeVisible();
    await page.getByRole("button", { name: "The money is sent" }).click();
    dialog = page.getByRole("alertdialog");
    await dialog
      .getByRole("button", { name: `Complete the refund of ${suggested}` })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Completed").first()).toBeVisible();
  });
});

test.describe("permissions", () => {
  test("a read-only role sees everything and can change nothing", async ({
    page,
  }) => {
    await signIn(page, "viewer", "/orders?status=confirmed");
    await page
      .getByRole("table")
      .getByRole("link", { name: /^RF-\d{4}$/ })
      .first()
      .click();
    const next = page.getByRole("button", { name: "Mark processing" });
    await expect(next).toBeDisabled();
    await next.hover({ force: true });
    await expect(page.getByRole("tooltip")).toContainText("Orders: manage");
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    await page.goto("/catalogue/products");
    await expect(page.getByRole("link", { name: "New product" })).toHaveCount(
      0,
    );
  });

  test("the navigation shows only what the role may read", async ({ page }) => {
    await signIn(page, "orders");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Customers" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Shop settings" })).toHaveCount(
      0,
    );
    await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Roles" })).toHaveCount(0);

    // An address that is not in the navigation explains itself instead of failing.
    await page.goto("/settings/team");
    await expect(
      page.getByText("Your role does not open this page"),
    ).toBeVisible();
  });
});

test("the start page names what waits, and the global search finds an order by its number", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByText("Orders to process").first()).toBeVisible();
  await expect(page.getByText("Refunds to decide").first()).toBeVisible();
  await expect(page.getByText("Stock running low").first()).toBeVisible();
  await expect(alerts(page)).toHaveCount(0);

  await page.keyboard.press("/");
  const search = page.getByPlaceholder(/Order number, customer email/);
  await search.fill("rf1010");
  await page.getByRole("option", { name: /RF-1010/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /RF-1010/ }),
  ).toBeVisible();
});
