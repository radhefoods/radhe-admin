# Prompt for the admin panel agent: pictures per pack size, pricing settings, supplier file

Copy everything below the line into the agent that works on the admin panel (`radhe-admin`).

---

You are working on the Radhe Foods admin panel (`radhe-admin`, Next.js). The API (`radhe-api`) changed in November 2026: pictures now belong to pack sizes, selling prices are calculated from buying prices by a rule the admin sets, and the catalogue comes from the supplier's daily file. Bring the panel up to it, **in the seven steps below, one at a time**.

**Read first**, in the `radhe-api` repository (the sibling folder `../radhe-api`):

- `doc/VARIANT_IMAGES.md`: pictures per pack size (step 1).
- `doc/SUPPLIER_IMPORT.md`: the supplier's file, the price rule, the review list, the check before activation, merging (steps 2 to 7).
- `doc/ADMIN_API_DOCUMENTATION.md`, section 8 ("Images of a pack size") and section 31.

They hold the complete contract. This prompt repeats what you need most; where the two differ, the documents are right. If you cannot read that repository, ask for the files. All calls use the existing admin session and API client.

**Do not change the theme, colours, fonts, typography or any unrelated functionality.** Reuse the panel's cards, tables, dialogs, badges, form fields, toasts and formatters. **The wholesale part of the panel must keep working exactly as it does**: its pictures stay on the wholesale product, with its own endpoints and its limit of 12.

## How to work

1. Write a short plan for all seven steps and wait for my go.
2. Do **one step**, run the panel's lint, type check and tests, update the mock API in `mocks/` so that the tests and the offline mode match the real API, and report what you built and what you left out.
3. Wait for my go before the next step.

Step 1 is urgent: the old picture endpoints are gone, so the product page's picture section fails against the new API until step 1 is done. Steps 2 to 7 add screens that do not exist yet.

Units used everywhere: money in **cents** (buying prices and calculation steps may have decimals), VAT in **hundredths of a percent** (`700` = 7 %), percentages of the price rule as plain numbers with up to two decimals (`35` = 35 %). Reading needs the permission `catalog.read`, writing `catalog.manage`. Buying prices, markups and supplier lines must not be shown to a role without `catalog.read`.

---

## Step 1: pictures belong to the pack size

### What changed in the API

- A picture belongs to **one pack size** of a retail product. The product itself has none.
- At most **8 pictures per pack size**, one of them the main picture.
- Pictures are **optional**. A pack size without pictures is shown in the shop with a placeholder.
- The old endpoints `…/products/{id}/images…` answer `404`.

All calls are under `/v1/admin/products/{id}/variants/{variantId}/images` and answer `{ "product": { … } }`, the whole admin product:

