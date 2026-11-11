# Supplier file: import, stock and prices

The buying centre's daily CSV is the source of the retail catalogue. This document is for the owner and for whoever builds the screens in the admin panel. Everything here is admin-only; no customer endpoint answers a buying price, a markup or a supplier's line.

- [What an upload does](#what-an-upload-does)
- [Stock](#stock)
- [Prices](#prices)
- [Lines that wait for a person](#lines-that-wait-for-a-person)
- [API](#api)
- [Before a product is shown](#before-a-product-is-shown)
- [Changes to existing endpoints](#changes-to-existing-endpoints)
- [Screens for the admin panel](#screens-for-the-admin-panel)
- [Limits](#limits)
- [Starting from zero](#starting-from-zero)

## What an upload does

The file has five columns: `Cost`, `Name`, `Quantity On Hand`, `Sales Taxes`, `Unit of Measure`. It has no article number, barcode or category, so a line is recognised by its **name**. Upper and lower case, spaces and punctuation do not matter; any other change of the name makes it a different line.

| The line …                                                            | … does this                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| has the name of a pack size the shop has                              | sets its stock and buying price; sets its price too if the price is calculated                  |
| is new and complete (brand and pack size readable, buying price, VAT) | becomes a pack size of a **draft** product; lines with the same brand and title are one product |
| is new and incomplete                                                 | is kept in the review list with the reason                                                      |
| is new but resembles a line that just disappeared from the file       | is kept in the review list as a possible rename, so that no second product appears              |
| was in earlier files and is not in this one                           | its pack size goes to stock 0; nothing is deleted                                               |
| cannot be read (no name, quantity not a number)                       | is reported as an error and skipped                                                             |

An upload never publishes anything: new products are drafts in the hidden category **Unsorted** (`unsorted`), created on the first upload. It never changes what the admin wrote on a product: name, texts, images, category, URLs, VAT rate, status.

How a name is read, with `AB: 100g Black Pepper Powder` as the example:

- **Brand**: the text before the colon (`AB`). The settings map abbreviations and other spellings to brand names (`AB` → `AliBaba`, `Britania` → `Britannia`), used for products created from then on. Lines whose prefixes stand for the same brand are one product.
- **Pack size**: the size right after the colon (`100g`). Known units: g, kg, ml, l, pieces (`pcs`, `stk`, `st`).
- **Title**: the rest (`Black Pepper Powder`).
- **Product name**: brand and title, `AliBaba Black Pepper Powder`. The URL is made from it and is unique.

A row with the unit `kg`, or `p.KG` in its name, is sold by weight: it becomes a 1 kg pack, and its stock is whole kilograms.

## Stock

On every upload, for every line that belongs to a pack size:

1. a negative quantity counts as 0;
2. a fraction is rounded down;
3. the safety buffer is subtracted (5 by default, set in the settings);
4. the result is never below 0.

`13` gives 8, `39.74` gives 34, `-20` gives 0.

Between two uploads the shop counts down by itself as orders are paid, and never below zero. The next upload sets the stock again from the supplier's quantity; it does not look at open orders. Every change is in the stock history of the pack size with the reason `import`.

A new safety buffer applies from the next upload.

## Prices

```
buying price
+ fulfilmentPercent of the buying price
+ extraPercent of the buying price + extraAmount   (other expenses, 0 by default)
+ markupPercent of all of the above
+ VAT of the product
= price, rounded to the cent at the end only
```

With 10 % fulfilment and 35 % markup at 7 % VAT: 1.38 → 1.518 → 2.0493 → 2.192751 → **2.19**.

The buying price is the `Cost` cell exactly as the file states it, with all its decimals. Nothing is added to it.

**Three levels set the rule**, value by value:

1. the shop, in the settings;
2. a category, for its products and the categories below it (`pricing` on the category);
3. a product (`pricing` on the product).

The nearest level that sets a value wins for that value. A product can set its own markup and still follow the shop's fulfilment charge.

**Each pack size has a price mode:**

- `auto`: the regular price is calculated, and calculated again whenever the buying price, the rule, the category or the VAT rate of the product changes. Pack sizes created by an upload start in `auto`.
- `manual`: the price is the admin's. Nothing changes it. A pack size becomes `manual` when the admin types a regular price; sending `priceMode: "auto"` hands it back to the calculation.

A sale price stays while it is below the regular price; if a new regular price falls to or below it, the sale ends. Every price change is in the price history.

A markup is not a margin: 35 % on the costs leaves 25.9 % of the net price. The pricing endpoint returns both.

## Lines that wait for a person

`problems` on a line says why it did not become a product:

| Problem                 | Meaning                                                                                | What the admin does                                           |
| ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `no_size`               | no pack size in the name (`Bakul: Topi`)                                               | types the pack size                                           |
| `size_guessed`          | a size was found, but not right after the brand (`Barley (JAV) - 200g`)                | confirms or corrects the pack size                            |
| `multipack`             | several packs in one (`5x100g`, `6er Pack`)                                            | types the pack size                                           |
| `size_unit_unsupported` | a unit the shop does not have (`15oz`)                                                 | types the pack size in g, kg, ml, l or pieces                 |
| `weight_mismatch`       | the row is counted in kg, the name states another weight                               | types the pack size the price is for                          |
| `uom_unknown`           | a unit of measure the import does not know                                             | types the pack size                                           |
| `no_cost`               | the file states no buying price (0 or empty)                                           | types a buying price, or waits for the file to have one       |
| `no_vat`                | the file states no VAT rate                                                            | types the VAT rate                                            |
| `duplicate_name`        | the same name is in the file twice                                                     | nothing can be done here; the supplier's file is ambiguous    |
| `possible_rename`       | a similar line disappeared from the file as this one appeared                          | decides: the same pack size, or a new product                 |
| `product_removed`       | the admin deleted the product this line belonged to                                    | decides: create it again, or leave it                         |
| `conflict`              | the product of this brand and title has this pack size already                         | says which pack size the line is                              |
| `duplicate_listing`     | the supplier lists a pack size twice, and the shop follows the other line (`renameOf`) | nothing, or follows this line instead (`resolve` with `same`) |

`hints` mark goods that may need special handling. They are read from words in the name and can be wrong or missing: `alcohol`, `tobacco`, `deposit` (Pfand), `frozen`, `per_kilogram`. A hint holds nothing up; such products are drafts like all others and are for the admin to check before publishing.

## API

All paths are under `/v1/admin/supply`. Reading needs `catalog.read`, writing `catalog.manage`. Money is in cents; buying prices and the steps of a calculation may have decimals.

### `POST /import/preview`

What an upload would do. Nothing is written.

```json
{
  "rows": [
    {
      "Cost": "1.38",
      "Name": "AB: 100g Black Pepper Powder",
      "Quantity On Hand": "13.0",
      "Sales Taxes": "7% Umsatzsteuer",
      "Unit of Measure": "Units"
    }
  ],
  "fileName": "Product (product.template).csv"
}
```

The panel reads the CSV and sends every row as an object with the column names of the file as keys and the cells as text. At most 20,000 rows.

```json
{
  "summary": {
    "rows": 5461,
    "create": 4792,
    "newProducts": 4190,
    "update": 0,
    "unchanged": 0,
    "review": 668,
    "missing": 0,
    "error": 0,
    "stockChanges": 0,
    "costChanges": 0,
    "priceChanges": 0,
    "manyMissing": false
  },
  "rows": [
    {
      "row": 1,
      "name": "AB: 100g Black Pepper Powder",
      "action": "create",
      "itemId": null,
      "productId": null,
      "variantId": null,
      "sku": null,
      "changes": { "stock": [0, 8], "price": [0, 219] },
      "problems": [],
      "notes": [],
      "hints": [],
      "renameOf": null
    }
  ],
  "applied": false,
  "importId": null
}
```

- `action`: `create`, `update`, `review`, `missing`, `error`. Unchanged lines are only counted.
- `changes`: `[before, after]` for `stock`, `cost` and `price`.
- `notes`: `vat_differs` (the VAT of the file is not the VAT of the product; the product is not changed), `no_cost` (the file states no buying price; the last one stays).
- `row` is null for a `missing` line: it is not in the file.
- `summary.create` counts pack sizes, `summary.newProducts` the products they form.

### `POST /import`

The same body; writes. Answers the same report with `applied: true` and the `importId`.

`409 SUPPLY_FILE_INCOMPLETE` (`details: { known, missing }`) when more than half of the supplier's products of the shop are not in the file: that is more likely the wrong file than the truth. Show the numbers and send the body again with `"allowMissing": true` if the admin confirms.

### `GET /imports`

The last 60 uploads: `{ items: [{ id, fileName, rows, summary, durationMs, admin, createdAt }] }`.

### `GET /items/counts`

```json
{
  "review": 668,
  "linked": 4792,
  "missing": 0,
  "problems": { "no_size": 499, "no_cost": 55, "size_guessed": 46 },
  "hints": { "deposit": 69, "frozen": 57, "alcohol": 34, "tobacco": 22 }
}
```

### `GET /items`

Query: `state` (`review`, `linked`, `missing`), `problem` (a problem or a hint), `q` (part of the supplier's name), `limit` (1 to 100, default 25), `cursor`. Newest first. Answers `{ items, nextCursor }`.

```json
{
  "id": "…",
  "name": "Bakul: Topi",
  "brand": "Bakul",
  "title": "Topi",
  "packSize": null,
  "unitOfMeasure": "Units",
  "perKilogram": false,
  "cost": 99,
  "quantity": 10,
  "vatRate": 700,
  "state": "review",
  "problems": ["no_size"],
  "hints": [],
  "overrides": null,
  "ready": false,
  "renameOf": null,
  "productId": null,
  "variantId": null,
  "sku": null,
  "firstSeenAt": "…",
  "lastSeenAt": "…",
  "missingSince": null
}
```

`brand`, `title`, `packSize`, `cost` and `vatRate` are what the line says with the admin's additions laid over it. `ready` is true when "new product" would work now. For a possible rename, `renameOf` is `{ id, name, productId, variantId, sku }` of the line it resembles.

### `PATCH /items/{id}`

Fills in what the line does not say. Every field is optional; null removes a value.

```json
{
  "packSize": { "value": 1, "unit": "pcs" },
  "brand": "Bakul",
  "title": "Topi (cap)",
  "cost": 99,
  "vatRate": 700
}
```

`cost` and `vatRate` are used only while the file states none. A pack size typed here answers every doubt about the size. Answers the line.

### `POST /items/{id}/resolve`

- `{ "as": "new" }`: the line becomes a draft product, or a further pack size of the product with the same brand and title. `409 SUPPLIER_ITEM_INCOMPLETE` with `details.problems` while something is missing.
- `{ "as": "same" }`: the line is a pack size the shop has already, renamed by the supplier. Without `variantId`, the pack size of `renameOf`; with it, any pack size. Stock and buying price of the line are written at once. The product keeps its name, URL and everything else. The name the pack size had before is forgotten if the supplier's file no longer has it; if the file still has it, that line waits as `duplicate_listing` from then on.

`409 SUPPLIER_ITEM_LINKED` for a line that belongs to a pack size already. Answers the line.

### `GET /settings`, `PUT /settings`

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

`brands` maps the prefixes of the supplier's names to brand names; upper and lower case and punctuation of a prefix do not matter. An **empty name** says the prefix is not a brand: `NW Pooja: 100g Kumkum` becomes the product "Kumkum" without a brand. The shop starts with a list of the prefixes that are known for certain (`src/modules/settings/supplier-brands.ts`); a prefix that is not in the list is used as written. `publishCheck` switches the check before activation on and off (see below); left out, it stays as it is.

`PUT` takes this body (`brands` may be left out to keep the list) and answers `{ settings, repriced }`: every calculated price is calculated again at once, and `repriced` is how many changed. Percentages take two decimals; `extraAmount` is whole cents per pack.

### `GET /products/{id}/pricing`

How the price of each pack size of a product comes about. This is the breakdown for the product page.

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

- `sources` says where each value of the rule is set: `shop`, `category` or `product`.
- `calculated` is what the rule gives, whatever the price mode; null without a buying price.
- `price` is what customers pay now, and `profit` what that earns: `profit.markupPercent` in percent of the costs, `profit.marginPercent` in percent of the net price. For a `manual` price this is where a price below cost shows (`profit.profit` negative).

### `POST /products/{id}/merge`

The same article twice: see the next section.

```json
{ "fromProductId": "6650f1c2a4b3c2d1e0f9a8b7" }
```

```json
{
  "productId": "6650f1c2a4b3c2d1e0f9a8b1",
  "removedProductId": "6650f1c2a4b3c2d1e0f9a8b7",
  "moved": [
    {
      "variantId": "6650f1c2a4b3c2d1e0f9a8c3",
      "sku": "RF-00412",
      "packSize": { "value": 1.2, "unit": "kg" }
    }
  ],
  "duplicates": [
    {
      "packSize": { "value": 400, "unit": "g" },
      "variantId": "6650f1c2a4b3c2d1e0f9a8c1",
      "sku": "RF-00411",
      "removedSku": "RF-00413"
    }
  ],
  "waiting": [
    {
      "itemId": "6650f1c2a4b3c2d1e0f9a8d9",
      "name": "Ashoka: 400g Paratha Aloo",
      "sku": "RF-00411"
    }
  ]
}
```

`409 PRODUCT_IS_ACTIVE` when the other product is shown in the shop, `409 PRODUCT_IN_USE` when an order holds it, `400 PRODUCT_VARIANT_INVALID` when one is sold by weight and the other by volume or pieces, or when the pack sizes together are more than a product can have, `404 PRODUCT_NOT_FOUND`.

## The same article twice

The supplier sometimes writes one article in two ways. Two spellings of a brand (`Britania:` and `Britannia:`) are recognised when the brand list knows both, and become one product. Words in another order (`KRG: 200g Green Cardamoms` and `KRG: 50g Cardamoms Green`) or an addition to the name (`Family Pack`) are not, and become two products.

`POST /products/{id}/merge` makes them one. The product of the URL stays; `fromProductId` is merged into it:

- **Its pack sizes move**, each with its article number, stock, buying price, price mode, pictures, stock and price history and its line of the supplier's file. Their URLs follow the product they belong to now.
- **Their prices are calculated again** by the rule and the VAT rate of the product that stays.
- **The other product is removed**, with its texts. The product that stays keeps its own, so merge into the one that is filled in.
- **A pack size both have** stays as the product of the URL has it; the other one is gone with its stock. It keeps its own pictures, or takes those of the other one if it had none. Its line of the supplier's file is not deleted: it waits in the review list as `duplicate_listing`, with `renameOf` naming the line the shop follows. That is what keeps the next upload from creating the product again, so leave it there. `resolve` with `same` on it makes the shop follow that line instead, and the other one waits.
- **From then on** the upload knows both ways of writing: a new pack size under either goes to the merged product.

A merge cannot be undone. The product that goes must be one that could be deleted: not shown in the shop (archive it first) and in no order.

## Before a product is shown

A draft is activated (`PATCH /v1/admin/products/{id}` with `status: "active"`) only when it is complete. Otherwise the answer is `409 PRODUCT_NOT_READY` with `details: { missing, warnings }`, and the product stays a draft. The check looks at the product as it will be after the request, so one request can fill in the last fields and activate.

| `missing`                                 | The product needs                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `category`                                | a category other than "Unsorted"                                                                                |
| `name_de`                                 | food: the German name                                                                                           |
| `ingredients_de`                          | food: the ingredients in German (`food.ingredients.de`)                                                         |
| `allergens_de`                            | food: the allergens in German (`food.allergens.de`), "Keine" where there are none                               |
| `responsible_business`                    | food: name and address of the business responsible in the EU, from the label (`food.manufacturer`)              |
| `alcohol`, `tobacco`                      | a decision: the supplier's line looks like alcohol or tobacco, which need age checks the shop does not have yet |
| `deposit`                                 | a decision: the supplier's line names a deposit (Pfand), which the checkout cannot charge yet                   |
| `fireworks`, `hair_dye`, `health_product` | a decision: goods with rules of their own                                                                       |

Food is every product that is not in a category marked `nonFood` (the flag of a category counts for the categories below it). The ingredients, allergens and the responsible business cannot be researched; they are read from the label of the pack.

`warnings` hold nothing up: `nutrition_de`, `origin`, `storage_instructions_de` (chilled and frozen goods), `description`, `image` (a pack size that is switched on has no picture), and for goods that are not food `responsible_business`.

Pictures are optional. They belong to the pack sizes, and a pack size without any is shown in the shop with the placeholder; see `VARIANT_IMAGES.md`.

A check that does not apply to a product is **waived** on that product: `PATCH /v1/admin/products/{id}` with `publishWaivers: ["ingredients_de"]` (the whole list is replaced). This is how loose vegetables without a list of ingredients, or a "wine vinegar" that is not alcohol, are activated. Waiving `alcohol`, `tobacco` and the other decisions is the admin saying: this is cleared.

`GET /v1/admin/products/{id}/readiness` answers `{ readiness: { ready, missing, waived, warnings }, enforced }` for the product page. `enforced` is false when `publishCheck` is off in the supply settings.

The check applies when a draft or an archived product is activated. A product created by hand with `status: "active"` in one step is not checked.

## Changes to existing endpoints

- **Pack sizes** (`POST`/`PATCH /v1/admin/products/{id}/variants…`) accept `cost` (cents, decimals allowed, null removes it) and `priceMode` (`auto` or `manual`). Sending `regularPrice` without `priceMode` makes the pack size `manual`. The admin answers of a pack size include `cost` and `priceMode`.
- **Products** (`POST`/`PATCH /v1/admin/products…`) accept `pricing`: `{ fulfilmentPercent?, extraPercent?, extraAmount?, markupPercent? }`, null to remove. The detail answer includes `pricing`.
- **Categories** (`POST`/`PATCH /v1/admin/categories…`) accept the same `pricing`; the answer includes it. They also accept and answer `nonFood` (default false), and the category spreadsheet has the column `non_food`.
- **Products** accept and answer `publishWaivers`, and `PATCH` with `status: "active"` can answer `409 PRODUCT_NOT_READY`.
- Changing `pricing`, the category or the VAT rate of a product, or the `pricing` or the parent of a category, calculates the `auto` prices under it again in the same request.
- **Orders** remember what one pack cost when the order was placed and the price rule of its product (`unitCost` and `costing` on the order item, internal). The cost and profit breakdown of an order is in `ORDER_PROFIT.md`.

## Screens for the admin panel

1. **Upload**: choose the CSV, parse it in the browser, call the preview. Show the summary as tiles and the rows in tabs by `action`. For `update` rows show `changes` as before → after. A button "Import" sends the same rows to `POST /import`. On `SUPPLY_FILE_INCOMPLETE`, a confirmation with the two numbers. Below, the history from `GET /imports`.
2. **Review list**: tabs from `GET /items/counts` (by problem, plus "missing" and one per hint), rows from `GET /items`. A row opens a small form: pack size (value and unit), brand, title, buying price, VAT, saved with `PATCH`. When `ready`, the button "Create as draft" (`resolve` with `new`). For `possible_rename`, two buttons: "Same product as `renameOf.name`" (`same`) and "New product" (`new`). For `duplicate_listing`, show "Second listing of `renameOf.name`; the shop follows that line" and one button "Follow this line instead" (`same`); these rows need nothing done and belong in a tab of their own.
3. **Pricing settings**: safety buffer, the four values of the rule, the brand list (a row with an empty brand name means "not a brand"), and the switch for the check before activation. Saving shows "`repriced` prices changed". Say next to the buffer that it applies from the next upload.
4. **On the product page**: a block from `GET /products/{id}/pricing`. Per pack size: buying price, fulfilment, other expenses, markup, net, VAT, calculated price; the price customers pay; profit with markup and margin; a switch auto/manual; the supplier's line with its quantity and hints. A small form for the product's own `pricing`, with the source of each value shown (`shop` / `category` / `product`).
5. **On the category page**: the same small form for the category's `pricing`, and a switch "goods that are not food".
6. **Merge on the product page**: an action "Merge another product into this one". The admin searches the other product; a confirmation shows both side by side with their pack sizes and says what happens: the pack sizes of the other move here with their pictures, a pack size both have stays as this product has it, the other product is removed with its texts, and it cannot be undone. Then `POST /products/{id}/merge`, and the page is loaded again. Show `duplicates` and `waiting` of the answer in the success message.
7. **Readiness on the product page**: a checklist from `GET /v1/admin/products/{id}/readiness`. Each entry of `missing` links to the field that fills it; entries can be waived with a confirmation ("does not apply to this product"); `waived` entries are shown as such and can be taken back. The "Activate" button shows the list instead of failing silently when the answer is `PRODUCT_NOT_READY`.

Buying prices, markups and supplier lines must not be shown to roles without `catalog.read`.

## Limits

- **The name is the key.** A renamed product is offered for confirmation when it resembles a line that disappeared in the same file; otherwise it becomes a new draft and the old pack size goes to stock 0. The admin then deletes the draft and uses "same product" on the review list, or keeps both.
- **Categories.** The file has none. New drafts go to "Unsorted"; the admin sorts them in the panel or with the catalogue import (see `PRODUCT_ENRICHMENT_PROMPT.md`).
- **Goods sold by weight** are 1 kg packs with whole kilograms in stock. Packs of 250 g or 500 g cut from them cannot be kept in step by the file: they are separate rows without price and quantity.
- **Prices move with the supplier's average.** A buying price that changes by a fraction of a cent can move a calculated price by a cent from one day to the next.
- **A product has one VAT rate.** If the pack sizes of one product come with different rates in the file, the first decides and the others get the note `vat_differs`.
- **Profit per order** (delivery, packaging and payment fees against the buying prices) is in `ORDER_PROFIT.md`.

## Starting from zero

`npm run db:clear-retail` lists what would be deleted and deletes nothing. `npm run db:clear-retail -- --confirm=<database name>` deletes the retail test data: products, categories, their images and histories, supplier lines, carts, wishlists, customers, orders, invoices, payments, refunds, returns, problem reports, reviews, discount codes, referrals, coins and notifications. Article, order and invoice numbers start again. The wholesale catalogue, quotations, admin accounts, roles, settings, legal documents, banners, blog and FAQ are not touched. It makes no backup.

After the cleanup, run `npm run db:indexes` once, then upload the supplier's file.

## Uploading from the terminal

The upload also works without the panel:

- `npm run supply:import -- "path/to/file.csv"` shows what the upload would do and writes nothing.
- `npm run supply:import -- "path/to/file.csv" --apply` does it.

`--admin=<email>` names the admin the upload is recorded for, which is needed only when there is more than one admin account. `--allow-missing` confirms a file that lacks more than half of the supplier's products of the shop. The rules are those of the upload in the panel.

Products that are the same article can be merged from a list:

- `npm run supply:merge -- "path/to/pairs.csv"` shows what each merge would do and writes nothing.
- `npm run supply:merge -- "path/to/pairs.csv" --apply` does it.

The CSV has the columns `keep` and `remove`: the URL names (`slug_en`) of the product that stays and of the one merged into it. Other columns are ignored. A pair that cannot be merged is reported and left as it is.
