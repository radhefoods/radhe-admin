# Product order and pack-size views

How the shop decides which product comes first, and whether a list shows one card per product or one card per pack size. Written for the admin panel and the customer website; the two integration prompts are at the end.

Decided with the owner on 2026-10-24: every category defaults to the rounds view (`variants_by_size`) and can override it; the "All products" page groups the sizes of a product; the admin orders every product of a category, drafts included; a partial order is accepted and the rest keeps its place.

## Contents

1. The idea in one page
2. Data model (what changed)
3. The order of the products
4. The three views
5. Admin API
6. Store API
7. Filters, sorting and pages in the pack-size views
8. Which page uses which view
9. Performance and limits
10. Integration prompt for the admin panel agent
11. Integration prompt for the customer web agent

## 1. The idea in one page

- A product belongs to one category and has **one position** there (`sortOrder`, 0 first). The admin sets the positions of a category with one call; a new product goes to the end; a product moved to another category goes to the end there.
- A list that spans several categories (a main category with sub-categories, "All products", a search) shows the products **category by category**, in the order of the navigation, and within a category by position. Nothing is ordered twice and no product is stored twice.
- Every store list has a **view**: `product` (one card per product, today's answer), `variants_by_product` (one card per pack size, the sizes of a product together) or `variants_by_size` (one card per pack size in rounds: the smallest size of every product first).
- The view is a **query parameter**; a category has a **default view** the admin can change. The home page asks for rounds, the search and "All products" ask for grouping by product, category pages ask for nothing and get the category's setting.
- A card in a pack-size view has exactly the shape of today's list entry, with `variantId`, `slug`, `packSize`, `pricing` and `ordering` of its size. **The shop's card component needs no change.**

## 2. Data model (what changed)

| Collection | Field | Change |
| --- | --- | --- |
| `products` | `sortOrder` | Existed. Now means "position among the products of its own category", 0 first. A new product gets the last position (`max + 1`) instead of 0; a product moved to another category gets the last position there; a duplicate goes to the end of its category. The CSV column `sort_order` keeps working. |
| `products` | index `(categoryId, sortOrder, _id)` | New. Serves the admin's order list of a category and the next free position. `npm run db:indexes` builds it; Mongoose builds it on start as well. |
| `categories` | `listingView` | New: `product` \| `variants_by_product` \| `variants_by_size`, default `variants_by_size`. Answered in the admin and the store category objects; set with `PATCH /v1/admin/categories/{id}`; CSV column `listing_view`. |

No new collection. Nothing to migrate: existing products keep their `sortOrder`, existing categories read as `variants_by_size` until the admin changes them.

What the existing numbers mean after the change: today every product has `sortOrder` 0 (or the number typed in the product form). Products with equal positions are ordered newest first. The admin panel's order page shows the current order and saves positions 0 to n-1 on the first save.

## 3. The order of the products

The **recommended** order (the default `sort`) is:

1. the category of the product, in display order of the tree: a main category, then its sub-categories in their admin order (each with its own sub-categories), then the next main category;
2. within a category, `sortOrder` ascending;
3. among equals, the newest product first.

Example with the categories Vegetables (positions: Guvar 0, Bhinda 1, Chilli 2) and Snacks (Ratlami Sev 0, Alupuri Sev 1) with the sub-category Khakhra (Methi Khakhra 0):

| List | Products in order |
| --- | --- |
| `category=vegetables` | Guvar, Bhinda, Chilli |
| `category=snacks` | Ratlami Sev, Alupuri Sev, Methi Khakhra |
| `category=khakhra` | Methi Khakhra |
| no category ("All products") | Guvar, Bhinda, Chilli, Ratlami Sev, Alupuri Sev, Methi Khakhra |
| `q=sev` | Ratlami Sev, Alupuri Sev |

The other sort orders (`newest`, `price_asc`, `price_desc`, `discount`, `name`) ignore the positions, as before.

## 4. The three views

Take Vegetables with Guvar (200 g, 500 g), Bhinda (250 g, 500 g, 1 kg), Chilli (100 g) and Choli (250 g, 500 g) in that order.

**`product`**: one card per product, as the size that stands for it (the smallest enabled size in stock), with the other sizes in `variants` for a chooser.

```text
Guvar (200 g) · Bhinda (250 g) · Chilli (100 g) · Choli (250 g)
```

**`variants_by_product`** (the owner's Option A): one card per pack size, the sizes of a product together, smallest first.

```text
Guvar (200 g) · Guvar (500 g) · Bhinda (250 g) · Bhinda (500 g) · Bhinda (1 kg) · Chilli (100 g) · Choli (250 g) · Choli (500 g)
```

**`variants_by_size`** (Option B, rounds): one card per pack size. Round 1 is the smallest size of every product, round 2 the second size of every product that has one, and so on. Within a round the products keep their order. Products need not share sizes: round 2 holds Guvar's 500 g next to Bhinda's 500 g and Choli's 500 g, round 3 only Bhinda's 1 kg.

```text
round 1: Guvar (200 g) · Bhinda (250 g) · Chilli (100 g) · Choli (250 g)
round 2: Guvar (500 g) · Bhinda (500 g) · Choli (500 g)
round 3: Bhinda (1 kg)
```

Only enabled sizes become cards. A size that cannot be ordered (sold out, switched off) is still a card, with `ordering.canOrder: false`, unless the list asks for `orderable=true`.

## 5. Admin API

Permissions as for the rest of the catalogue: `catalog.read` to read, `catalog.manage` to change. Full field tables are in `doc/ADMIN_API_DOCUMENTATION.md`, section 7.

### `GET /v1/admin/categories/{id}/products`

The products **directly** in the category (a sub-category has its own list), every status, in display order. Each item is the admin product summary of section 8.1 of the admin documentation; `sortOrder` is the position, 0 first.

```json
{
  "items": [
    { "id": "66f3…", "name": { "en": "Guvar", "de": "Guvar" }, "status": "active", "sortOrder": 0, "image": { "…": "" }, "variantCount": 2, "defaultVariant": { "…": "" }, "…": "" },
    { "id": "66f4…", "name": { "en": "Bhinda" }, "status": "active", "sortOrder": 1, "…": "" },
    { "id": "66f5…", "name": { "en": "Coming Soon Veg" }, "status": "draft", "sortOrder": 2, "…": "" }
  ]
}
```

Errors: `404 CATEGORY_NOT_FOUND`.

### `PUT /v1/admin/categories/{id}/products/order`

```json
{ "orderedIds": ["66f4…", "66f3…"] }
```

The products named come first, in this order; every other product of the category follows in the order it had. Every product of the category gets a position 0 to n-1. Answers `200 { "items": [ … ] }`, the complete list in its new order.

| Sent | Before | After |
| --- | --- | --- |
| `[Bhinda, Guvar]` | Guvar 0, Bhinda 1, Chilli 2, Choli 3 | Bhinda 0, Guvar 1, Chilli 2, Choli 3 |
| `[Choli]` | Guvar 0, Bhinda 1, Chilli 2, Choli 3 | Choli 0, Guvar 1, Bhinda 2, Chilli 3 |
| all four ids | any | exactly that order |

Errors: `404 CATEGORY_NOT_FOUND`; `400 CATEGORY_PRODUCT_ORDER_INVALID` with `details.unknown` (ids that are not products of this category) and `details.expected` (the ids that are); `400 VALIDATION_FAILED` (empty list, duplicate, not an id, more than 1000).

### Related, existing endpoints

- `PATCH /v1/admin/categories/{id}` with `{ "listingView": "variants_by_product" }` sets the category's default view. `GET /v1/admin/categories` and `GET /v1/admin/categories/{id}` answer `listingView`.
- `PATCH /v1/admin/products/{id}` with `categoryId` moves a product; it takes the last position of the new category unless `sortOrder` is sent too. `sortOrder` can still be set per product here and in the product form, but the category's order page is the better tool.
- CSV: category column `listing_view`, product column `sort_order` (position within its category; a create without it goes last).

## 6. Store API

Full tables in `doc/CUSTOMER_WEB_API_DOCUMENTATION.md`, section 7.

### `GET /v1/store/products` with `view`

| `view` | One entry is | Order (`sort=recommended`) |
| --- | --- | --- |
| `product` | a product, as its default size | category, position |
| `variants_by_product` | a pack size; the sizes of a product together | category, position, size |
| `variants_by_size` | a pack size; rounds of ascending size | round, category, position |
| left out | the `listingView` of `category`; without `category`: `product` | |

The answer carries the applied view:

```json
{
  "items": [
    { "id": "66f3…", "variantId": "66a1…", "sku": "RF-00010", "slug": "guvar-200g", "name": "Guvar", "displayName": "Guvar (200 g)", "packSize": { "value": 200, "unit": "g", "label": "200 g" }, "pricing": { "price": 249, "…": "" }, "ordering": { "canOrder": false, "reason": "sold_out", "…": "" }, "variants": [ { "id": "66a1…", "isSelected": true, "…": "" }, { "id": "66a2…", "isSelected": false, "…": "" } ], "variantCount": 2, "…": "" },
    { "id": "66f4…", "variantId": "66b1…", "slug": "bhinda-250g", "displayName": "Bhinda (250 g)", "…": "" },
    { "id": "66f5…", "variantId": "66c1…", "slug": "green-chilli-100g", "displayName": "Green Chilli (100 g)", "…": "" },
    { "id": "66f6…", "variantId": "66d1…", "slug": "choli-250g", "displayName": "Choli (250 g)", "…": "" },
    { "id": "66f3…", "variantId": "66a2…", "slug": "guvar-500g", "displayName": "Guvar (500 g)", "…": "" }
  ],
  "page": 1,
  "limit": 5,
  "total": 8,
  "totalPages": 2,
  "view": "variants_by_size"
}
```

Each entry is the same object as before: `id` is the product, `variantId`, `sku`, `slug`, `displayName`, `packSize`, `pricing` and `ordering` are those of the card's size, `variants` lists every enabled size with `isSelected` on the card's one. Two entries can share `id`; `variantId` is unique in a list. The product page URL of a card is its `slug`, the cart takes its `variantId`.

`GET /v1/store/categories` and `GET /v1/store/categories/{slug}` answer `listingView` per category.

## 7. Filters, sorting and pages in the pack-size views

- `total`, `totalPages`, `page` and `limit` count **entries** (pack sizes). `GET /v1/store/products/facets` keeps counting **products** and accepts `view` without using it; use its `total` for "13 products".
- Filters that concern a size hold **per card**: `packSize` (only the asked sizes become cards), `onSale` (only reduced sizes), `orderable=true` (only sizes that can be ordered now), `minPrice` and `maxPrice` (the price of the card, not of the default size). A product is listed when at least one of its sizes passes. The rounds of `variants_by_size` are formed from the sizes that pass: with `orderable=true`, a product whose 200 g is sold out opens the first round with its 500 g.
- Filters that concern the product (`category`, `q`, `tag`, `brand`, `storageType`, `available`, `featured`) hold for every card of the product.
- `sort=price_asc`, `price_desc` and `discount` order the cards **one by one** by their own price or discount; the sizes of a product are then no longer together and there are no rounds. `name` and `newest` keep the grouping or the rounds. `recommended` is the admin's order.
- The pack-size facet counts enabled sizes; the brand, label, storage, price and offer facets count products, as before.

## 8. Which page uses which view

| Page | Request | Why |
| --- | --- | --- |
| Home page rows | `category=<slug>&view=variants_by_size&limit=…` | Rounds: the first cards are the smallest sizes of the most products, as the owner asked. The row's arrows and "See all" stay as they are. |
| Category page | `category=<slug>` (no `view`) | The category's `listingView`, which the admin sets; the default is rounds. |
| "All products" | `view=variants_by_product` | Every size of a product together before the next product (owner's decision). |
| Search results | `q=…&view=variants_by_product` | Every size of a matching product together: "Ratlami Sev 200 g, 400 g, 1 kg, then Alupuri Sev …". |
| Related products on a product page | `category=<slug>` (no `view`) or `view=product` | The category's setting gives cards per size; `view=product` keeps one card per product with a chooser. The web agent chooses. |
| Wishlist, cart | not this endpoint | unchanged |

The known difference: the home row of a category set to `variants_by_product` arranges the cards differently from the category page behind "See all". That is intended; the home page is a teaser and shows more distinct products in the same space. The two requests are cached separately by the shop.

## 9. Performance and limits

- The lists run as one aggregation (`src/modules/catalog/products/product-listing.ts`): the filter is served by the existing indexes; the rank of the category is looked up in the pipeline (`$indexOfArray` over the categories in display order), the pack sizes are filtered and sorted per product (`$sortArray`, MongoDB 5.2 or newer; Atlas runs 8.0) and unwound, then the rows are sorted and paged. The recommended order and the rounds are sorted in memory. For a catalogue of thousands of products and tens of thousands of sizes this takes milliseconds; MongoDB spills to disk above 100 MB, which such a catalogue never reaches.
- The price orders of the `product` view still come from the index; the test "serve the lists of the shop without reading every product" checks the plans of the real pipeline.
- Page size stays 1–100 entries. A category page of 60 products with three sizes each has 180 cards: eight pages of 24, or three of 60.
- The shop caches catalogue answers for five minutes (`REVALIDATE.catalogue`); the admin's new order shows up within that time.

## 10. Integration prompt for the admin panel agent

> **Radhe Foods admin panel: product order and listing view per category.** The API (`doc/ADMIN_API_DOCUMENTATION.md` section 7, `doc/PRODUCT_DISPLAY_ORDER.md`) now has:
>
> 1. `GET /v1/admin/categories/{id}/products` → `{ items }`: the products directly in the category (every status) in display order; `sortOrder` is the position, 0 first.
> 2. `PUT /v1/admin/categories/{id}/products/order` with `{ orderedIds: string[] }` → `{ items }` in the new order. Partial lists are allowed: the named products come first, the rest keeps its order. Errors `404 CATEGORY_NOT_FOUND`, `400 CATEGORY_PRODUCT_ORDER_INVALID` (`details.unknown`, `details.expected`).
> 3. `listingView` on every category object (`product` | `variants_by_product` | `variants_by_size`, default `variants_by_size`), settable with `PATCH /v1/admin/categories/{id}` and in the CSV column `listing_view`.
>
> Build, without changing the panel's theme, colours, fonts or unrelated pages:
>
> - On the Categories page, an action per category "Product order" (menu or row link) that opens a page or drawer listing the category's products from endpoint 1 (image, name, status badge, pack sizes, position number 1-based). Allow drag and drop with the handle pattern already used for categories (handle, Space and arrow keys) **and** an editable position field per row; typing a number moves the row there. Save sends the complete list to endpoint 2 and renders the answer. Show a note that sub-categories have an order of their own, with links to them. Disabled while the category has no products.
> - On the category form, a select "How the shop lists the pack sizes" with the three values and one-line help texts: "one card per product with a size chooser", "one card per pack size, the sizes of a product together", "one card per pack size, the smallest size of every product first (rounds)". Save via the existing PATCH.
> - In the product form, keep the existing `sortOrder` field but label it "Position in its category" with the hint that the category's order page is the easier tool; new products default to the last position when the field is left empty.
> - Add the CSV column `listing_view` to the import/export help where columns are listed.
> - Tests as the panel's other flows have them (list, reorder, partial reorder, error with `details.unknown`, the select).

## 11. Integration prompt for the customer web agent

> **Radhe Foods shop: admin product order and pack-size cards.** `GET /v1/store/products` (`doc/CUSTOMER_WEB_API_DOCUMENTATION.md` section 7, `doc/PRODUCT_DISPLAY_ORDER.md`) now takes `view=product|variants_by_product|variants_by_size` and answers `view`. In the two `variants_*` views every entry is one pack size as its own card, with the same shape as today (`variantId`, `slug`, `packSize`, `pricing`, `ordering`, `variants` with `isSelected`), and `total` counts cards. The recommended order is now the admin's order (category by category, then positions). Categories answer `listingView`.
>
> Change, without touching the theme, colours, fonts, typography, the card design or unrelated pages:
>
> - Home page rows: request each category row with `view=variants_by_size` (keep `ROW_SIZE`, the arrows and "See all" as they are). The "Popular right now" row keeps its current request.
> - Category pages: send no `view`; the API applies the category's setting. Key cards by `variantId` (two cards can share the product `id`). Show "N products" from the facets' `total`, not from the list's `total`, or change the label to count items. Pagination works unchanged on the list's `total`/`totalPages`.
> - "All products" page and search results (`q=`): send `view=variants_by_product`.
> - Related products on the product page: keep the request as it is, or add `view=product` to keep one card per product with the size chooser; either is fine.
> - Each card already takes its title from `displayName`, its link from `slug` and its cart button from `variantId` and `ordering`; verify that a size card's wishlist heart uses the card's `variantId` as the remembered pack size.
> - Price and discount sorts in the `variants_*` views order the cards individually (the sizes of a product are no longer adjacent); `name` and `newest` keep the grouping; nothing to do but not to be surprised.
> - Update the shop's `ProductQuery` type (`view`), the `Page` type (`view`), the `Category` type (`listingView`) and the tests of the listing state and the home queries.
