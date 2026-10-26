# Wholesale catalogue (B2B)

The wholesale site (`https://radhefoods.de`) sells by the carton to shops, restaurants and other businesses. It has a catalogue of its own: **wholesale categories** and **wholesale products with SKUs**, each SKU a pack size and the carton it comes in (1 kg × 20, 5 kg × 4, 20 kg × 1), with its **stock in cartons** and a ledger of every change. The admin manages it in the admin panel, apart from the retail catalogue; the wholesale site reads it (never the stock); the quotation system (`doc/QUOTATIONS.md`) names its SKUs and takes their stock when a quotation is accepted.

Base URL and conventions (errors, validation, pagination, images) are the ones of `doc/ADMIN_API_DOCUMENTATION.md` section 0 and `doc/CUSTOMER_WEB_API_DOCUMENTATION.md` section 0. Texts are English with optional German, like the retail catalogue: `{ "en": "Rice", "de": "Reis" }`. The wholesale site shows no prices.

## Contents

1. Architecture
2. Data model (collections, schemas, indexes)
3. Admin API: wholesale categories (`/v1/admin/wholesale/categories`)
4. Admin API: wholesale products and SKUs (`/v1/admin/wholesale/products`)
5. Admin API: images
6. Admin API: copy from retail
7. Admin API: CSV import and export (`/v1/admin/wholesale/import`, `…/export`)
8. Admin API: stock (`…/skus/{skuId}/stock`, `…/stock-movements`)
9. Public API for the wholesale site (`/v1/b2b/…`)
10. Validation rules
11. Errors and permissions
12. Integration workflows (admin panel, wholesale site, server)

---

## 1. Architecture

```text
Admin panel ──► /v1/admin/wholesale/categories ─┐
            ──► /v1/admin/wholesale/products  ──┼──► wholesaleCategories, wholesaleProducts (MongoDB)
            ──► /v1/admin/wholesale/import    ──┘          │                      │
                                                            ▼                      ▼
Wholesale site ──► /v1/b2b/categories, /v1/b2b/products ◄── visible categories, offered products with cartons
               ──► /v1/b2b/quotations (doc/QUOTATIONS.md) ── names skuId + cartons; the line copies name, SKU, pack, carton, VAT
Retail shop ──► unchanged. "Copy from retail" reads a retail product once.
```

**Why a separate collection.** A wholesale product differs from the retail one: another range (sacks that the shop never sells), its own texts and pictures, its own order per category, cartons instead of prices and stock. Keeping it in the retail `products` collection would have put wholesale sacks into the shop or taught the retail schema about channels. So the wholesale catalogue has its own two collections and its own endpoints, and shares with retail only what is the same: the media service (uploads, sizes, CDN), the pack-size units and labels, the VAT rate convention, the admin authentication, and the shape of the CSV import. Nothing is duplicated live: **Copy from retail** copies a retail product once (texts, images as files of their own); afterwards the two are not linked, and `retailProductId` only says where the copy came from.

**What the quotation system uses.** A quotation line names a wholesale product and SKU (`productId`, `skuId`) and copies name, SKU, pack size, packs per carton and VAT rate at the request, so a quotation reads the same after the catalogue changes. A SKU can be asked for when its product is `active` and `isAvailable` and the SKU `isEnabled`.

---

## 2. Data model

### `wholesaleCategories`

| Field | Type | Meaning |
|---|---|---|
| `name` | `{ en, de? }` | |
| `slug` | `{ en, de }` | URL; both filled in (German generated from the German name, else the English slug). Unique per language |
| `description` | `{ en?, de? }` | |
| `sortOrder` | int | Position in the list, 0 first |
| `isVisible` | boolean | Hidden: neither the category nor its products are on the site |
| `image` | stored image | One picture, three widths |
| `createdBy`, `updatedBy`, `createdAt`, `updatedAt` | | |

Indexes: unique `slug.en`, unique `slug.de`, `(sortOrder, _id)`.

### `wholesaleProducts`