| Call                        | Body                                               | Notes                                                                                                       |
| --------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST …/images`             | multipart, field `files` (1 to 10)                 | `201`. The first picture of a pack size becomes its main picture. If one file is refused, none is kept.     |
| `POST …/images/copy`        | `{ "fromVariantId": "…", "imageIds"?: ["…"] }`     | Copies pictures of another pack size of the same product; without `imageIds`, all. No file is stored twice. |
| `PUT …/images/order`        | `{ "orderedIds": ["…"] }`                          | Every picture of the pack size exactly once.                                                                |
| `PUT …/images/{imageId}`    | multipart, field `file`                            | Replaces the file; position, description and main-picture setting stay.                                     |
| `PATCH …/images/{imageId}`  | `{ "alt"?: { "en"?, "de"? }, "isPrimary"?: true }` |                                                                                                             |
| `DELETE …/images/{imageId}` |                                                    | If it was the main picture, the first remaining one becomes it.                                             |

File rules are unchanged: JPEG, PNG or WebP, at most 10 MB, at least 200 px on each side, at most 10 files per request.

Errors: `400 IMAGE_LIMIT_REACHED` (`details: { maximum: 8, remaining }`), `400 IMAGE_REQUIRED`, `400 IMAGE_FORMAT_NOT_ALLOWED` / `IMAGE_DIMENSIONS_INVALID` / `IMAGE_INVALID` (`details.files` names every refused file), `413 FILE_TOO_LARGE`, `400` / `409 IMAGE_ORDER_INVALID`, `400 VALIDATION_FAILED` (copying from the pack size itself), `404 PRODUCT_NOT_FOUND`, `404 PRODUCT_VARIANT_NOT_FOUND`, `404 IMAGE_NOT_FOUND`, `503 STORAGE_UNAVAILABLE`.

The admin product answer:

- Each entry of `variants`, and `defaultVariant`, has `images: AdminImage[]` in the admin's order, with `isPrimary` on the main one. Two pack sizes that show the same file have entries with different `id` and the same `url`.
- `images` on the product detail is **gone**.
- `imageCount` counts the pictures of all pack sizes. `image` (the thumbnail for lists) is unchanged in shape.

### Where to change the panel

| File                                                                                                                    | Change                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/api/types/catalog.ts`                                                                                          | Add `images: AdminImage[]` to `ProductVariant`. Remove `images` from `ProductDetail`. Replace `IMAGE_RULES.maxImagesPerProduct` (12) by a limit per owner: 8 for a retail pack size, 12 for a wholesale product.                       |
| `src/lib/api/endpoints/catalog.ts`                                                                                      | `uploadImages`, `reorderImages`, `replaceImage`, `patchImage`, `removeImage` of products take a `variantId` and call the new paths. Add `copyImages(id, variantId, { fromVariantId, imageIds? })`.                                     |
| `src/features/catalogue/queries.ts`                                                                                     | `ImageOwner` / `ImageTarget` / `retailImages`: the owner of a gallery is now a pack size (product id + variant id). The target carries the limit and the pictures. Add a `useCopyImages` mutation. Keep the wholesale target as it is. |
| `src/features/catalogue/image-manager.tsx`                                                                              | Take the pictures and the limit from the target instead of `product.images` and `IMAGE_RULES.maxImagesPerProduct`. This component is also used by `src/features/wholesale/product-view.tsx`: that use must not change.                 |
| `src/features/catalogue/product-view.tsx`                                                                               | Remove the product-level `<ImageManager product={data} />` from the side column.                                                                                                                                                       |
| `src/features/catalogue/variant-rows.tsx`, `product-form.tsx`                                                           | Each pack-size section gets its gallery (the same `ImageManager`, with the target of that pack size).                                                                                                                                  |
| `src/features/catalogue/new-product-pictures.tsx`, `product-new-view.tsx`, `useCreateProductWithImages` in `queries.ts` | Pictures are chosen per pack-size row. After the product is created, upload each row's files to its pack size. Match rows to `product.variants` by pack value and unit, not by position: the API answers smallest first.               |
| `src/features/catalogue/image-rules.ts`                                                                                 | Texts and `remainingImages` use the limit of the owner.                                                                                                                                                                                |
| `mocks/modules/catalog.ts`, `mocks/media.ts`, `mocks/seed.ts`, `mocks/domain.ts`                                        | The mock API: pictures on pack sizes, the new paths, the copy call, the limit of 8.                                                                                                                                                    |
| `src/features/catalogue/catalogue-flows.test.tsx`, `product-schema.test.ts`, `image-rules.test.ts`                      | Update to the new shape.                                                                                                                                                                                                               |

### What the screen does

1. **A gallery in each pack-size section**: upload several files (show the refused files from `details.files`), drag to reorder, make main picture, description in English and German, replace file, delete, a counter "3 of 8", upload disabled at 8.
2. **"Copy from another pack size"**, shown only when the product has more than one pack size: a dialog lists the other pack sizes with their pictures as thumbnails and checkboxes; "Copy" sends `fromVariantId` and the ticked `imageIds`. Pictures this pack size shows already (same `url`) are shown ticked and disabled.
3. **Empty state**: the placeholder and "No picture: the shop shows the placeholder".
4. **Product lists** keep their thumbnail from `image`.
5. **Deleting a pack size**: the confirmation says its pictures are deleted with it.
6. **Copying a product**: the option reads "copy the pictures of each pack size".

Every call answers the whole product: put it into the query cache as the product (as the panel does today) instead of patching single fields.

---

## Step 2: pricing settings (markup, fulfilment cost, safety buffer, brands)

A new settings page, next to "Delivery fee" under Settings (`src/app/(panel)/settings/(shop)/…`). Suggested name: "Pricing & supplier".

