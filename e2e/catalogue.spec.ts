import { png } from "../src/test/png";
import { expect, signIn, test } from "./support";

// What only a real browser can show: a file that travels to the API, with
// the panel's own check in front of it.

test("a picture is uploaded to a pack size, and one that is too small is refused before it is sent", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/products");
  await page
    .getByRole("table")
    .getByRole("link", { name: /Urad Papad/ })
    .click();

  // The pictures belong to the pack size: its row holds its gallery.
  const pictures = page
    .getByRole("list", { name: "Pack sizes" })
    .getByRole("listitem", { name: "200 g" });
  const tiles = pictures
    .getByRole("list", { name: "Pictures of 200 g" })
    .getByRole("listitem");
  await expect(tiles.first()).toBeVisible();
  const before = await tiles.count();
  await expect(pictures.getByText(`${before} of 8`)).toBeVisible();
  const input = page.getByLabel("Choose pictures for 200 g");

  // 120 px: the API would refuse it, so the panel does not send it at all.
  let uploads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/images")) {
      uploads += 1;
    }
  });
  await input.setInputFiles({
    name: "too-small.png",
    mimeType: "image/png",
    buffer: png(120, 120),
  });
  await expect(pictures.getByText("too-small.png")).toBeVisible();
  await expect(
    pictures.getByText("120 × 120 px: each side needs at least 200 px."),
  ).toBeVisible();
  expect(uploads).toBe(0);
  await expect(tiles).toHaveCount(before);

  await input.setInputFiles({
    name: "papad.png",
    mimeType: "image/png",
    buffer: png(640, 480),
  });
  await expect(page.getByText("Picture added")).toBeVisible();
  await expect(tiles).toHaveCount(before + 1);
  await expect(pictures.getByText(`${before + 1} of 8`)).toBeVisible();
  expect(uploads).toBe(1);
});

test("a product is taken out of the shop with one switch, and a read-only role cannot", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/products");
  const row = page.getByRole("row").filter({ hasText: "Urad Papad" });
  const available = row.getByRole("switch");
  await expect(available).toBeChecked();
  await available.click();
  await expect(available).not.toBeChecked();
  // The API has it: a fresh load shows the same.
  await page.reload();
  await expect(
    page.getByRole("row").filter({ hasText: "Urad Papad" }).getByRole("switch"),
  ).not.toBeChecked();

  await page.getByRole("button", { name: /Account of/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(page, "viewer", "/catalogue/products");
  await expect(
    page.getByRole("row").filter({ hasText: "Urad Papad" }).getByRole("switch"),
  ).toBeDisabled();
});

test("a new product takes its pictures with it: created first, then the upload, then its page", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/products/new");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/v1/admin/products")
    ) {
      posts.push(new URL(request.url()).pathname);
    }
  });

  await page.locator('[name="name.en"]').fill("Horse Gram");
  await page.locator('[name="categoryId"]').selectOption({ index: 1 });
  await page.locator('[name="variants.0.packSize.value"]').fill("500");
  await page.locator('[name="variants.0.regularPrice"]').fill("3.49");
  await page.locator('[name="vatRate"]').fill("7");
  await page.getByLabel("Choose pictures for 500 g").setInputFiles([
    { name: "front.png", mimeType: "image/png", buffer: png(640, 480) },
    { name: "back.png", mimeType: "image/png", buffer: png(640, 480) },
  ]);
  const chosen = page.getByRole("list", {
    name: "Pictures chosen for 500 g",
  });
  await expect(chosen.getByRole("listitem")).toHaveCount(2);
  expect(posts).toEqual([]);

  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page).toHaveURL(/\/catalogue\/products\/[0-9a-f]{24}$/);
  await expect(page.getByText("2 pictures stored.")).toBeVisible();
  const id = page.url().split("/").pop();
  // The product first, then the pictures to its one pack size.
  expect(posts).toHaveLength(2);
  expect(posts[0]).toBe("/v1/admin/products");
  expect(posts[1]).toMatch(
    new RegExp(`^/v1/admin/products/${id}/variants/[0-9a-f]{24}/images$`),
  );
  await expect(
    page.getByRole("list", { name: "Pictures of 500 g" }).getByRole("listitem"),
  ).toHaveCount(2);
});
