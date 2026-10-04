import {
  ADMINS,
  CODE,
  alerts,
  expect,
  fillCredentials,
  mock,
  signIn,
  test,
} from "./support";

test.describe("signing in", () => {
  test("password, then the authenticator code, leads to the start page", async ({
    page,
  }) => {
    await page.goto("/");
    // Nobody is signed in: the panel sends the visitor to the sign-in.
    await expect(page).toHaveURL(/\/sign-in/);
    await fillCredentials(page);
    await expect(page.getByLabel("Authenticator code")).toBeVisible();
    await page.getByLabel("Authenticator code").fill(CODE);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Good (morning|afternoon|evening|night), Vrushabh/,
      }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });

  test("comes back to the page that was asked for", async ({ page }) => {
    await page.goto("/orders?paymentStatus=overdue");
    await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
    await fillCredentials(page);
    await page.getByLabel("Authenticator code").fill(CODE);
    await expect(page).toHaveURL(/\/orders\?paymentStatus=overdue$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Orders" }),
    ).toBeVisible();
  });

  test("a wrong password says so and keeps the email", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(ADMINS.owner.email);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(alerts(page)).toContainText(
      "Email or password is not correct.",
    );
    await expect(page.getByLabel("Email")).toHaveValue(ADMINS.owner.email);
  });

  test("a wrong code can be tried again", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page);
    await page.getByLabel("Authenticator code").fill("123123");
    await expect(alerts(page)).toContainText("The code is not correct");
    await page.getByLabel("Authenticator code").fill(CODE);
    await expect(page).toHaveURL(/\/$/);
  });

  test("five wrong passwords lock the account, with the time to wait", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.getByLabel("Email").fill(ADMINS.owner.email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(`wrong-${attempt}`);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(alerts(page)).toBeVisible();
    }
    await page
      .getByLabel("Password", { exact: true })
      .fill(ADMINS.owner.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(alerts(page)).toContainText(/locked for about \d+ minutes/);
  });

  test("a new admin sets up the authenticator, then must set a password", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, "newcomer");

    // First sign-in: the QR code, the key as text, and how to get back in.
    await expect(
      page.getByRole("img", { name: "QR code for the authenticator app" }),
    ).toBeVisible();
    await expect(page.getByText("Cannot scan? Enter this key:")).toBeVisible();
    await expect(page.getByText("There are no recovery codes.")).toBeVisible();
    await page.getByLabel("First code from the app").fill(CODE);

    // Nothing but the password change is possible now.
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(
      page.getByRole("heading", { name: "Set your own password" }),
    ).toBeVisible();
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/change-password$/);

    await page.getByLabel("Current password").fill(ADMINS.newcomer.password);
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("New password, again").fill("short");
    await page
      .getByRole("button", { name: "Set password and continue" })
      .click();
    await expect(
      page.getByText("At least 12 characters.", { exact: true }),
    ).toBeVisible();

    await page
      .getByLabel("New password", { exact: true })
      .fill("a-long-sentence-of-my-own");
    await page
      .getByLabel("New password, again")
      .fill("a-long-sentence-of-my-own");
    await page
      .getByRole("button", { name: "Set password and continue" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
});

test.describe("the session", () => {
  test("an expired access token is renewed without the admin noticing", async ({
    page,
    request,
  }) => {
    await signIn(page);
    await mock(request, "expire-access");
    await page.getByRole("link", { name: "Cargos", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Cargos" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "RF-C028" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a session that ended asks for a new sign-in over the page and keeps the form", async ({
    page,
    request,
  }) => {
    await signIn(page, "owner", "/cargos/new");
    await page.getByLabel("Internal name").fill("November, third week");
    await page.getByLabel("Ordering opens").fill("2026-11-10T00:00");

    await mock(request, "expire-sessions");
    // The next call to the API finds the session gone.
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Order number, customer email/).fill("RF-1084");

    const dialog = page.getByRole("dialog", { name: "Sign in again" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Email")).toHaveValue(ADMINS.owner.email);
    await dialog
      .getByLabel("Password", { exact: true })
      .fill(ADMINS.owner.password);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Authenticator code").fill(CODE);
    await expect(dialog).toHaveCount(0);

    // What was typed before the session ended is still there.
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Internal name")).toHaveValue(
      "November, third week",
    );
    await expect(page.getByLabel("Ordering opens")).toHaveValue(
      "2026-11-10T00:00",
    );
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: /Account of/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/cargos");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