`GET /v1/admin/supply/settings` answers `{ settings }`; `PUT` takes the same document and answers `{ settings, repriced }`:

```json
{
  "safetyUnits": 5,
  "pricing": {
    "fulfilmentPercent": 10,
    "extraPercent": 0,
    "extraAmount": 0,
    "markupPercent": 35
  },
  "brands": [
    { "prefix": "AB", "name": "AliBaba" },
    { "prefix": "NW Pooja", "name": "" }
  ],
  "publishCheck": true
}
```

How a selling price is calculated, to explain on the page:

> buying price + `fulfilmentPercent` of it + `extraPercent` of it + `extraAmount` cents, then + `markupPercent` of all that, then + the VAT of the product. Rounded to the cent at the end only.

Fields and their meaning for the owner:

| Field               | Label                   | Meaning                                                                                           | Limits                |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- | --------------------- |
| `fulfilmentPercent` | Fulfilment cost (%)     | What handling an order costs, as a percentage of the buying price.                                | 0 to 1000, 2 decimals |
| `extraPercent`      | Other expenses (%)      | Further costs as a percentage of the buying price.                                                | 0 to 1000, 2 decimals |
| `extraAmount`       | Other expenses per pack | A fixed amount per pack. Enter in euros, send whole cents.                                        | 0 to 100000 cents     |
| `markupPercent`     | Markup (%)              | The profit added on the buying price and all charges. A markup, not a margin.                     | 0 to 1000, 2 decimals |
| `safetyUnits`       | Safety buffer (units)   | Units of the supplier's stock that are never offered. Applies from the next upload; say so.       | whole, 0 to 1000      |
| `publishCheck`      | Check before activation | Whether a product must be complete before it can be activated.                                    | switch                |
| `brands`            | Brand list              | Maps the prefix before the colon in the supplier's names to a brand. An empty name = not a brand. | up to 2000 rows       |

Behaviour:

- A live example under the form: buying price 1.38 €, VAT 7 % → the steps and the price (2.19 € with the defaults), recalculated as the admin types.
- Saving shows "`repriced` prices changed". Ask for confirmation first when a value of `pricing` changed: every calculated price in the shop changes at once.
- `brands` may be left out of the `PUT` to keep the list as it is; send it only when the admin edited it.
- **VAT is not set here.** It is a field of each product (`vatRate`, already in the product form), filled from the supplier's file for new products.
- **What the customer pays for delivery is not set here** either: that is the existing "Delivery fee" page, which stays as it is.

Files: a new route under `src/app/(panel)/settings/(shop)/`, a new feature folder (for example `src/features/supply/`), endpoints in a new `src/lib/api/endpoints/supply.ts`, types in `src/lib/api/types/supply.ts`, the navigation entry where the settings pages are listed, and the mock in `mocks/modules/`.

---

## Step 3: buying price and price rule on products and categories

### Pack sizes

`POST` / `PATCH /v1/admin/products/{id}/variants…` accept, and the admin answers of a pack size include:

- `cost`: the buying price in cents, decimals allowed, `null` removes it.
- `priceMode`: `auto` (the regular price follows the calculation) or `manual` (only the admin changes it). Sending a `regularPrice` without `priceMode` makes the pack size `manual`.

In each pack-size section: show the buying price, a switch "price follows the buying price" (`auto` / `manual`), and make the regular-price field read-only with the note "calculated" while it is `auto`.

### The breakdown

`GET /v1/admin/supply/products/{id}/pricing`:

```json
{
  "productId": "…",
  "vatRate": 700,
  "vatPercent": 7,
  "rule": {
    "fulfilmentPercent": 10,
    "extraPercent": 0,
    "extraAmount": 0,
    "markupPercent": 35
  },
  "sources": {
    "fulfilmentPercent": "shop",
    "extraPercent": "shop",
    "extraAmount": "shop",
    "markupPercent": "category"
  },
  "override": null,
  "variants": [
    {
      "variantId": "…",
      "sku": "RF-00001",
      "packSize": { "value": 100, "unit": "g" },
      "priceMode": "auto",
      "cost": 138,
      "calculated": {
        "cost": 138,
        "fulfilment": 13.8,
        "extra": 0,
        "markup": 53.13,
        "net": 204.93,
        "vat": 14.3451,
        "price": 219
      },
      "regularPrice": 219,
      "salePrice": null,
      "price": 219,
      "profit": {
        "net": 205,
        "costs": 151.8,
        "profit": 53.2,
        "markupPercent": 35.05,
        "marginPercent": 25.95
      },
      "stock": 8,
      "supplier": {
        "itemId": "…",
        "name": "AB: 100g Black Pepper Powder",
        "quantity": 13,
        "cost": 138,
        "vatRate": 700,
        "hints": [],
        "lastSeenAt": "…",
        "missingSince": null
      }
    }
  ]
}
```