| Field | Type | Meaning |
|---|---|---|
| `name`, `slug`, `sortName` | translated | `slug` unique per language; `sortName` for the name sort |
| `subtitle`, `shortDescription`, `description` | `{ en?, de? }` | |
| `highlights` | `{ en: string[], de: string[] }` | Bullet points |
| `brand` | string | |
| `categoryId` | ObjectId | A wholesale category |
| `skus[]` | embedded, see below | At least one, at most 20 |
| `vatRate` | int | Hundredths of a percent, 700 = 7 %. The quotation uses it |
| `status` | `draft` \| `active` \| `archived` | Only `active` products are on the site |
| `isAvailable` | boolean | "Currently not available" when false; cannot be asked for |
| `sortOrder` | int | Position within the category, 0 first |
| `storageType` | `ambient` \| `chilled` \| `frozen` | |
| `images[]`, `primaryImageId` | stored images | Up to 12 |
| `food` | object | `ingredients`, `allergens`, `nutrition`, `storageInstructions` (translated free text), `origin`, `manufacturer` |
| `searchKeywords`, `searchTokens` | string[] | Search words; tokens maintained on every save |
| `retailProductId` | ObjectId | Set by Copy from retail, for reference only |
| `publishedAt` | date | First time `active` |

A SKU (`skus[]`):

| Field | Type | Meaning |
|---|---|---|
| `_id` | ObjectId | **`skuId`**: what a quotation request names |
| `sku` | string | Article number, upper-case, unique across the wholesale catalogue; generated `RFW-00001…` when left out |
| `packSize` | `{ value, unit, baseQuantity }` | Units `g`, `kg`, `ml`, `l`, `pcs`; `baseQuantity` in g / ml / pcs decides the order |
| `unitsPerCarton` | int 1–1000 | Packs in a carton |
| `isEnabled` | boolean | A disabled SKU is not offered |
| `stock` | int | Cartons on hand; below zero is a shortage. Written only through the stock ledger (section 8); never on the site |
| `createdAt` | date | |

Rules: all SKUs of a product share one unit family (weight, volume or pieces); the same pack size with the same carton may not appear twice (the same pack in two carton sizes, 1 kg × 10 and 1 kg × 20, is allowed); SKUs sort smallest pack first, then the smaller carton.

Indexes: unique `slug.en`, `slug.de`, `skus.sku`; `skus._id`; `(categoryId, sortOrder, _id)`; `(status, categoryId, sortOrder, _id)`; `(status, _id)`; `searchTokens`. Run `npm run db:indexes` after deploying.

### `wholesaleStockMovements`

The ledger of the stock of the SKUs, appended on every change, never edited (section 8).

| Field | Type | Meaning |
|---|---|---|
| `productId`, `skuId`, `sku` | ObjectId, ObjectId, string | The SKU, with its article number at the time |
| `reason` | `adjustment` \| `import` \| `quotation_accepted` | The admin in the panel, a CSV import, an accepted quotation |
| `delta` | int | Cartons in (positive) or out (negative) |
| `quantityBefore`, `quantityAfter` | int | The count around the change; `quantityAfter` may be below zero |
| `quotationId`, `quotationNumber` | ObjectId, string | The accepted quotation, for `quotation_accepted` |
| `adminId` | ObjectId | Who made the change or accepted the quotation |
| `note` | string ≤500 | Optional |
| `createdAt` | date | |

Indexes: `(productId, _id)`, `(productId, skuId, _id)`, and unique `(quotationId, skuId)` where `quotationId` exists: one deduction per quotation and SKU.

### Cartons as the API shows them

Every SKU answer carries `packSize { value, unit, label }` ("1 kg") and `carton { units, label, content }`: `units` 20, `label` "20 × 1 kg", `content { value: 20, unit: "kg", label: "20 kg" }` (kg or l from 1000 g / 1000 ml on; pieces for `pcs`). The public API flattens the carton into the SKU entry (`units`, `label`, `content` next to `skuId`, `sku`, `packSize`).

---

## 3. Admin API: wholesale categories

All under `/v1/admin/wholesale/categories` with the admin session. **Permissions:** `wholesale.read` to see, `wholesale.manage` to change.

