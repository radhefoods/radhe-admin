import { png } from "../src/test/png";
import { expect, signIn, test } from "./support";

// What only a real browser can show: the banner picture travels to the
// API, with the panel's own check in front of it, and the created banner
// opens in its form.

test("a banner is created from its picture, then named and linked; a portrait picture is refused before it is sent", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/banners");
  const list = page.getByRole("list", { name: "Banners in display order" });
  await expect(list.getByRole("listitem")).toHaveCount(4);

  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/v1/admin/banners")
    ) {
      posts += 1;
    }
  });

  await page.getByRole("button", { name: "New banner" }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("Choose the banner picture");

  // 800 × 800: the API would refuse it, so the panel does not send it.
  await input.setInputFiles({
    name: "square.png",
    mimeType: "image/png",
    buffer: png(800, 800),
  });
  await expect(
    dialog.getByText(
      "square.png: 800 × 800 px: a banner must be wider than tall.",
    ),
  ).toBeVisible();
  expect(posts).toBe(0);

  await input.setInputFiles({
    name: "summer.png",
    mimeType: "image/png",
    buffer: png(2400, 1000),
  });
  await expect(page.getByText("Banner created")).toBeVisible();
  expect(posts).toBe(1);
  await expect(dialog.getByRole("heading", { name: "Banner" })).toBeVisible();

  await page.locator('[name="name"]').fill("Summer sale");
  await page.locator('[name="linkUrl"]').fill("/products/alphonso-mango-1kg");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Summer sale saved")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(list.getByRole("listitem").nth(4)).toContainText("Summer sale");
  await expect(
    list.getByRole("switch", { name: "Summer sale is switched on" }),
  ).not.toBeChecked();
});

test("a banner is switched on in the list, and a read-only role cannot", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/banners");
  const draft = page.getByRole("switch", {
    name: "Fresh produce (draft) is switched on",
  });
  await expect(draft).not.toBeChecked();
  await draft.click();
  await expect(
    page.getByText("Fresh produce (draft) is in the shop"),
  ).toBeVisible();
  await expect(draft).toBeChecked();
  // The API has it: a fresh load shows the same.
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Fresh produce (draft) is switched on" }),
  ).toBeChecked();

  await page.getByRole("button", { name: /Account of/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(page, "viewer", "/catalogue/banners");
  await expect(
    page.getByRole("switch", { name: "Fresh produce (draft) is switched on" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "New banner" })).toBeDisabled();
});
