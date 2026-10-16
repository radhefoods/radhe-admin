import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, fillCredentials, signIn, test } from "./support";

// WCAG 2.1 A and AA, checked by axe on every main page in both themes.
// A machine finds contrast, names and roles; whether the page makes sense
// to someone who cannot see it still needs a person.

const PAGES = [
  "/",
  "/orders",
  "/orders?needsRefund=true",
  "/returns",
  "/payments",
  "/payments/refunds",
  "/payments/invoices",
  "/customers",
  "/catalogue/products",
  "/catalogue/products/new",
  "/catalogue/categories",
  "/communication/notifications",
  "/communication/announcements",
  "/settings",
  "/settings/legal",
  "/settings/team",
  "/settings/roles",
  "/profile",
  "/styleguide",
];

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${violation.id}: ${node.target.join(" ")} (${violation.help})`,
    ),
  );
}

/** The page has its data: nothing is loading any more. */
async function settled(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // The styleguide shows placeholders on purpose (`data-demo`).
  await expect(page.locator(".skeleton:not([data-demo] *)")).toHaveCount(0);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test("the sign-in has no accessibility violations", async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page.getByLabel("Email")).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await fillCredentials(page);
      await expect(page.getByLabel("Authenticator code")).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the pages of the panel have no accessibility violations", async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await signIn(page);
      const found: Record<string, string[]> = {};
      for (const path of PAGES) {
        await page.goto(path);
        await settled(page);
        const problems = await violations(page);
        if (problems.length > 0) found[path] = problems;
      }
      expect(found).toEqual({});
    });

    test("a record of each kind has no accessibility violations", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await signIn(page);
      const found: Record<string, string[]> = {};
      // The first record of each list, whatever its id is.
      const lists: [string, RegExp][] = [
        ["/orders", /^\/orders\/[0-9a-f-]{8,}$/],
        ["/payments/refunds", /^\/payments\/refunds\/[0-9a-f-]{8,}$/],
        ["/returns", /^\/returns\/[0-9a-f-]{8,}$/],
        ["/customers", /^\/customers\/[0-9a-f-]{8,}$/],
        ["/catalogue/products", /^\/catalogue\/products\/[0-9a-f-]{8,}$/],
      ];
      for (const [list, record] of lists) {
        await page.goto(list);
        await settled(page);
        const hrefs = await page
          .locator("main a[href]")
          .evaluateAll((links) =>
            links.map((link) => link.getAttribute("href") ?? ""),
          );
        const href = hrefs.find((value) => record.test(value));
        expect(href, `a record in ${list}`).toBeTruthy();
        await page.goto(href!);
        await settled(page);
        const problems = await violations(page);
        if (problems.length > 0) found[href!] = problems;
      }
      expect(found).toEqual({});
    });
  });
}
