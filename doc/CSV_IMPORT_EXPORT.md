# CSV import and Excel export of the catalogue

How categories and products get into Radhe Foods from a spreadsheet, and out again. Written for the admin panel (which owns the files and the screens) and for whoever prepares the spreadsheets.

## 1. Who does what

| Step | Where |
| --- | --- |
| Read the CSV file, show the rows, fix obvious typing | Admin panel |
| Check every row, match it against the catalogue, say what would happen | API: `POST /v1/admin/catalog/import/preview` |
| Show the preview; the admin confirms, and chooses what happens to existing records | Admin panel |
| Write the rows, in the right order, with the rules of the catalogue | API: `POST /v1/admin/catalog/import` |
| Give every category or product back as flat rows | API: `GET /v1/admin/catalog/export?type=…` |
| Turn the rows into an `.xlsx` or `.csv` file | Admin panel |

The panel never writes a category or product itself during an import, and the API never sees a file: the panel sends the rows of the CSV as JSON, one object per row, the column names as keys, the cells as text. Numbers and booleans are accepted too, so rows from an Excel sheet can be sent as read.

Files: `doc/examples/categories-example.csv` and `doc/examples/products-example.csv` hold every column with realistic rows. UTF-8, comma separated, a header line, quotes around cells that contain commas or line breaks (what every spreadsheet writes).

A product row is one pack size. A product with several sizes takes several rows, one per size, tied together by the same `slug_en` (Basmati Rice in 1 kg and 5 kg are two rows with `slug_en` `basmati-rice` in the example sheet); a product with one size is one row, as before. The columns that belong to the pack size are `sku`, `gtin`, `pack_value`, `pack_unit`, `units_per_carton`, `variant_enabled`, `regular_price`, `sale_price`, `discount_percent`, `stock_quantity` and `low_stock_threshold`; every other column belongs to the product and is read from the first row of the product in the file. The later rows of a product need only their pack-size columns and the `slug_en` (or `name_en`) that ties them to it.

## 2. The rules

- **No duplicates.** A category row is matched by `slug_en`; without a slug, by the slug the name would get (`Rice & Grains` → `rice-and-grains`). A product row is matched by `sku` to a pack size, and through it to the product. A row without a SKU is matched to a product by `slug_en`, and without that by the slug its name would get (`Basmati Rice` → `basmati-rice`); on a product that exists, such a row names its pack size by `pack_value` and `pack_unit`, or the only pack size the product has. Rows with the same `slug_en` (or, without a slug, the same `name_en`) belong to one product. A row that matches is never created again; a SKU that belongs to another product than the row's `slug_en` is a problem of the row.
- **Nothing is overwritten without asking.** `existing` in the request says what happens to a row that matches: `skip` (the default) leaves the record as it is; `update` changes the fields the row provides. The panel shows the preview and asks before it sends `update`. A row whose pack size does not exist yet on a product that does is a `create` in both modes: `skip` skips existing pack sizes and still adds new ones.
- **An empty cell means "leave it as it is"** on an update, and "the default" on a create. To remove a value, write what the column says: `sale_price` `0` or `discount_percent` `0` ends a sale, `max_order_quantity` `0` removes the limit, `low_stock_threshold` `0` removes the threshold, `parent_slug` `none` makes a main category.
- **Images are never touched**, nor the SKU of an existing pack size (the SKU is the key), nor the links to orders, nor the price history (a changed price is recorded there like a change made in the form).
- **Order of the rows does not matter.** Parents are created before their children, and the first row of a product before the rows that add its other pack sizes, wherever they stand in the file. The first row of a product in the file is the one its product columns are read from. A row may refer to a category or a product that another row of the same import creates.
- **At most 2,000 rows** per type and request.
- **The import stops at the first row that fails** while writing (for example a slug taken by a product that was created a second ago). The rows before it stay written and are reported as such; the rows after it are reported as `skip` with "Not written". Importing the same file again is safe: what exists is matched and skipped or updated.
- A row with a problem in the preview is never written; the others are.

