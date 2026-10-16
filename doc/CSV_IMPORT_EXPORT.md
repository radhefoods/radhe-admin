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

## 2. The rules

- **No duplicates.** A category row is matched by `slug_en`; without a slug, by the slug the name would get (`Rice & Grains` → `rice-and-grains`). A product row is matched by `sku`; without a SKU, by `slug_en`, and without that by the slug its name and pack size would get (`Basmati Rice`, 1 kg → `basmati-rice-1-kg`). A row that matches is never created again.
- **Nothing is overwritten without asking.** `existing` in the request says what happens to a row that matches: `skip` (the default) leaves the record as it is; `update` changes the fields the row provides. The panel shows the preview and asks before it sends `update`.
- **An empty cell means "leave it as it is"** on an update, and "the default" on a create. To remove a value, write what the column says: `sale_price` `0` ends a sale, `max_order_quantity` `0` removes the limit, `parent_slug` `none` makes a main category, `variant_of_sku` `none` separates a pack size from its product.
- **Images are never touched**, nor the SKU of an existing product (the SKU is the key), nor the links to orders, nor the price history (a changed price is recorded there like a change made in the form).
- **Order of the rows does not matter.** Parents are created before their children, and the main pack size before its other sizes, wherever they stand in the file. A row may refer to a category or a product that another row of the same import creates.
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
| `seo_title_en`, `seo_title_de`, `seo_description_en`, `seo_description_de` | no | |

The category image is not part of the sheet: upload it in the panel.

### 3.2 Products (`products-example.csv`)

| Column | Required | Meaning |
| --- | --- | --- |
| `sku` | for updates | The key, 2–40 characters (letters, digits, `.`, `_`, `-`), stored upper-case. Generated (`RF-00001`, …) on a create when empty. |
| `gtin` | no | Barcode, 8, 12, 13 or 14 digits. |
| `name_en` | for creates | |
| `name_de` | no | |
| `slug_en`, `slug_de` | no | Generated from name and pack size when empty. |
| `subtitle_en`, `subtitle_de`, `short_description_en`, `short_description_de`, `description_en`, `description_de` | no | |
| `highlights_en`, `highlights_de`, `uses_en`, `uses_de` | no | Lists, `\|` separated, at most 20 entries. |
| `brand` | no | |
| `category_slug` | for creates | `slug_en` of the category: an existing one or a row of the categories sheet of the same import. |
| `pack_value`, `pack_unit` | for creates | For example `5` and `kg`. Units: `g`, `kg`, `ml`, `l`, `pcs`. |
| `variant_of_sku` | no | The SKU of the main pack size of the same product (existing or in the file). Empty: a product of its own on a create, unchanged on an update. `none`: separate it. |
| `regular_price` | for creates | Euros, VAT included, up to two decimals, `4.99` or `4,99`. |
| `sale_price` | no | Euros. `0` ends a sale. |
| `discount_percent` | no | 1–99, the alternative to a sale price (not both). `0` ends a sale. |
| `vat_rate` | for creates | Percent: `7` or `19`. |
| `status` | no | `draft` (default), `active`, `archived`. |
| `is_available` | no | Default yes. No: shown as sold out, cannot be ordered. |
| `is_featured` | no | Default no. |
| `sort_order` | no | 0–1000000. |
| `min_order_quantity` | no | Default 1. |
| `max_order_quantity` | no | `0` removes the limit. |
| `stock_quantity` | no | Units in stock. On a create the opening stock (default 0); on an update the new count, written to the stock history as an import. |
| `low_stock_threshold` | no | The admin is warned at this count or below. `0` removes the threshold. |
| `storage_type` | no | `ambient` (default), `chilled`, `frozen`. |
| `ingredients_en`, `ingredients_de`, `allergens_en`, `allergens_de`, `nutrition_en`, `nutrition_de`, `storage_instructions_en`, `storage_instructions_de`, `origin`, `manufacturer` | no | The food information, free text. |
| `tags` | no | `\|` separated, lower-case letters, digits and hyphens, at most 20. |
| `search_keywords` | no | `\|` separated, at most 30. |
| `seo_title_en`, `seo_title_de`, `seo_description_en`, `seo_description_de` | no | |

Images are not part of the sheet: an exported row has no image columns, and an import never changes the images of a product.

## 4. The endpoints

Permissions: `catalog.manage` for the two import routes, `catalog.read` for the export.

### `POST /v1/admin/catalog/import/preview`

Body:

```json
{
  "categories": [ { "slug_en": "rice-and-grains", "name_en": "Rice & Grains", "name_de": "Reis & Getreide" } ],
  "products":   [ { "sku": "RF-BASMATI-1", "name_en": "Basmati Rice", "category_slug": "rice-and-grains", "pack_value": "1", "pack_unit": "kg", "regular_price": "4.99", "vat_rate": "7" } ],
  "existing": "skip"
}
```

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
  "products": { "summary": { "…": "" }, "rows": [ "…" ], "unknownColumns": [] },
  "applied": false,
  "stoppedAt": null
}
```

- `row`: 1 for the first data row of the file (the header is not counted).
- `action`: `create`; `update` (with `existing: update`, and `changes` names the fields); `skip` (matches a record and `existing` is `skip`); `unchanged` (`existing: update`, nothing differs); `error` (`problems` says what, nothing would be written for this row).
- `id`: the record the row matched, or after an import the record it created.
- `unknownColumns`: columns of the file the import does not know; they are ignored. Show them so a typo in a header is noticed.
- `400 VALIDATION_FAILED`: more than 2,000 rows, or a body that is not rows.

### `POST /v1/admin/catalog/import`

The same body. Answer (200): the same shape with `applied: true`, the ids of created records in `id`, and `stoppedAt: null` or `{ "type": "categories" | "products", "row": 7 }` when a row failed while writing (its `action` is `error`, its `problems` say why; the rows after it are `skip` with "Not written: the import stopped earlier."). Categories are written before products.

### `GET /v1/admin/catalog/export?type=categories|products`

Answer (200): `{ "type": "products", "columns": [ "sku", "gtin", … ], "rows": [ { "sku": "RF-00001", "gtin": "", … } ] }`. Every value is a string in the writing of the import (`19.99`, `7`, `yes`, `a|b`), categories in display order, products by SKU. The rows import again as `unchanged`.

## 5. The admin panel

Suggested flow, in one screen per sheet:

1. **Choose a file.** Parse it in the browser (PapaParse or SheetJS; both read `.csv`, SheetJS reads `.xlsx` as well). Keep the header names exactly as they are; trim the cells.
2. **Preview.** Send the rows to `/import/preview` with `existing: skip`. Show the summary and a table of the rows: row number, key, name, action, changes, problems. Highlight `error` rows and `unknownColumns`. Offer a second preview with `existing: update` ("Update the N existing records with the fields in the file") that lists the changes per row.
3. **Confirm.** A button "Import" sends `/import` with the `existing` the admin chose. The confirmation text names the counts: "Create 12, update 3, skip 40". Show the result with the same table; if `stoppedAt` is set, say which row stopped it, that the rows before it are written, and that importing the file again continues safely.
4. **Export.** A button per sheet calls `/export` and writes an `.xlsx` (SheetJS `XLSX.utils.json_to_sheet(rows, { header: columns })`) or `.csv`. The file imports again as is.

Both sheets of one import can be sent in one request; the products may refer to categories of the same request by `category_slug`.
