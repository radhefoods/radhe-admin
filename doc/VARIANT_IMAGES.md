# Pictures per pack size

Since 2026-11-11 a picture belongs to **one pack size** (SKU) of a retail product. The 5 kg bag and the 10 kg bag of a rice each have their own gallery. The product itself has no pictures any more.

This document is for whoever changes the admin panel and the shop website. The wholesale catalogue is not affected: its pictures stay on the wholesale product, with the endpoints they always had.

## The rules

- **One gallery per pack size.** Up to 8 pictures, in the order the admin sets, one of them the main picture. A product with a single pack size has its pictures on that pack size.
- **Pictures are optional.** A product can be activated without any. The check before activation no longer asks for a picture; it lists `image` under `warnings` while a pack size that is switched on has none.
- **No picture means the placeholder.** The API answers `image: null` and `images: []` for a pack size without pictures, and the shop shows its placeholder. It never shows the picture of another pack size: a 10 kg bag is not shown with the 5 kg bag.
- **Copying shares the file.** "Copy from another pack size" makes the same picture appear on a second pack size without storing it twice. Each pack size then has its own entry (own id, order, main picture, description). Deleting or replacing it on one pack size leaves the other untouched; the files are deleted when no pack size of the product shows them.
- **Pictures travel with the pack size.** Changing the pack, the price or the product's name keeps them. Removing a pack size removes its pictures. When two products are merged, the pack sizes that move keep theirs; where both products have the same pack size, the one that stays keeps its own pictures, or takes those of the other if it had none.

## What was removed

| Removed                                                                 | Use instead                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `POST /v1/admin/products/{id}/images`                                   | `POST /v1/admin/products/{id}/variants/{variantId}/images` |
| `PUT /v1/admin/products/{id}/images/order`                              | `PUT …/variants/{variantId}/images/order`                  |
| `PUT`, `PATCH`, `DELETE /v1/admin/products/{id}/images/{imageId}`       | the same under `…/variants/{variantId}/images/{imageId}`   |
| `images` on the admin product detail                                    | `images` on each entry of `variants`                       |
| `image` in `missing` of the readiness answer, and as a `publishWaivers` | nothing: it is a warning now                               |

The old paths answer `404`. There is no period in which both work: no retail product had pictures when this changed, so nothing had to be carried over.

## Admin API

All under `/v1/admin/products/{id}/variants/{variantId}/images`, permission `catalog.manage`. Every answer is `{ "product": { … } }`, the full admin product, so the page can redraw from it.

