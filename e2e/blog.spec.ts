import { png } from "../src/test/png";
import { expect, signIn, test } from "./support";

// The blog in a real browser: a post is written, saved, given a featured
// picture that travels to the API, and published; the shop-facing status
// follows on the list.

test("a post is written, given its featured picture and published", async ({
  page,
}) => {
  await signIn(page, "owner", "/content/blog/new");
  await page.locator('[name="title.en"]').fill("Chai, three ways");
  await page
    .locator('[name="content.en"]')
    .fill("# Chai\n\nMasala, ginger and plain: three cups for three moods.");
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByText("Chai, three ways created")).toBeVisible();
  await expect(page).toHaveURL(/\/content\/blog\/[0-9a-f]{24}$/);

  const featured = page.getByRole("region", { name: "Featured picture" });
  await featured.getByLabel("Choose the featured picture").setInputFiles({
    name: "chai.png",
    mimeType: "image/png",
    buffer: png(1600, 900),
  });
  await expect(page.getByText("Featured picture added")).toBeVisible();
  await expect(featured.locator("img")).toBeVisible();

  const publishing = page.getByRole("region", { name: "Publishing" });
  await publishing.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText("Post published")).toBeVisible();
  await expect(publishing.getByText("Published")).toBeVisible();

  await page.getByRole("link", { name: "Blog" }).first().click();
  const row = page.getByRole("row").filter({ hasText: "Chai, three ways" });
  await expect(row).toContainText("Published");
});

test("the viewer reads the blog but cannot write", async ({ page }) => {
  await signIn(page, "viewer", "/content/blog");
  await expect(
    page.getByRole("table", { name: "Posts of the blog" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New post" })).toBeDisabled();
});
