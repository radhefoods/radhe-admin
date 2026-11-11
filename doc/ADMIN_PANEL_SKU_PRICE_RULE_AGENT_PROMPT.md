# Guide for the admin panel agent: a price rule per pack size (SKU)

Copy everything below the line into the agent that works on the admin panel (`radhe-admin`).

---

You are working on the Radhe Foods admin panel (`radhe-admin`, Next.js). The API can now price one pack size (one article number) by its own fulfilment charge and markup. This adds one small form to the "Pricing" block of the product page, which is step 3 of `ADMIN_PANEL_SUPPLY_PRICING_IMAGES_AGENT_PROMPT.md`. Do this after that step, or together with it if you have not built it yet.

**Read first:** in the `radhe-api` repository (the sibling folder `../radhe-api`), `doc/SUPPLIER_IMPORT.md`, the sections "Prices" and "`GET /products/{id}/pricing`", and the paragraph "A rule per pack size" in section 31 of `doc/ADMIN_API_DOCUMENTATION.md`. Where this guide and those documents differ, the documents are right.

**Do not change the theme, colours, fonts, typography or any unrelated functionality.** Reuse the form fields, badges and toasts the "Pricing" block already has.

## What changed in the API

Four levels set the price rule now, value by value. The nearest one that sets a value wins for that value:

1. the shop (`GET` / `PUT /v1/admin/supply/settings`);
2. a category (`pricing` on the category);
3. a product (`pricing` on the product);
4. **new: a pack size** (`priceRule` on the pack size).

Nothing else changed. A pack size without `priceRule` is priced exactly as before, and that is every pack size until an admin sets something.

Example, one rice at 7 % VAT:

| Pack size | `priceRule`                                        | Fulfilment  | Markup      | Buying price | Price   |
| --------- | -------------------------------------------------- | ----------- | ----------- | ------------ | ------- |
| 5 kg      | `null`                                             | 10 % (shop) | 35 % (shop) | 8.00 €       | 12.71 € |
| 10 kg     | `{ "fulfilmentPercent": 12, "markupPercent": 40 }` | 12 % (own)  | 40 % (own)  | 15.00 €      | 25.17 € |

### Writing

`priceRule` is accepted on a pack size in three calls, all with the permission `catalog.manage`:

- `PATCH /v1/admin/products/{id}/variants/{variantId}`
- `POST /v1/admin/products/{id}/variants`
- `POST /v1/admin/products`, inside each entry of `variants`

```json
{ "priceRule": { "fulfilmentPercent": 12, "markupPercent": 40 } }
```

- Four optional values: `fulfilmentPercent`, `extraPercent`, `markupPercent` (0 to 1000, at most two decimals) and `extraAmount` (whole cents per pack, 0 to 100,000). `400 VALIDATION_FAILED` otherwise.
- A value that is left out or `null` follows the product.
- What you send **replaces** what the pack size had. To change one value, send all the values the pack size keeps.
- `"priceRule": null` (or `{}`) removes it: the pack size follows its product again.
- A pack size in price mode `auto` is calculated again in the same request, and the answer has the new price. A pack size in mode `manual` keeps its price; its rule then only changes the profit shown.

### Reading

- Every pack size in the admin product answers (`variants[]`, `defaultVariant`) has `priceRule`: the object, or `null`. Careful with the names: on a pack size, `pricing` is the price (`regularPrice`, `salePrice`, …), and `priceRule` is the rule. On a product and on a category, `pricing` is the rule.
- `GET /v1/admin/supply/products/{id}/pricing`: the top-level `rule`, `sources` and `override` are those of the **product**, as before. Each entry of `variants` now also has:

```json
{
  "variantId": "…",
  "sku": "RF-00002",
  "packSize": { "value": 10, "unit": "kg" },
  "priceMode": "auto",
  "cost": 1500,
  "rule": {
    "fulfilmentPercent": 12,
    "extraPercent": 0,
    "extraAmount": 0,
    "markupPercent": 40
  },
  "sources": {
    "fulfilmentPercent": "variant",
    "extraPercent": "shop",
    "extraAmount": "shop",
    "markupPercent": "variant"
  },
  "override": { "fulfilmentPercent": 12, "markupPercent": 40 },
  "calculated": {
    "cost": 1500,
    "fulfilment": 180,
    "extra": 0,
    "markup": 672,
    "net": 2352,
    "vat": 164.64,
    "price": 2517
  },
  "price": 2517
}
```

`rule` is what this pack size is calculated by, `sources` says where each value comes from (`shop`, `category`, `product`, or `variant` for the pack size itself), `override` is what the pack size sets itself (`null` when nothing). `calculated` and `profit` already use the rule of the pack size.

## What to build

In the "Pricing" block of the product page, per pack size:

1. Show the percentages of **that pack size**: take them from `variants[].rule`, no longer from the top-level `rule`. Next to each value a small badge from `variants[].sources`: "shop", "category", "product" or "this pack size".
2. A small form "Price rule of this pack size" with the same four optional fields as the form of the product: fulfilment %, other expenses %, other expenses in euros (send cents), markup %. Fill it from `variants[].override`. An empty field means "follow the product": show the value it would follow as the placeholder (the top-level `rule` of the same answer).
3. Save with `PATCH /v1/admin/products/{id}/variants/{variantId}` and `{ "priceRule": { …the fields that are filled… } }`, or `{ "priceRule": null }` when all four are empty. A button "Follow the product" sends `null`.
4. After saving, load the breakdown again and show the new price. When the pack size is in mode `manual`, say under the form: "The price of this pack size is set by hand. Its rule does not change the price, only the profit shown."
5. In the list of pack sizes, mark a pack size that has a `priceRule` with a badge "own price rule".
6. Without `catalog.manage` the form is read-only. Nothing of this is shown without `catalog.read`.

The "Cost & profit" section of an order (`ADMIN_PANEL_ORDER_PROFIT_AGENT_PROMPT.md`) needs no change: `lines[].unit.rule` already holds the rule of the pack size as it was when the order was placed.

## Where to change the panel

| File or place                                                | Change                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| The types of a pack size and of the pricing breakdown        | `priceRule` on the pack size; `rule`, `sources`, `override` on each entry of `variants`; `variant` as a fourth source. |
| The schema and form of a pack size (`variant-rows.tsx`, …)   | The four optional fields, sent as `priceRule`.                                                                         |
| The "Pricing" block of the product page (`product-view.tsx`) | Percentages and badges per pack size, the form, the note for `manual`.                                                 |
| `mocks/`                                                     | `priceRule` on pack sizes, and a breakdown that resolves the four levels.                                              |
| Tests of the product page                                    | Setting, changing and removing the rule of a pack size.                                                                |

## How to work

Write a short plan and wait for my go. Then build it, run the panel's lint, type check and tests, and report what you built and what you left out.