| Endpoint | Body | Answer |
|---|---|---|
| `GET /v1/admin/wholesale/categories` | | `{ items: [category] }` in display order, every category, with `productCount` (every status) |
| `PUT /v1/admin/wholesale/categories/order` | `{ orderedIds: [id] }` (may be partial: the named come first, the others keep their order) | the whole list in its new order |
| `GET /v1/admin/wholesale/categories/{id}` | | `{ category }` |
| `POST /v1/admin/wholesale/categories` | `{ name: { en, de? }, slug?: { en?, de? }, description?: { en?, de? }, sortOrder?, isVisible? }` | `201 { category }` |
| `PATCH /v1/admin/wholesale/categories/{id}` | any of the create fields; translated fields replaced as a whole; the slug changes only when sent | `{ category }` |
| `DELETE /v1/admin/wholesale/categories/{id}` | | `204`; `409 WHOLESALE_CATEGORY_HAS_PRODUCTS` while products are in it |
| `GET /v1/admin/wholesale/categories/{id}/products` | | `{ items: [product summary] }` in display order, every status |
| `PUT /v1/admin/wholesale/categories/{id}/products/order` | `{ orderedIds: [productId] }` (may be partial) | `{ items }` in the new order, every product with its `sortOrder` |
| `PUT /v1/admin/wholesale/categories/{id}/image` | multipart, field `file` | `{ category }` |
| `PATCH /v1/admin/wholesale/categories/{id}/image` | `{ alt?: { en?, de? } }` | `{ category }` |
| `DELETE /v1/admin/wholesale/categories/{id}/image` | | `{ category }` |

The category object:

```json
{
  "id": "6710…",
  "name": { "en": "Rice", "de": "Reis" },
  "slug": { "en": "rice", "de": "reis" },
  "description": { "en": "Basmati, sona masoori and more." },
  "sortOrder": 0,
  "isVisible": true,
  "image": { "id": "…", "alt": { "en": "Sacks of rice", "de": null }, "isPrimary": false, "url": "https://cdn.…/large.webp", "sizes": { "small": {…}, "medium": {…}, "large": {…} }, "bytes": 123456, "uploadedAt": "…" },
  "productCount": 12,
  "createdAt": "…",
  "updatedAt": "…"
}
```

---

## 4. Admin API: wholesale products and SKUs

All under `/v1/admin/wholesale/products`. **Permissions:** `wholesale.read` / `wholesale.manage`.

### `GET /v1/admin/wholesale/products`

| Query | Meaning |
|---|---|
| `status` | `draft`, `active`, `archived` |
| `categoryId` | One wholesale category |
| `q` | Search words (name, subtitle, brand, keywords) or the beginning of an article number |
| `isAvailable` | `true` / `false` |
| `sort` | `newest` (default), `updated`, `name`, `sku` |
| `page`, `limit` | Pages, `limit` default 24, at most 100 |

Answer `{ items: [summary], page, limit, total, totalPages }`. **Summary:**