A "Pricing" block on the product page, per pack size: buying price, fulfilment, other expenses, markup, net, VAT, calculated price; the price customers pay now; profit with markup and margin; the supplier's line with its quantity, when it was last in the file, and its hints. `calculated` and `profit` are `null` without a buying price. A negative `profit.profit` (a manual price below cost) is shown as a warning.

### Overrides

- Products: `POST` / `PATCH /v1/admin/products…` accept `pricing: { fulfilmentPercent?, extraPercent?, extraAmount?, markupPercent? }`, `null` removes it; the detail answer includes `pricing`.
- Categories: `POST` / `PATCH /v1/admin/categories…` accept the same `pricing`, and `nonFood` (boolean, default false; it counts for the categories below).

A small form "price rule of this product" on the product page and "price rule of this category" on the category page: four optional fields, each showing where the value comes from when it is left empty (`sources`: `shop`, `category`, `product`). On the category page also a switch "goods that are not food". Saving recalculates the calculated prices under it in the same request; reload the breakdown.

Files: `src/features/catalogue/product-view.tsx`, `product-form.tsx`, `variant-rows.tsx`, `product-schema.ts`, `category-dialog.tsx`, `category-schema.ts`, the types and endpoints of step 2, the mocks.

---

## Step 4: the check before activation

`PATCH /v1/admin/products/{id}` with `status: "active"` on a draft or archived product can answer `409 PRODUCT_NOT_READY` with `details: { missing, warnings }`. The product then stays as it was.

`GET /v1/admin/products/{id}/readiness` answers `{ "readiness": { "ready", "missing", "waived", "warnings" }, "enforced" }`. `enforced` is false while `publishCheck` is switched off in the settings of step 2.

| `missing`                                                                  | The product needs                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `category`                                                                 | a category other than "Unsorted"                                                   |
| `name_de`                                                                  | food: the German name                                                              |
| `ingredients_de`                                                           | food: the ingredients in German                                                    |
| `allergens_de`                                                             | food: the allergens in German ("Keine" where there are none)                       |
| `responsible_business`                                                     | food: name and address of the responsible business in the EU (`food.manufacturer`) |
| `alcohol`, `tobacco`, `deposit`, `fireworks`, `hair_dye`, `health_product` | a decision: the supplier's line marks goods with rules of their own                |

`warnings` hold nothing up: `image` (a pack size that is switched on has no picture), `nutrition_de`, `origin`, `storage_instructions_de`, `description`, and for goods that are not food `responsible_business`.

A check that does not apply is waived on the product: `PATCH` with `publishWaivers: ["ingredients_de"]` (the whole list is replaced; the detail answer includes `publishWaivers`). `image` cannot be waived any more: it is not a check.

On the product page: a checklist. Each entry of `missing` links to the field that fills it and can be waived with a confirmation ("does not apply to this product"); `waived` entries are shown as such and can be taken back; `warnings` are shown as hints. The "Activate" action shows the list when the answer is `PRODUCT_NOT_READY`, instead of a bare error.

---

## Step 5: uploading the supplier's file

A page "Supplier file" under Catalogue.