## 3. Columns

Both sheets: `*_en` is required where the field is required, `*_de` is optional. Lists use `|` between entries. Yes/no cells accept `yes`, `no`, `true`, `false`, `ja`, `nein`, `1`, `0`.

### 3.1 Categories (`categories-example.csv`)

| Column | Required | Meaning |
| --- | --- | --- |
| `slug_en` | for updates | The key. Generated from `name_en` on a create when empty. Lower-case letters, digits, single hyphens. |
| `slug_de` | no | German URL. Generated when empty. |
| `name_en` | for creates | |
| `name_de` | no | |
| `parent_slug` | no | `slug_en` of the parent: an existing category or a row of the file. Empty: a main category on a create, unchanged on an update. `none`: make it a main category. At most three levels. |
| `tagline_en`, `tagline_de` | no | One line under the name. |
| `description_en`, `description_de` | no | |
| `sort_order` | no | 0–100000; the position among its siblings. Default: last. |
| `is_visible` | no | Default yes. A hidden category hides everything below it in the shop. |
| `listing_view` | no | `product`, `variants_by_product` or `variants_by_size` (default): how the shop lists the pack sizes of the category's products. See `doc/PRODUCT_DISPLAY_ORDER.md`. |
| `seo_title_en`, `seo_title_de`, `seo_description_en`, `seo_description_de` | no | |

The category image is not part of the sheet: upload it in the panel.

### 3.2 Products (`products-example.csv`)

One row per pack size. "Pack size" in the table marks the columns that are read from every row; every other column belongs to the product and is read from its first row in the file (on the later rows of the same product those cells are ignored, so the export may repeat them). A sheet of single-size products needs nothing of this: every row is a product with one size.

| Column | Required | Meaning |
| --- | --- | --- |
| `sku` | for updates, and for every further pack size of a new product | Pack size. The key, 2–40 characters (letters, digits, `.`, `_`, `-`), stored upper-case. Generated (`RF-00001`, …) when empty on the first row of a new product; a further row of a new product needs one, since nothing else tells the rows apart. |
| `gtin` | no | Pack size. Barcode, 8, 12, 13 or 14 digits. |
| `units_per_carton` | no | Pack size. Packs in a carton (1–1000) for wholesale quotations (`doc/QUOTATIONS.md`); only pack sizes with it are offered on the wholesale site. Empty leaves it as it is, `0` removes it. |
| `name_en` | for creates | |
| `name_de` | no | |
| `slug_en`, `slug_de` | no | The base of the URLs of the product, `basmati-rice`; every pack size adds its pack to it (`basmati-rice-1kg`, `basmati-rice-5kg`, German `basmati-reis-1kg`). Generated from the name when empty. `slug_en` ties the rows of one product together; without it, `name_en` does. On an update a new `slug_en` renames the URLs of every pack size. Lower-case letters, digits, single hyphens. |
| `subtitle_en`, `subtitle_de`, `short_description_en`, `short_description_de`, `description_en`, `description_de` | no | |
| `highlights_en`, `highlights_de`, `uses_en`, `uses_de` | no | Lists, `\|` separated, at most 20 entries. |
| `brand` | no | |
| `category_slug` | for creates | `slug_en` of the category: an existing one or a row of the categories sheet of the same import. |
| `pack_value`, `pack_unit` | for creates | Pack size. For example `5` and `kg`. Units: `g`, `kg`, `ml`, `l`, `pcs`. All pack sizes of a product share one family of units (`g` and `kg`, `ml` and `l`, or `pcs`), and no pack appears twice; at most 20 pack sizes per product. On an update a changed pack renames the URL of the pack size. |
| `variant_enabled` | no | Pack size. Default yes. No: the pack size is not offered, not listed and cannot be ordered; its URL answers 404. The product stays in the shop with its other sizes. |
| `regular_price` | for creates | Pack size. Euros, VAT included, up to two decimals, `4.99` or `4,99`. |
| `sale_price` | no | Pack size. Euros. `0` ends a sale. |
| `discount_percent` | no | Pack size. 1–99, the alternative to a sale price (not both). `0` ends a sale. |
| `vat_rate` | for creates | Percent: `7` or `19`. The same for every pack size of the product. |
| `status` | no | `draft` (default), `active`, `archived`. |
| `is_available` | no | Default yes. No: every pack size is shown as not available and cannot be ordered. |
| `is_featured` | no | Default no. |
| `sort_order` | no | 0–1000000; the position among the products of its category, 0 first. Default on a create: the last position. |
| `min_order_quantity` | no | Default 1. Packs per order, the same for every pack size. |
| `max_order_quantity` | no | `0` removes the limit. |
| `stock_quantity` | no | Pack size. Units in stock. On a create the opening stock (default 0); on an update the new count, written to the stock history of the pack size as an import. |
| `low_stock_threshold` | no | Pack size. The admin is warned at this count or below. `0` removes the threshold. |
| `storage_type` | no | `ambient` (default), `chilled`, `frozen`. |
| `ingredients_en`, `ingredients_de`, `allergens_en`, `allergens_de`, `nutrition_en`, `nutrition_de`, `storage_instructions_en`, `storage_instructions_de`, `origin`, `manufacturer` | no | The food information, free text. |
| `tags` | no | `\|` separated, lower-case letters, digits and hyphens, at most 20. |
| `search_keywords` | no | `\|` separated, at most 30. |
| `seo_title_en`, `seo_title_de`, `seo_description_en`, `seo_description_de` | no | |

