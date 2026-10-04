import { crc32, deflateSync } from "node:zlib";
import { expect, signIn, test } from "./support";

// What only a real browser can show: a file that travels to the API, with
// the panel's own check in front of it.

/** A plain PNG of one colour, made here so the repository holds no test pictures. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x9a)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("a picture is uploaded to a product, and one that is too small is refused before it is sent", async ({
  page,
}) => {
  await signIn(page, "owner", "/catalogue/products");
  await page
    .getByRole("table")
    .getByRole("link", { name: /Urad Papad/ })
    .click();

  const pictures = page.getByRole("region", { name: "Pictures" });
  const tiles = pictures
    .getByRole("list", { name: /^Pictures of/ })
    .getByRole("listitem");
  await expect(tiles.first()).toBeVisible();
  const before = await tiles.count();
  const input = page.getByLabel("Choose pictures to upload");

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
