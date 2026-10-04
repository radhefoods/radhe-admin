import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

export const MOCK = "http://localhost:3000";

export const ADMINS = {
  owner: { email: "owner@radhefoods.de", password: "radhe-owner-2026" },
  orders: { email: "orders@radhefoods.de", password: "radhe-orders-2026" },
  viewer: { email: "viewer@radhefoods.de", password: "radhe-viewer-2026" },
  newcomer: { email: "new@radhefoods.de", password: "temporary-pass-123" },
} as const;

/** Every demo admin of the mock accepts this authenticator code. */
export const CODE = "000000";

/** The switches of the mock itself (not part of the API). */
export async function mock(
  request: APIRequestContext,
  action:
    | "reset"
    | "config"
    | "expire-access"
    | "expire-sessions"
    | "revoke-sessions",
  data: Record<string, unknown> = {},
): Promise<void> {
  const response = await request.post(`${MOCK}/__mock/${action}`, { data });
  expect(response.ok(), `mock ${action}`).toBe(true);
}

/** The notices of the page; Next.js keeps an empty alert of its own for route changes. */
export function alerts(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

export async function fillCredentials(
  page: Page,
  who: keyof typeof ADMINS = "owner",
): Promise<void> {
  await page.getByLabel("Email").fill(ADMINS[who].email);
  await page.getByLabel("Password", { exact: true }).fill(ADMINS[who].password);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Signs in through the real sign-in: password, then the authenticator code. */
export async function signIn(
  page: Page,
  who: keyof typeof ADMINS = "owner",
  path = "/",
): Promise<void> {
  await page.goto(
    path === "/" ? "/sign-in" : `/sign-in?returnTo=${encodeURIComponent(path)}`,
  );
  await fillCredentials(page, who);
  // Six digits submit by themselves.
  await page.getByLabel("Authenticator code").fill(CODE);
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

/** Tests start from the demo data, with Stripe and WhatsApp off as in section 19. */
export const test = base.extend({
  page: async ({ page, request }, run) => {
    await mock(request, "reset", { stripe: false, whatsapp: false });
    await run(page);
  },
});

export { expect };