Images are not part of the sheet: an exported row has no image columns, and an import never changes the images of a product.

What a product row does, in the order the import decides it:

1. Its `sku` names an existing pack size: the row updates that pack size, and, when it is the first row of its product in the file, the product columns too (`existing: update`; with `skip` the row is skipped).
2. No existing pack size, but the product exists (by `slug_en`, or by the name's slug) or another row of the file creates it: the row adds a pack size to it. It needs `pack_value`, `pack_unit` and `regular_price`; the preview reports `changes: ["variant"]`.
3. Neither: the row creates the product with this pack size. It needs `name_en`, `category_slug`, `vat_rate`, `pack_value`, `pack_unit` and `regular_price`.

A row without a `sku` on a product that exists is matched to the pack size with the same `pack_value` and `pack_unit`, or to the only pack size of the product; without a match it adds a pack size, which then needs a `sku`.

## 4. The endpoints

Permissions: `catalog.manage` for the two import routes, `catalog.read` for the export.

### `POST /v1/admin/catalog/import/preview`

Body:

```json
{
  "categories": [ { "slug_en": "rice-and-grains", "name_en": "Rice & Grains", "name_de": "Reis & Getreide" } ],
  "products":   [
    { "sku": "RF-BASMATI-1", "name_en": "Basmati Rice", "slug_en": "basmati-rice", "category_slug": "rice-and-grains", "pack_value": "1", "pack_unit": "kg", "regular_price": "4.99", "vat_rate": "7" },
    { "sku": "RF-BASMATI-5", "slug_en": "basmati-rice", "pack_value": "5", "pack_unit": "kg", "regular_price": "19.99" }
  ],
  "existing": "skip"
}
```

The two product rows are one product with two pack sizes: the first row carries the product, the second adds its 5 kg size.

`categories` and `products` are optional (send one or both), at most 2,000 rows each. `existing`: `skip` (default) or `update`.

Answer (200), nothing written:

```json
{
  "categories": {
    "summary": { "total": 3, "create": 2, "update": 0, "skip": 1, "unchanged": 0, "error": 0 },
    "rows": [
      { "row": 1, "key": "basmati", "name": "Basmati", "action": "create", "id": null, "changes": [], "problems": [] },
      { "row": 2, "key": "rice-and-grains", "name": "Rice & Grains", "action": "skip", "id": "66f0…", "changes": [], "problems": [] },
      { "row": 3, "key": "snacks", "name": "Snacks", "action": "error", "id": null, "changes": [], "problems": ["parent_slug: \"nowhere\" is neither an existing category nor a row of this file"] }
    ],
    "unknownColumns": ["colour"]
  },
  "products": {
    "summary": { "total": 2, "create": 2, "update": 0, "skip": 0, "unchanged": 0, "error": 0 },
    "rows": [
      { "row": 1, "key": "RF-BASMATI-1", "name": "Basmati Rice", "action": "create", "id": null, "variantId": null, "changes": [], "problems": [] },
      { "row": 2, "key": "RF-BASMATI-5", "name": "Basmati Rice", "action": "create", "id": null, "variantId": null, "changes": ["variant"], "problems": [] }
    ],
    "unknownColumns": []
  },
  "applied": false,
  "stoppedAt": null
}
```

- `row`: 1 for the first data row of the file (the header is not counted).
- `key`: what the row was matched by: the `slug_en` of a category; the SKU of a pack size (for a row without one, the SKU of the pack size it was matched to, else the `slug_en` of its product).
- `action`: `create` (a product with its first pack size, or a further pack size, in which case `changes` is `["variant"]`); `update` (with `existing: update`, and `changes` names the fields of the pack size and, from the first row of the product, of the product: `regularPrice`, `isEnabled`, `stock`, `name`, `category`, `slug`, …); `skip` (matches a record and `existing` is `skip`); `unchanged` (`existing: update`, nothing differs); `error` (`problems` says what, nothing would be written for this row).
- `id`: the record the row matched, or after an import the record it created: the category, or the product the pack size belongs to.
- `variantId` (product rows only): the pack size the row matched, or after an import the one it created.
- `unknownColumns`: columns of the file the import does not know; they are ignored. Show them so a typo in a header is noticed.
- `400 VALIDATION_FAILED`: more than 2,000 rows, or a body that is not rows.

### `POST /v1/admin/catalog/import`

The same body. Answer (200): the same shape with `applied: true`, the ids of created records in `id`, and `stoppedAt: null` or `{ "type": "categories" | "products", "row": 7 }` when a row failed while writing (its `action` is `error`, its `problems` say why; the rows after it are `skip` with "Not written: the import stopped earlier."). Categories are written before products, parents before children; the row that creates a product before the rows that add its pack sizes. A row that updates writes the product columns first, then the pack size, then the stock count.

### `GET /v1/admin/catalog/export?type=categories|products`

Answer (200): `{ "type": "products", "columns": [ "sku", "gtin", … ], "rows": [ { "sku": "RF-00001", "gtin": "", … } ] }`. Every value is a string in the writing of the import (`19.99`, `7`, `yes`, `a|b`), categories in display order, products by `slug_en` and then by pack size, smallest first: one row per pack size, with the product columns repeated on every row of the product. The rows import again as `unchanged`.

## 5. The admin panel

Suggested flow, in one screen per sheet:

1. **Choose a file.** Parse it in the browser (PapaParse or SheetJS; both read `.csv`, SheetJS reads `.xlsx` as well). Keep the header names exactly as they are; trim the cells.
2. **Preview.** Send the rows to `/import/preview` with `existing: skip`. Show the summary and a table of the rows: row number, key, name, action, changes, problems. A row with `changes: ["variant"]` adds a pack size to a product that exists or that another row creates. Highlight `error` rows and `unknownColumns`. Offer a second preview with `existing: update` ("Update the N existing records with the fields in the file") that lists the changes per row.
3. **Confirm.** A button "Import" sends `/import` with the `existing` the admin chose. The confirmation text names the counts: "Create 12, update 3, skip 40". Show the result with the same table; if `stoppedAt` is set, say which row stopped it, that the rows before it are written, and that importing the file again continues safely.
4. **Export.** A button per sheet calls `/export` and writes an `.xlsx` (SheetJS `XLSX.utils.json_to_sheet(rows, { header: columns })`) or `.csv`. The file imports again as is.

Both sheets of one import can be sent in one request; the products may refer to categories of the same request by `category_slug`.