1. The admin chooses the CSV. Parse it in the browser and send **every row as an object with the column names of the file as keys and the cells as text** (`Cost`, `Name`, `Quantity On Hand`, `Sales Taxes`, `Unit of Measure`). At most 20,000 rows. This is **not** the existing "Import or export" dialog of the catalogue, which stays as it is.
2. `POST /v1/admin/supply/import/preview` with `{ rows, fileName }`. Nothing is written. Show `summary` as tiles (`rows`, `create` in `newProducts` products, `update`, `unchanged`, `review`, `missing`, `error`, and the changes of stock, buying price and price) and the `rows` in tabs by `action` (`create`, `update`, `review`, `missing`, `error`). For `update`, show `changes` as before → after (`stock`, `cost`, `price` are `[before, after]`). Show `problems`, `notes` (`vat_differs`, `no_cost`) and `hints` as badges.
3. A button "Import" sends the same body to `POST /v1/admin/supply/import`. It answers the same report with `applied: true`.
4. `409 SUPPLY_FILE_INCOMPLETE` (`details: { known, missing }`): more than half of the supplier's products are not in the file. Show the two numbers and, if the admin confirms, send the body again with `"allowMissing": true`.
5. Below, the history: `GET /v1/admin/supply/imports` → `{ items: [{ id, fileName, rows, summary, durationMs, admin, createdAt }] }`.

An upload of about 5,500 rows takes up to a minute: show progress and do not let the admin start a second one meanwhile.

---

## Step 6: the review list

A page "Supplier lines" with the lines of the file that could not become products by themselves.

- Tabs and their numbers: `GET /v1/admin/supply/items/counts` → `{ review, linked, missing, problems: { no_size: 499, … }, hints: { deposit: 69, … } }`.
- Rows: `GET /v1/admin/supply/items?state=review|linked|missing&problem=…&q=…&limit=…&cursor=…` → `{ items, nextCursor }`. An item: `id`, `name` (the supplier's line), `brand`, `title`, `packSize`, `unitOfMeasure`, `perKilogram`, `cost`, `quantity`, `vatRate`, `state`, `problems`, `hints`, `overrides`, `ready`, `renameOf`, `productId`, `variantId`, `sku`, `firstSeenAt`, `lastSeenAt`, `missingSince`.
- A row opens a small form, saved with `PATCH /v1/admin/supply/items/{id}`: `{ packSize?: { value, unit }, brand?, title?, cost?, vatRate? }`, `null` removes a value. Units: `g`, `kg`, `ml`, `l`, `pcs`.
- When `ready` is true: "Create as draft" → `POST …/items/{id}/resolve` with `{ "as": "new" }`. `409 SUPPLIER_ITEM_INCOMPLETE` lists `details.problems`.
- `possible_rename`: two buttons, "Same product as `renameOf.name`" (`{ "as": "same" }`) and "New product" (`{ "as": "new" }`).
- `duplicate_listing`: show "Second listing of `renameOf.name`; the shop follows that line" and one button "Follow this line instead" (`{ "as": "same" }`). These rows need nothing done: give them a tab of their own.

What each problem means and what the admin does is in the table "Lines that wait for a person" of `doc/SUPPLIER_IMPORT.md`; use its wording for the labels and hints.

---

## Step 7: merging two products that are the same article

`POST /v1/admin/supply/products/{id}/merge` with `{ "fromProductId": "…" }` merges that product into the one of the URL. Answer:

```json
{
  "productId": "…",
  "removedProductId": "…",
  "moved": [
    {
      "variantId": "…",
      "sku": "RF-00412",
      "packSize": { "value": 1.2, "unit": "kg" }
    }
  ],
  "duplicates": [
    {
      "packSize": { "value": 400, "unit": "g" },
      "variantId": "…",
      "sku": "RF-00411",
      "removedSku": "RF-00413"
    }
  ],
  "waiting": [
    { "itemId": "…", "name": "Ashoka: 400g Paratha Aloo", "sku": "RF-00411" }
  ]
}
```

Errors: `409 PRODUCT_IS_ACTIVE` (the other product is shown in the shop: archive it first), `409 PRODUCT_IN_USE` (an order holds it), `400 PRODUCT_VARIANT_INVALID` (one is sold by weight and the other by volume or pieces, or the pack sizes together are too many), `404 PRODUCT_NOT_FOUND`.

On the product page, an action "Merge another product into this one": the admin searches the other product; a confirmation shows both side by side with their pack sizes and says what happens: the pack sizes of the other move here with their stock, buying prices and pictures; a pack size both have stays as this product has it; the other product is removed with its texts; it **cannot be undone**. After the call, load the page again and show `duplicates` and `waiting` in the success message.

**Build this step last and ask me before building it:** the rules for a pack size that both products have are still being decided with the owner.