```json
{
  "id": "6711…",
  "name": { "en": "Daawat Basmati Rice", "de": "Daawat Basmati Reis" },
  "slug": { "en": "daawat-basmati-rice", "de": "daawat-basmati-reis" },
  "brand": "Daawat",
  "category": { "id": "6710…", "name": { "en": "Rice", "de": "Reis" } },
  "status": "active",
  "isAvailable": true,
  "sortOrder": 2,
  "vatRate": 700,
  "skus": [
    {
      "id": "6712…",
      "sku": "RFW-00001",
      "packSize": { "value": 1, "unit": "kg", "label": "1 kg" },
      "unitsPerCarton": 20,
      "carton": { "units": 20, "label": "20 × 1 kg", "content": { "value": 20, "unit": "kg", "label": "20 kg" } },
      "isEnabled": true,
      "createdAt": "…"
    },
    { "id": "6713…", "sku": "RFW-00002", "packSize": { "value": 5, "unit": "kg", "label": "5 kg" }, "unitsPerCarton": 4, "carton": { "units": 4, "label": "4 × 5 kg", "content": { "value": 20, "unit": "kg", "label": "20 kg" } }, "isEnabled": true, "createdAt": "…" }
  ],
  "skuCount": 2,
  "imageCount": 3,
  "image": { "id": "…", "alt": "Daawat Basmati Rice", "isPrimary": true, "url": "…", "sizes": {…} },
  "retailProductId": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

### `GET /v1/admin/wholesale/products/{id}`

`{ product }`: the summary plus `subtitle`, `shortDescription`, `description` (each `{ en, de }` or `null`), `highlights { en[], de[] }`, `categoryId`, `storageType`, `food { ingredients, allergens, nutrition, storageInstructions, origin, manufacturer }`, `searchKeywords[]`, `images[]` (admin image views, in display order, `isPrimary` on the main one), `publishedAt`.

### `POST /v1/admin/wholesale/products`

```json
{
  "name": { "en": "Daawat Basmati Rice", "de": "Daawat Basmati Reis" },
  "slug": { "en": "daawat-basmati-rice" },
  "subtitle": { "en": "Aged two years" },
  "shortDescription": { "en": "Extra long grain basmati." },
  "description": { "en": "…" },
  "highlights": { "en": ["Aged 2 years", "Extra long grain"] },
  "brand": "Daawat",
  "categoryId": "6710…",
  "skus": [
    { "packSize": { "value": 1, "unit": "kg" }, "unitsPerCarton": 20 },
    { "sku": "DW-BASMATI-5", "packSize": { "value": 5, "unit": "kg" }, "unitsPerCarton": 4 },
    { "packSize": { "value": 20, "unit": "kg" }, "unitsPerCarton": 1, "isEnabled": false }
  ],
  "vatRate": 700,
  "status": "active",
  "isAvailable": true,
  "storageType": "ambient",
  "food": { "origin": "India", "ingredients": { "en": "Basmati rice" } },
  "searchKeywords": ["Basmatireis"]
}
```

`201 { product }`. Only `name.en`, `categoryId`, `skus` (1–20) and `vatRate` are required. Slugs are generated from the name when left out; article numbers `RFW-00001…` when left out. New products are `draft` unless `status` says otherwise; a new product takes the last position of its category unless `sortOrder` is sent.

### `PATCH /v1/admin/wholesale/products/{id}`

Any of the create fields except `skus`. Send only what changes; translated fields, `highlights` and `food` are replaced as a whole; `brand: null` removes the brand; a new `slug` renames the URL (renaming the product does not); a new `categoryId` moves the product to the last position of that category unless `sortOrder` is sent too. `{ product }`.

### `DELETE /v1/admin/wholesale/products/{id}`

`204`. Deletes the product and its image files. Allowed in every status: quotations keep their own copy of every line.

### SKUs

| Endpoint | Body | Answer |
|---|---|---|
| `POST /v1/admin/wholesale/products/{id}/skus` | `{ sku?, packSize: { value, unit }, unitsPerCarton, isEnabled?, stock? }` | `201 { product }`; `stock` is the opening count, default 0 |
| `PATCH /v1/admin/wholesale/products/{id}/skus/{skuId}` | any of those fields except `stock` | `{ product }` |
| `PUT /v1/admin/wholesale/products/{id}/skus/{skuId}/stock` | `{ quantity }` or `{ delta }`, `note?` | `{ product, sku, movement }` (section 8) |
| `DELETE /v1/admin/wholesale/products/{id}/skus/{skuId}` | | `200 { product }`; `409 WHOLESALE_SKU_LAST` for the last SKU |

The admin SKU answer: `{ id, sku, packSize { value, unit, label }, unitsPerCarton, carton { units, label, content }, isEnabled, stock, createdAt }`; the product summary and detail add `stock { quantity, shortSkus }` over all SKUs.

---

## 5. Admin API: images

The same endpoints and rules as retail product images (`doc/ADMIN_API_DOCUMENTATION.md` section 8), under the wholesale product:

| Endpoint | Body | Answer |
|---|---|---|
| `POST /v1/admin/wholesale/products/{id}/images` | multipart, field `files` (up to 10; JPEG, PNG, WebP) | `201 { product }`; the first image becomes the main image |
| `PUT /v1/admin/wholesale/products/{id}/images/order` | `{ orderedIds: [imageId] }` (every image once) | `{ product }` |
| `PUT /v1/admin/wholesale/products/{id}/images/{imageId}` | multipart, field `file` | `{ product }` (position, description and main setting kept) |
| `PATCH /v1/admin/wholesale/products/{id}/images/{imageId}` | `{ alt?: { en?, de? }, isPrimary?: true }` | `{ product }` |
| `DELETE /v1/admin/wholesale/products/{id}/images/{imageId}` | | `{ product }`; the first remaining image becomes the main one |

Files live under `wholesale/products/{id}/…` and `wholesale/categories/{id}/…` in the storage, at most 12 images per product.

---

## 6. Admin API: copy from retail

### `POST /v1/admin/wholesale/products/from-retail`

```json
{
  "productId": "66f3…",
  "categoryId": "6710…",
  "skus": [
    { "packSize": { "value": 1, "unit": "kg" }, "unitsPerCarton": 20 },
    { "packSize": { "value": 20, "unit": "kg" }, "unitsPerCarton": 1 }
  ],
  "status": "draft",
  "copyImages": true
}
```

`201 { product }`: a new wholesale product with the retail product's name, subtitle, descriptions, highlights, brand, VAT rate, availability, storage type, food information and search keywords, in the wholesale category given, with the SKUs given. Without `skus`, every pack size of the retail product becomes a SKU with **one pack per carton**, to be corrected afterwards. `copyImages` (default true) copies the images as files of their own, so deleting either product never affects the other. The retail product is not changed. `retailProductId` on the copy says where it came from; nothing else links the two. Slugs and article numbers are generated (`moong-dal`, then `moong-dal-2` for a second copy).

---

## 7. Admin API: CSV import and export

The same two-step flow, request and report as the retail import (`doc/CSV_IMPORT_EXPORT.md` describes the flow, the panel's part and the rules; everything there holds here except the columns and the stock, prices and parents, which the wholesale catalogue does not have).

| Endpoint | Meaning |
|---|---|
| `POST /v1/admin/wholesale/import/preview` | `{ categories?: [row], products?: [row], existing?: "skip" \| "update" }` → the report, nothing written |
| `POST /v1/admin/wholesale/import` | the same body → the report after writing |
| `GET /v1/admin/wholesale/export?type=categories\|products` | `{ type, columns, rows }` |

Report: `{ categories: { summary, rows, unknownColumns }, products: {…}, applied, stoppedAt }`; a product row carries `skuId` (the retail report's `variantId`). Permissions: `wholesale.manage` to import, `wholesale.read` to export. Example files: `doc/examples/wholesale-categories-example.csv`, `doc/examples/wholesale-products-example.csv`.

### Columns: categories

| Column | Required | Meaning |
|---|---|---|
| `slug_en` | for updates | The key. Generated from `name_en` on a create when empty |
| `slug_de` | no | Generated when empty |
| `name_en` | for creates | |
| `name_de` | no | |
| `description_en`, `description_de` | no | |
| `sort_order` | no | 0–100000. Default: last |
| `is_visible` | no | Default yes |

### Columns: products (one row per SKU)

Rows with the same `slug_en` (or, without a slug, the same `name_en`) are one product; its product columns are read from its first row. A row is matched by `sku` to a SKU; a row without a SKU on a product that exists names its SKU by `pack_value`, `pack_unit` and `units_per_carton` (or the only SKU the product has). A further SKU of a new product needs a `sku`.

| Column | Required | Meaning |
|---|---|---|
| `sku` | for updates and further SKUs of a new product | The key; generated `RFW-…` when empty on the first row of a new product |
| `name_en` | for creates | |
| `name_de`, `slug_en`, `slug_de`, `subtitle_*`, `short_description_*`, `description_*` | no | |
| `highlights_en`, `highlights_de` | no | `\|` separated, at most 20 |
| `brand` | no | |
| `category_slug` | for creates | `slug_en` of a wholesale category: an existing one or a row of the categories sheet of the same import |
| `pack_value`, `pack_unit` | for creates | SKU. `5` and `kg`; units `g`, `kg`, `ml`, `l`, `pcs`; one unit family per product |
| `units_per_carton` | for creates | SKU. 1–1000 |
| `sku_enabled` | no | SKU. Default yes |
| `stock` | no | SKU. Cartons on hand, integer, may be negative. On a create: the opening count (default 0). On an update: sets the count through the stock ledger (reason `import`); **a blank cell leaves the stock as it is** |
| `vat_rate` | for creates | Percent: `7` or `19` |
| `status` | no | `draft` (default), `active`, `archived` |
| `is_available` | no | Default yes |
| `sort_order` | no | Position in the category |
| `storage_type` | no | `ambient` (default), `chilled`, `frozen` |
| `ingredients_*`, `allergens_*`, `nutrition_*`, `storage_instructions_*`, `origin`, `manufacturer` | no | Food information |
| `search_keywords` | no | `\|` separated, at most 30 |

Images are not part of the sheets. On an update, an empty cell leaves the value as it is; `existing: skip` (default) never changes a record that exists.

---

## 8. Admin API: stock

Every SKU carries **`stock`: cartons on hand**, kept by the admin, apart from the retail stock and never shown on the wholesale site. Behind the number is a ledger, `wholesaleStockMovements`, with one entry per change: who, when, why, the count before and after. Nothing writes the number except the three ways below, and each of them writes a ledger entry.

| Change | Reason in the ledger | Entry |
|---|---|---|
| The admin sets or adjusts the count (`PUT …/stock`), or creates a SKU with an opening `stock` | `adjustment` | `delta`, before, after, `note` ("Opening stock" for a new SKU) |
| A CSV import with a `stock` cell, or a new SKU from a sheet with one | `import` | note "CSV import" / "Opening stock" |
| A quotation is accepted (`POST /v1/admin/quotations/{id}/accept`) | `quotation_accepted` | one entry per line with `quotationId` and `quotationNumber` |

**Rules**

- A quotation request and a quotation sent never touch the stock. Only accepting takes the cartons of every line, once.
- Taking more than there is is allowed: the count goes below zero and marks a **shortage** the admin resolves by hand. Nothing is refused for want of stock.
- The deduction is atomic per SKU (one `$inc`) and idempotent per quotation: the ledger refuses a second entry for the same quotation and SKU, and a repeated call gives the cartons back and reports the entry made earlier. Two admins accepting at once: the status change `sent → accepted` lets only one through.
- "Copy from retail" starts every SKU at 0; the retail stock is not copied.
- Changing a SKU (`PATCH …/skus/{skuId}`) refuses a `stock` field (`400 VALIDATION_FAILED`): the ledger would miss it.

### `PUT /v1/admin/wholesale/products/{id}/skus/{skuId}/stock`

Body: `{ quantity }` (the exact count, as after counting the warehouse) **or** `{ delta }` (cartons to add or remove), with an optional `note` (≤500). Integers between −1000000 and 1000000.

```json
{ "quantity": 35, "note": "Counted on Monday" }
```

Answer: `{ product, sku, movement }` — the product as `GET …/{id}` answers it, the SKU, and the ledger entry, or `movement: null` when the count did not change.

```json
{
  "product": { "…": "" },
  "sku": { "id": "6712…", "sku": "RFW-00012", "stock": 35, "…": "" },
  "movement": {
    "id": "6720…", "productId": "66f3…", "skuId": "6712…", "sku": "RFW-00012",
    "reason": "adjustment", "delta": -5, "quantityBefore": 40, "quantityAfter": 35,
    "quotationId": null, "quotationNumber": null,
    "adminId": "6650…", "admin": { "id": "6650…", "name": "Vrushabh" },
    "note": "Counted on Monday", "createdAt": "2026-10-26T09:00:00.000Z"
  }
}
```

Errors: `400 STOCK_CHANGE_INVALID` (both or neither of `quantity` and `delta`), `404 WHOLESALE_PRODUCT_NOT_FOUND`, `404 WHOLESALE_SKU_NOT_FOUND`.

### `GET /v1/admin/wholesale/products/{id}/stock-movements?skuId=&page=&limit=`

The ledger of the product, newest first, in pages (`items`, `page`, `limit`, `total`, `totalPages`); `skuId` limits it to one SKU. Each item has the shape of `movement` above; an entry of an accepted quotation has `reason: "quotation_accepted"`, `quotationId` and `quotationNumber` (`Q-2026-0001`) and the admin who accepted it.

### Stock in the other answers

- Admin SKU: `stock` (cartons; below zero is a shortage). Admin product summary and detail: `stock { quantity, shortSkus }` over all SKUs (the sum, and how many SKUs are below zero).
- `POST …/products` and `POST …/{id}/skus`: a SKU may carry `stock` (its opening count, default 0).
- The CSV column `stock` (section 7).
- The quotation detail shows the current stock of every line and what accepting did (`doc/QUOTATIONS.md` section 5).
- The public API never carries it.

---

## 9. Public API for the wholesale site

Public, no authentication; the site's origin must be in `CORS_ORIGINS` (it is). English by default; `?locale=de` or `Accept-Language` chooses the German texts where they exist. Cacheable for a minute (categories and brands: five). Only **visible** categories and **active** products with at least one **enabled** SKU appear; a product in a hidden category does not.

### `GET /v1/b2b/categories`

The visible categories that have at least one offered product, in the admin's order, with counts.

```json
{
  "items": [
    { "id": "6710…", "slug": "rice", "slugs": { "en": "rice", "de": "reis" }, "name": "Rice", "description": "Basmati, sona masoori and more.", "image": { "id": "…", "alt": null, "isPrimary": false, "url": "…", "sizes": {…} }, "productCount": 12 }
  ]
}
```

### `GET /v1/b2b/brands`

`{ items: ["Daawat", "India Gate"] }`: the brands of the offered products, for a brand filter.

### `GET /v1/b2b/products`

| Query | Meaning |
|---|---|
| `q` | Words of the name, the article number, the brand or the search keywords |
| `category` | Slug of a wholesale category. Unknown or hidden: `404 WHOLESALE_CATEGORY_NOT_FOUND` |
| `brand` | One or more brands (`brand=Daawat&brand=India%20Gate`), exactly as the products name them |
| `sort` | `recommended` (default: the admin's order, category by category, then position), `name`, `newest` |
| `page`, `limit` | Pages; `limit` 1–100, default 24 |
| `locale` | `en` (default) or `de` |

```json
{
  "items": [
    {
      "id": "6711…",
      "slug": "daawat-basmati-rice",
      "slugs": { "en": "daawat-basmati-rice", "de": "daawat-basmati-reis" },
      "name": "Daawat Basmati Rice",
      "subtitle": "Aged two years",
      "shortDescription": "Extra long grain basmati.",
      "brand": "Daawat",
      "category": { "id": "6710…", "slug": "rice", "name": "Rice" },
      "storageType": "ambient",
      "isAvailable": true,
      "image": { "id": "…", "alt": "Daawat Basmati Rice", "isPrimary": true, "url": "https://cdn.…/large.webp", "sizes": { "small": { "url": "…", "width": 400, "height": 400 }, "medium": {…}, "large": {…} } },
      "cartons": [
        {
          "skuId": "6712…",
          "sku": "RFW-00001",
          "packSize": { "value": 1, "unit": "kg", "label": "1 kg" },
          "units": 20,
          "label": "20 × 1 kg",
          "content": { "value": 20, "unit": "kg", "label": "20 kg" }
        },
        { "skuId": "6713…", "sku": "RFW-00002", "packSize": { "value": 5, "unit": "kg", "label": "5 kg" }, "units": 4, "label": "4 × 5 kg", "content": { "value": 20, "unit": "kg", "label": "20 kg" } }
      ],
      "cartonCount": 2
    }
  ],
  "page": 1, "limit": 24, "total": 37, "totalPages": 2
}
```

- `cartons` lists the enabled SKUs, smallest pack first. **`skuId` is what a quotation request names** (`POST /v1/b2b/quotations`, `items[].skuId`).
- `isAvailable: false`: show "currently not available" and do not let it be added; the API refuses such a SKU in a request (`not_offered`).
- No prices anywhere.

### `GET /v1/b2b/products/{slug}`

One product by its slug in either language. The list item plus `description`, `highlights[]`, `images[]` (main picture first), `food { ingredients, allergens, nutrition, storageInstructions, origin, manufacturer }`, `seo { title, description }`, `publishedAt`, `updatedAt`. `404 WHOLESALE_PRODUCT_NOT_FOUND` when the product does not exist, is not active, has no enabled SKU, or its category is hidden.

---

## 10. Validation rules

| Field | Rule |
|---|---|
| `name.en` | 1–160 characters, required; `name.de` optional ≤160 |
| `slug.en`, `slug.de` | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤120; unique per language per collection |
| `subtitle`, `shortDescription` | ≤300 per language |
| `description`, food texts | ≤20000 per language |
| `highlights` | ≤20 entries per language, ≤200 characters each |
| `brand` | ≤80; `null` removes it |
| `categoryId` | An existing wholesale category (`404 WHOLESALE_CATEGORY_NOT_FOUND`) |
| `skus` | 1–20 per product |
| `sku` | `^[A-Z0-9][A-Z0-9._-]{1,39}$`, upper-cased; unique across wholesale products (`409 WHOLESALE_SKU_TAKEN`) |
| `packSize.value` | 0.001–1000000, ≤3 decimals; `unit` one of `g`, `kg`, `ml`, `l`, `pcs` |
| `unitsPerCarton` | integer 1–1000, required on every SKU |
| `stock` (SKU), `quantity`, `delta` | integer −1000000…1000000; `stock` only on create and in the CSV, otherwise through the stock endpoint |
| SKU set | one unit family; no identical pack + carton twice; no article number twice (`400 WHOLESALE_SKU_INVALID`) |
| `vatRate` | integer 0–10000 (hundredths of a percent) |
| `status` | `draft`, `active`, `archived` |
| `sortOrder` | 0–1000000 (products), 0–100000 (categories) |
| `searchKeywords` | ≤30 entries, 2–60 characters each |
| Images | JPEG, PNG, WebP; the limits of the media service; ≤12 per product, one per category |

Unknown fields are rejected (`400 VALIDATION_FAILED`, `details.errors[]`).

---

## 11. Errors and permissions

| Status | Code | When |
|---|---|---|
| 400 | `WHOLESALE_SKU_INVALID` | Mixed units, the same pack and carton twice, the same article number twice in one product, more than 20 SKUs |
| 400 | `STOCK_CHANGE_INVALID` | Both or neither of `quantity` and `delta` in a stock change |
| 400 | `WHOLESALE_CATEGORY_ORDER_INVALID` | An id in the order list is not a wholesale category (`details.unknown`, `details.expected`) |
| 400 | `WHOLESALE_PRODUCT_ORDER_INVALID` | An id in the order list is not a product of this category |
| 400 | `IMAGE_*`, `FILE_TOO_LARGE` | As for retail images |
| 404 | `WHOLESALE_CATEGORY_NOT_FOUND`, `WHOLESALE_PRODUCT_NOT_FOUND`, `WHOLESALE_SKU_NOT_FOUND`, `IMAGE_NOT_FOUND`, `PRODUCT_NOT_FOUND` (copy from retail: the retail product) | |
| 409 | `WHOLESALE_CATEGORY_SLUG_TAKEN`, `WHOLESALE_PRODUCT_SLUG_TAKEN`, `WHOLESALE_SKU_TAKEN` | Another record uses the slug or article number |
| 409 | `WHOLESALE_CATEGORY_HAS_PRODUCTS` | Delete refused while products are in the category |
| 409 | `WHOLESALE_SKU_LAST` | The last SKU of a product cannot be removed |

**Permissions:** `wholesale.read` (lists, details, export, the stock history) and `wholesale.manage` (everything that writes, import, stock changes). Accepting a quotation, which takes stock, needs `quotations.manage` only. The super admin has both through the wildcard; grant them to other roles under Roles. The retail `catalog.*` permissions do not cover the wholesale catalogue, and the other way round.

---

## 12. Integration workflows

**Admin panel**

1. A "Wholesale" sidebar group with **Products**, **Categories** and **Quotations** (the quotation pages of `doc/ADMIN_PANEL_QUOTATIONS_AGENT_PROMPT.md` move under it). **Categories** (list in order with drag-and-drop reorder, visible switch, image, product count; form with name EN/DE, slug, description) and **Products** (list with status, category, availability filters and search; form with the product fields, the SKU table with pack size, packs per carton and the computed carton, the images, and the product's position). A **Copy from retail** action: pick a retail product (`GET /v1/admin/products?q=`), a wholesale category and the cartons, then `POST …/from-retail`.
2. The category page lists its products in order (`GET …/categories/{id}/products`) with drag-and-drop → `PUT …/products/order`.
3. CSV import and export, the same screens as the retail import with the wholesale endpoints and columns; the report has the same shape (`skuId` instead of `variantId`).
4. The permissions `wholesale.read` and `wholesale.manage` in the roles form.
5. **Stock** on the product form: a stock column in the SKU table, a "Set stock" dialog (`PUT …/skus/{skuId}/stock` with `quantity` or `delta` and a note) and the stock history (`GET …/{id}/stock-movements`). Negative counts in red as shortages.
6. The quotation detail shows the current stock of every line (`items[].stock { quantity, short }`), warns when a line is short before accepting, and after acceptance shows `stock.lines` with the count before and after (`doc/QUOTATIONS.md` section 5).

The prompt for the admin panel agent is `doc/ADMIN_PANEL_WHOLESALE_AGENT_PROMPT.md`.

**Wholesale site (radhefoods.de)**

- Category chips from `GET /v1/b2b/categories`; product grid and search from `GET /v1/b2b/products` (default order = the admin's); "View product details" from `GET /v1/b2b/products/{slug}`; optional brand filter from `GET /v1/b2b/brands`.
- The quotation basket keeps `{ skuId, cartons }` per line; the request goes to `POST /v1/b2b/quotations` as described in `doc/QUOTATIONS.md` section 4.
- The prompt for the site agent is `doc/B2B_WEB_AGENT_PROMPT.md`.

**Server**

- No new environment variables. The images use the existing storage and CDN; the wholesale site's origin is already in `CORS_ORIGINS`.
- Run `npm run db:indexes` after deploying: three new collections with their indexes (`wholesaleCategories`, `wholesaleProducts`, `wholesaleStockMovements`).
- Grant `wholesale.read` / `wholesale.manage` to the roles that manage the wholesale range.
- The wholesale site is empty until wholesale products exist: create them, copy them from retail, or import a sheet.