| Call                        | Body                                               | What it does                                                                                                                                       |
| --------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST …/images`             | multipart, field `files` (1 to 10)                 | Uploads pictures to the pack size. The first picture of a pack size becomes its main picture. If one file is refused, none is kept. Answers `201`. |
| `POST …/images/copy`        | `{ "fromVariantId": "…", "imageIds"?: ["…"] }`     | Shows pictures of another pack size of the same product here too: all, or the ones named. A picture already shown here is left out.                |
| `PUT …/images/order`        | `{ "orderedIds": ["…"] }`                          | Sets the order. Every picture of the pack size exactly once.                                                                                       |
| `PUT …/images/{imageId}`    | multipart, field `file`                            | Replaces the file. Position, description and main-picture setting stay. Only this pack size shows the new file.                                    |
| `PATCH …/images/{imageId}`  | `{ "alt"?: { "en"?, "de"? }, "isPrimary"?: true }` | Changes the description, or makes it the main picture of the pack size.                                                                            |
| `DELETE …/images/{imageId}` |                                                    | Takes the picture off this pack size. If it was the main picture, the first remaining one becomes it.                                              |

Files: JPEG, PNG or WebP, at most 10 MB, at least 200 px on each side, at most 40 megapixels. They are stored as WebP in three sizes (320, 800 and 1600 px on the longest side, never enlarged).

Errors:

| Status and code                                                                     | When                                                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `400 IMAGE_LIMIT_REACHED`                                                           | The pack size would have more than 8. `details: { maximum: 8, remaining }`.                  |
| `400 IMAGE_REQUIRED`                                                                | No file in the request.                                                                      |
| `400 IMAGE_FORMAT_NOT_ALLOWED`, `400 IMAGE_DIMENSIONS_INVALID`, `400 IMAGE_INVALID` | A file was refused. `details.files` names every refused file.                                |
| `413 FILE_TOO_LARGE`                                                                | A file above 10 MB.                                                                          |
| `400 IMAGE_ORDER_INVALID`                                                           | The list is not every picture of the pack size exactly once. `details.expected` has the ids. |
| `409 IMAGE_ORDER_INVALID`                                                           | The pictures changed between reading and writing. Load the product again.                    |
| `400 VALIDATION_FAILED`                                                             | Copying from the pack size itself, or a malformed body.                                      |
| `404 PRODUCT_NOT_FOUND`, `404 PRODUCT_VARIANT_NOT_FOUND`, `404 IMAGE_NOT_FOUND`     | The product, the pack size (also `fromVariantId`) or the picture does not exist.             |
| `503 STORAGE_UNAVAILABLE`                                                           | The file storage cannot be reached. Nothing was changed.                                     |

### The admin product answer

Each entry of `variants`, and `defaultVariant`, now carries its pictures:

```json
{
  "id": "66f2…",
  "sku": "RF-00041",
  "packSize": { "value": 5, "unit": "kg", "label": "5 kg" },
  "images": [
    {
      "id": "66f9…",
      "isPrimary": true,
      "alt": { "en": "Front of the 5 kg bag", "de": null },
      "url": "https://cdn…/large.webp",
      "sizes": {
        "small": {
          "url": "https://cdn…/small.webp",
          "width": 320,
          "height": 240
        },
        "medium": {
          "url": "https://cdn…/medium.webp",
          "width": 800,
          "height": 600
        },
        "large": {
          "url": "https://cdn…/large.webp",
          "width": 1600,
          "height": 1200
        }
      },
      "bytes": 184220,
      "uploadedAt": "2026-11-11T09:00:00.000Z"
    }
  ]
}
```

`images` is in the admin's order; `isPrimary` marks the main picture. Two pack sizes that show the same file have entries with different `id` and the same `url`.

On the product:

- `imageCount` counts the pictures of all pack sizes together.
- `image` is one picture for lists of products in the panel: the main picture of the pack size that stands for the product, else of the smallest pack size that has one, else `null`. It is for the panel only.
- `images` on the product detail is gone.

### Readiness

`GET /v1/admin/products/{id}/readiness` never has `image` in `missing`. It has `image` in `warnings` while at least one pack size that is switched on has no picture. `publishWaivers` no longer accepts `image`.

## Admin panel: what to build

1. **Remove the picture section of the product.** Uploading, ordering and the main-picture choice at product level go.
2. **A gallery in each pack-size section.** The same component as before, once per pack size, fed from `variants[].images` and calling the endpoints above with that pack size's id:
   - upload (several files at once; show the refused files from `details.files`),
   - drag to reorder,
   - "make main picture", description in English and German, replace file, delete,
   - a counter "3 of 8", and the upload button disabled at 8.
3. **"Copy from another pack size".** Shown only when the product has more than one pack size. A dialog lists the other pack sizes with their pictures as thumbnails and checkboxes; "Copy" sends `fromVariantId` and the ticked `imageIds` (or none of them for all). Pictures this pack size already shows can be shown as ticked and disabled: compare `url`.
4. **Empty state.** A pack size without pictures shows the placeholder and the text "No picture: the shop shows the placeholder".
5. **Product list.** Keep the thumbnail from `image`. A filter or badge "pack sizes without picture" can be built from `variants[].images.length === 0` of the rows shown.
6. **Readiness checklist.** Show `image` among the warnings ("a pack size has no picture"), not among what blocks activation. Remove `image` from the waiver choices.
7. **Deleting a pack size.** The confirmation should say that its pictures are deleted with it.
8. **Merge dialog.** The text "the other product is removed with its texts and images" becomes "with its texts": pictures move with their pack sizes.

Every call answers the whole product; replace the product in the page's state with it instead of patching single fields.

## Shop API: what changed for the website

The shape of the answers is the same. What the fields mean is now tied to the pack size.

| Field                       | Where                                       | Meaning now                                                                                    |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `image`                     | every product entry (lists, cart, wishlist) | The main picture of the pack size the entry shows (`variantId`). `null` when it has none.      |
| `images`                    | product detail                              | The gallery of the selected pack size, main picture first. `[]` when it has none.              |
| `variants[].image` (new)    | every product entry                         | The main picture of each offered pack size, or `null`.                                         |
| `variants[].images` (new)   | product detail only                         | The gallery of each offered pack size, main picture first.                                     |
| `alt` of a picture          | everywhere                                  | Without a description of its own: the name with the pack size, "Basmati Rice (5 kg)".          |
| `imageUrl` of an order line | orders                                      | The small main picture of the pack size that was ordered, as it was when the order was placed. |

Nothing else moved: `GET /v1/store/products`, `…/products/{slug}`, the cart, the wishlists and the orders have the paths and fields they had.

## Shop website: what to check or build

1. **Placeholder.** Wherever a product picture is drawn (cards, product page, cart, wishlist, checkout summary, order history), `image` can be `null`. Draw the placeholder then. Never take the picture of another entry of `variants`.
2. **Cards.** A card shows `image` of its entry. In the views with one card per pack size, each card has the picture of its own pack size; nothing to do beyond rendering `image`.
3. **Product page, changing the pack size.** The page already changes price, stock and URL from `variants` without a request. Do the same with the pictures: when the customer picks a pack size, show `variants[i].images` (the gallery) and reset the gallery to its first picture. If the list is empty, show the placeholder.
4. **Fast switching.** To make the change feel instant, preload the main picture of the other pack sizes after the page is idle: `variants[].image.sizes.medium.url`. Only the main picture, not the whole galleries.
5. **Size chooser with thumbnails (optional).** `variants[].image.sizes.small` is there in lists and on the product page, if the chooser should show a small picture of each pack.
6. **Responsive pictures.** Build `srcset` from `sizes` (320, 800, 1600 px wide at most) and set `width` and `height` from the same object, so that the page does not jump while pictures load. The picture above the fold on the product page gets `fetchpriority="high"`; everything else `loading="lazy"`.
7. **Caching.** Picture URLs never change their content: a replaced picture has a new URL. They are served with `Cache-Control: public, max-age=31536000, immutable`; do not add cache-busting parameters.
8. **Search engines.** `og:image` and the product's structured data take `image.url` of the selected pack size; leave them out when it is `null`.

## Storage and performance

- **No extra queries.** The pictures are part of the pack size inside the product record, which every listing, product page, cart and order already loads.
- **Small records.** A picture adds about 0.5 KB to the product record (three addresses and sizes). With 8 pictures on each of 20 pack sizes a product stays far below any limit.
- **Small answers.** Lists carry one main picture per offered pack size; the full galleries are only in the product detail.
- **One file per picture.** Copies between pack sizes point to the same three files. Files are deleted only when the last pack size of the product stops showing them; a copy of a whole product gets files of its own, so deleting one product never breaks another.
- **Immutable files.** Every upload gets a folder of its own; a file is never overwritten, which is what makes the one-year cache safe.

## Database

- New on each entry of `products.variants`: `images` (list of picture references) and `primaryImageId`.
- Gone from the product: `images`, `primaryImageId`. Existing records still carry an empty `images` list; nothing reads it. It can be removed once with `db.products.updateMany({}, { $unset: { images: "", primaryImageId: "" } })`; leaving it does no harm.
- No new index and no migration: no retail product had pictures.
