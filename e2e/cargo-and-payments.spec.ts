import { alerts, expect, signIn, test } from "./support";

test.describe("the week of a cargo", () => {
  test("closing the open cargo restates its numbers and takes it off the top bar", async ({
    page,
  }) => {
    await signIn(page);
    const card = page.getByRole("article").filter({ hasText: "RF-C028" });
    await expect(card.getByText("Taking orders").first()).toBeVisible();
    const booked = await card
      .locator("dd")
      .filter({ hasText: "€" })
      .first()
      .innerText();

    await card.getByRole("button", { name: "Close ordering" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("heading", { name: "Close ordering for RF-C028?" }),
    ).toBeVisible();
    await expect(dialog.getByText(booked)).toBeVisible();
    await dialog.getByRole("button", { name: "Close ordering" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("RF-C028 is now orders closed")).toBeVisible();
    await expect(card.getByText("Orders closed").first()).toBeVisible();
    // Nothing takes orders now: the top bar says so.
    await expect(
      page.getByRole("banner").getByText("Ordering closed"),
    ).toBeVisible();
  });

  test("a cargo is created, scheduled, and shows up in the list", async ({
    page,
  }) => {
    await signIn(page, "owner", "/cargos/new");
    await page.getByLabel("Internal name").fill("December, first week");
    await page.getByLabel("Ordering opens").fill("2026-11-20T00:00");
    await page.getByLabel("Order deadline").fill("2026-11-26T23:59");
    await page.getByLabel("First delivery day").fill("2026-12-07");
    await page.getByLabel("Last delivery day").fill("2026-12-05");
    await page.getByRole("button", { name: "Create cargo" }).click();
    await expect(
      page.getByText("The window cannot end before it starts."),
    ).toBeVisible();

    await page.getByLabel("Last delivery day").fill("2026-12-09");
    await page.getByRole("button", { name: "Create cargo" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "RF-C031" }),
    ).toBeVisible();
    await expect(page.getByText("Scheduled").first()).toBeVisible();
    // German time, whatever the browser is set to.
    await expect(page.getByText("Thu 26 Nov, 23:59")).toBeVisible();
  });

  test("the API's refusal of an overlapping window is shown at the form", async ({
    page,
  }) => {
    await signIn(page, "owner", "/cargos/new");
    await page.getByLabel("Internal name").fill("Overlap");
    // Inside the window of the scheduled demo cargo.
    const day = (offset: number) => {
      const date = new Date(Date.now() + offset * 86_400_000);
      return date.toISOString().slice(0, 10);
    };
    await page.getByLabel("Ordering opens").fill(`${day(3)}T00:00`);
    await page.getByLabel("Order deadline").fill(`${day(5)}T23:59`);
    await page.getByLabel("First delivery day").fill(day(20));
    await page.getByLabel("Last delivery day").fill(day(22));
    await page.getByRole("button", { name: "Create cargo" }).click();
    await expect(alerts(page)).toContainText(
      "The order window overlaps with cargo RF-C029.",
    );
  });
});

test.describe("collecting after delivery", () => {
  test("payment is activated for a delivered cargo with the amount restated", async ({
    page,
  }) => {
    await signIn(page, "owner", "/cargos");
    await page.getByRole("link", { name: "RF-C025" }).first().click();
    await page
      .getByRole("navigation", { name: "Sections of RF-C025" })
      .getByRole("link", { name: /^Payments/ })
      .click();

    const notice = page.getByText(/delivered orders without an invoice yet/);
    await expect(notice).toBeVisible();
    await page
      .getByRole("button", { name: "Activate payment" })
      .first()
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("heading", { name: "Activate payment for RF-C025?" }),
    ).toBeVisible();
    const toCollect = await dialog.locator("dd").first().innerText();
    expect(toCollect).toMatch(/^€\d/);
    await expect(dialog.getByText(/German time/)).toBeVisible();

    await dialog
      .getByRole("button", { name: /Activate and notify \d+ customers/ })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText(/Payment activated for \d+ orders/),
    ).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  test("cash is recorded on an order and a refund is decided afterwards", async ({
    page,
  }) => {
    await signIn(page, "owner", "/payments?view=due");
    await page
      .getByRole("table")
      .getByRole("link", { name: /^RF-\d+$/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Payment" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Record cash" }).click();
    let dialog = page.getByRole("alertdialog");
    const amount = await dialog.locator("dd").last().innerText();
    await dialog
      .getByRole("button", { name: `Record ${amount} in cash` })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Paid").first()).toBeVisible();

    await page.getByRole("button", { name: "Refund", exact: true }).click();
    dialog = page.getByRole("alertdialog");
    // Stripe is not connected: only a refund by hand is offered.
    await expect(
      dialog.getByRole("option", { name: /Through Stripe/ }),
    ).toHaveCount(0);
    await dialog.getByLabel("Amount").fill("2,00");
    await dialog.getByLabel("Reason").selectOption("goodwill");
    await dialog.getByLabel("Sent by").selectOption("bank_transfer");
    await dialog.getByRole("button", { name: "Refund €2.00" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("link", { name: /-RF1$/ }).click();
    await expect(page.getByText("Waiting for you")).toBeVisible();
    await page.getByRole("button", { name: "The money is sent" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Complete the refund of €2.00" })
      .click();
    await expect(page.getByText("Completed").first()).toBeVisible();
  });
});

test.describe("permissions", () => {
  test("a read-only role sees everything and can change nothing", async ({
    page,
  }) => {
    await signIn(page, "viewer");
    const card = page.getByRole("article").filter({ hasText: "RF-C028" });
    const close = card.getByRole("button", { name: "Close ordering" });
    await expect(close).toBeDisabled();
    await close.hover({ force: true });
    await expect(page.getByRole("tooltip")).toContainText("Cargos: manage");

    await page.goto("/cargos");
    await expect(page.getByRole("link", { name: "New cargo" })).toHaveCount(0);
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

test("the global search finds an order by its number", async ({ page }) => {
  await signIn(page);
  await page.keyboard.press("/");
  const search = page.getByPlaceholder(/Order number, customer email/);
  await search.fill("rf1042");
  await page.getByRole("option", { name: /RF-1042/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /RF-1042/ }),
  ).toBeVisible();
});
