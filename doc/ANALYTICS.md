# Admin dashboard: Decisions and Analytics

For the Admin Panel agent. The start page of the panel has two tabs as of 2026-10-24: **Decisions**, the existing overview of what waits for the admin (`GET /v1/admin/attention`, section 15 of `doc/ADMIN_API_DOCUMENTATION.md`, unchanged), and **Analytics**, the figures of the shop over a period (`/v1/admin/analytics/*`, this document; section 21 of the admin documentation is the short form).

**Strict rule:** do not change the visual design. Build the tabs, the range picker, the KPI tiles, the charts and the tables with the panel's existing components, colours and typography. Use the chart library the panel already has; if it has none, choose a small one and style it with the panel's theme tokens.

## 1. What counts when

Every figure is computed from the records when asked; nothing is pre-computed, so nothing is ever stale. The rules:

| Figure | Counted on the day | Source |
| --- | --- | --- |
| Revenue, orders, units, buyers, best sellers, payment types | the money was captured (`payment.paidAt`) | `orders` |
| Cancellations | the order was cancelled, and it had been paid | `orders.cancellation.at` |
| Abandoned checkouts | the order was cancelled without ever being paid (payment page expired, customer gave up) | `orders.cancellation.at` |
| Dispatched, delivered | the status was reached | `orders.delivery.dispatchedAt`, `deliveredAt` |
| Credits | the credit note was issued (returns, corrections) | `invoices` of type `credit_note` |
| Refunds completed, refunded amount | the refund was completed | `refunds.completedAt` |
| Refunds created, returns requested, checkouts started, stock movements, new customers | the record was created | the time in the record's id, `customers.createdAt` |
| Returns completed, credited | the return was completed | `returns.completedAt` |
| Stock on hand, low and sold-out sizes | now | `products` |

Amounts are **cents, VAT included**, unless the name says otherwise (`netOfVat`, `vat`). `gross` is what customers paid for the orders paid in the period: goods, delivery fee, VAT. `net` is `gross` minus the refunds completed in the period: what Radhe Foods kept. Credits are shown as information; they are not subtracted again (a return credits and refunds the same money).

A cancelled order that had been paid stays in the revenue of the day it was paid; its refund appears in the refunds of the day it was paid back. This is how the books read it.

## 2. Ranges and comparison

Every endpoint takes the same query:

| Parameter | Values | Default |
| --- | --- | --- |
| `range` | `today`, `yesterday`, `last_7_days`, `this_month`, `last_month`, `custom` | `this_month`: the first of the month up to today |
| `from`, `to` | `YYYY-MM-DD`, both included, for `custom`; at most 731 days | |
| `granularity` | `day`, `week` (Monday to Sunday), `month` | by the length: up to 31 days `day`, up to 182 `week`, else `month` |

Days are calendar days of the business time zone (`BUSINESS_TIMEZONE`, Europe/Berlin): a day runs from midnight to midnight in Berlin whatever the server's clock says. The panel sends dates, never instants.

Every answer repeats the resolved range:

```json
"range": {
  "preset": "this_month",
  "from": "2026-10-01",
  "to": "2026-10-24",
  "days": 24,
  "timeZone": "Europe/Berlin",
  "granularity": "day",
  "previous": { "from": "2026-09-01", "to": "2026-09-24" }
}
```

The **previous period** is what the figures are compared with: the same length just before the range, except that `this_month` is compared with last month up to the same day, and `last_month` with the month before it. A compared figure is a **KPI object**:

```json
{ "value": 184250, "previous": 151980, "change": 21.2 }
```

`change` is the change in percent, one decimal; `null` when `previous` is 0.

Errors: `400 ANALYTICS_RANGE_INVALID` (custom without dates, `from` after `to`, a day that does not exist, more than 731 days), `400 VALIDATION_FAILED` (unknown preset or granularity, a date not in `YYYY-MM-DD`).

**Permission:** `analytics.read` for every endpoint. It is a permission of its own: revenue is more sensitive than order handling. The super admin has it through the wildcard; other roles need it granted.

## 3. Endpoints

All under `/v1/admin/analytics`, `GET`, reads only. The panel loads them in parallel; each one is one round trip.

### `GET /v1/admin/analytics/summary`

The KPI tiles.

```json
{
  "range": { "…": "" },
  "revenue": {
    "gross": { "value": 184250, "previous": 151980, "change": 21.2 },
    "net": { "value": 181854, "previous": 151980, "change": 19.7 },
    "goods": { "value": 171280, "previous": 140200, "change": 22.2 },
    "deliveryFees": { "value": 12970, "previous": 11780, "change": 10.1 },
    "vat": { "value": 16114, "previous": 13290, "change": 21.3 },
    "netOfVat": { "value": 168136, "previous": 138690, "change": 21.2 },
    "credits": { "value": 798, "previous": 0, "change": null },
    "refunded": { "value": 2396, "previous": 0, "change": null }
  },
  "orders": {
    "paid": { "value": 61, "previous": 52, "change": 17.3 },
    "averageOrderValue": { "value": 3020, "previous": 2923, "change": 3.3 },
    "units": { "value": 214, "previous": 180, "change": 18.9 },
    "cancelled": { "value": 1, "previous": 0, "change": null },
    "abandoned": { "value": 7, "previous": 9, "change": -22.2 },
    "dispatched": { "value": 58, "previous": 51, "change": 13.7 },
    "delivered": { "value": 55, "previous": 50, "change": 10 }
  },
  "customers": {
    "buyers": { "value": 44, "previous": 39, "change": 12.8 },
    "firstTime": { "value": 18, "previous": 21, "change": -14.3 },
    "returning": { "value": 26, "previous": 18, "change": 44.4 },
    "new": { "value": 23, "previous": 25, "change": -8 }
  },
  "returns": {
    "requested": { "value": 2, "previous": 1, "change": 100 },
    "completed": { "value": 1, "previous": 1, "change": 0 },
    "credited": { "value": 399, "previous": 1299, "change": -69.3 }
  },
  "refunds": {
    "completed": { "value": 2, "previous": 0, "change": null },
    "amount": { "value": 2396, "previous": 0, "change": null }
  }
}
```

- `buyers`: customers who paid at least one order in the period. `firstTime`: buyers whose first paid order ever falls in the period. `returning` = buyers − firstTime. `new`: accounts created in the period.
- `averageOrderValue` = gross / paid, rounded to cents.

### `GET /v1/admin/analytics/sales`

The main chart. One point per bucket of the granularity, zero-filled, for the period and for the previous period (the same number of points, or one more or less at the edges of weeks and months).

```json
{
  "range": { "…": "" },
  "current": [
    { "period": "2026-10-01", "revenue": 8120, "orders": 3, "units": 11, "averageOrderValue": 2707, "refunded": 0 },
    { "period": "2026-10-02", "revenue": 0, "orders": 0, "units": 0, "averageOrderValue": 0, "refunded": 0 }
  ],
  "previous": [
    { "period": "2026-09-01", "revenue": 5990, "orders": 2, "units": 7, "averageOrderValue": 2995, "refunded": 0 }
  ]
}
```

`period` is the first day of the bucket (`YYYY-MM-DD`): the day, the Monday of the week, the first of the month. The first week or month bucket may begin before the range; it holds only what happened inside the range. Chart the two series on one axis by index (day 1 against day 1), and show a toggle for `granularity` on ranges longer than a month.

### `GET /v1/admin/analytics/products`

Query: `limit` (default 10, ≤50), `sortBy` = `units` (default) | `revenue`.

```json
{
  "range": { "…": "" },
  "sortBy": "units",
  "totals": { "units": 214, "revenue": 171280, "products": 37 },
  "bestSellers": [
    {
      "product": { "id": "66f1…", "name": { "en": "Bhakhri Atta", "de": "Bhakhri-Mehl" }, "slug": { "en": "bhakhri-atta", "de": "bhakhri-mehl" }, "status": "active", "image": { "url": "…", "sizes": { "…": "" } } },
      "units": { "value": 41, "previous": 30, "change": 36.7 },
      "revenue": { "value": 16359, "previous": 11970, "change": 36.7 },
      "orders": 29,
      "variants": [
        { "variantId": "66f2…", "sku": "RF-00010", "packSize": { "value": 1, "unit": "kg" }, "units": 31, "revenue": 12369 },
        { "variantId": "66f3…", "sku": "RF-00011", "packSize": { "value": 5, "unit": "kg" }, "units": 10, "revenue": 3990 }
      ]
    }
  ],
  "categories": [
    { "category": { "id": "66e1…", "name": { "en": "Flours", "de": "Mehle" }, "slug": { "…": "" } }, "units": 88, "revenue": { "value": 51200, "previous": 44100, "change": 16.1 }, "share": 29.9, "products": 6 },
    { "category": null, "units": 2, "revenue": { "value": 798, "previous": 0, "change": null }, "share": 0.5, "products": 1 }
  ]
}
```

- `product.name` and `image` are the product's as it is today; a product that was deleted since keeps the name of the order, `status` and `image` `null`.
- `variants`: the pack sizes sold, best first.
- `categories`: sales by the category the product is in **today**, revenue share of the goods revenue in percent, number of distinct products sold. `category: null` gathers products that left the catalogue. Revenue descending.

### `GET /v1/admin/analytics/customers`

Query: `limit` (default 10, ≤50).

```json
{
  "range": { "…": "" },
  "new": { "value": 23, "previous": 25, "change": -8 },
  "buyers": { "value": 44, "previous": 39, "change": 12.8 },
  "firstTime": { "value": 18, "previous": 21, "change": -14.3 },
  "returning": { "value": 26, "previous": 18, "change": 44.4 },
  "repeatRate": { "value": 59.1, "previous": 46.2, "change": 27.9 },
  "newCustomers": [ { "period": "2026-10-01", "count": 2 }, { "period": "2026-10-02", "count": 0 } ],
  "topCustomers": [
    { "customer": { "id": "66c1…", "name": "Anna Schmidt", "email": "anna@example.com" }, "orders": 4, "revenue": 18420, "averageOrderValue": 4605, "lastOrderAt": "2026-10-22T17:40:00.000Z" }
  ],
  "byLanguage": [ { "language": "de", "orders": 40, "revenue": 121000 }, { "language": "en", "orders": 21, "revenue": 63250 } ]
}
```

`repeatRate` is the share of returning buyers among the buyers, in percent. `topCustomers` by revenue of the period; the name and email are those on the orders.

### `GET /v1/admin/analytics/payments`

```json
{
  "range": { "…": "" },
  "byType": [
    { "type": "card", "orders": 47, "amount": 141900, "share": 77 },
    { "type": "paypal", "orders": 14, "amount": 42350, "share": 23 }
  ],
  "checkouts": { "started": 71, "paid": 61, "pending": 1, "failed": 2, "abandoned": 7, "conversion": 85.9 },
  "refunds": {
    "created": { "count": 2, "amount": 2396 },
    "completed": { "count": 2, "amount": 2396 },
    "byStatus": [ { "key": "completed", "count": 2, "amount": 2396 } ],
    "byReason": [ { "key": "return", "count": 1, "amount": 399 }, { "key": "other", "count": 1, "amount": 1997 } ],
    "byMethod": [ { "key": "stripe", "count": 1, "amount": 399 }, { "key": "manual", "count": 1, "amount": 1997 } ]
  },
  "returns": {
    "requested": 2,
    "completed": { "count": 1, "credited": 399 },
    "byStatus": [ { "status": "completed", "count": 1 }, { "status": "requested", "count": 1 } ],
    "byReason": [ { "reason": "damaged", "items": 2, "units": 3 } ]
  }
}
```

- `byType`: `card`, `paypal`, or `unknown` for orders paid before the type was recorded; `share` of the amount in percent.
- `checkouts`: the orders **started** in the period and what became of them by now: `paid` (also later), `pending` (payment page still open), `failed` (last attempt failed, order still waiting), `abandoned` (cancelled unpaid). `conversion` = paid / started in percent.
- `refunds.created`: refunds created in the period, in any status now; `completed`: paid out in the period, whenever created. `byStatus`, `byReason`, `byMethod` describe the created ones.
- `returns.requested`: requested in the period; `byStatus` their status now; `byReason` their items by reason, with the units asked for; `completed`: completed in the period and what they credited.

### `GET /v1/admin/analytics/inventory`

Query: `limit` (default 10, ≤50), for the three lists.

```json
{
  "range": { "…": "" },
  "stock": { "variants": 96, "unitsOnHand": 2140, "stockValue": 1021300, "variantsOutOfStock": 4, "variantsLow": 7, "productsOutOfStock": 2 },
  "movements": {
    "sold": { "value": 214, "previous": 180, "change": 18.9 },
    "restocked": { "value": 300, "previous": 120, "change": 150 },
    "returned": { "value": 3, "previous": 1, "change": 200 },
    "released": { "value": 2, "previous": 4, "change": -50 },
    "adjusted": { "value": -5, "previous": 0, "change": null }
  },
  "lowStock": [ { "productId": "66f1…", "name": { "en": "Bhakhri Atta" }, "variantId": "66f2…", "sku": "RF-00010", "packSize": { "value": 1, "unit": "kg" }, "quantity": 4, "threshold": 5 } ],
  "outOfStock": [ { "productId": "66f4…", "name": { "en": "Basmati Rice" }, "variantId": "66f5…", "sku": "RF-00020", "packSize": { "value": 5, "unit": "kg" }, "quantity": 0, "threshold": null } ],
  "slowMovers": {
    "count": 9,
    "items": [ { "product": { "id": "66f6…", "name": { "en": "Papad" }, "slug": { "…": "" }, "status": "active", "image": null }, "unitsOnHand": 40, "stockValue": 7960 } ]
  }
}
```

- `stock` is **now**, over the enabled pack sizes of active products: `stockValue` at selling prices (there is no cost price in the system), `variantsLow` at or below their threshold with units left, `productsOutOfStock` active products of which no enabled size has units.
- `movements` are units from the stock ledger in the period: `sold` by paid orders, `restocked` by the admin (the opening count of a new pack size counts as a restock), `returned` by completed returns, `released` by cancellations and checkouts that did not complete, `adjusted` by corrections and CSV imports (net, may be negative).
- `lowStock` and `outOfStock`: the pack sizes, fewest units first. `slowMovers`: active products that sold nothing in the period, with how many are there in all.

## 4. Panel workflow

- Start page with two tabs. **Decisions** is the page as it is today. **Analytics** opens with `range=this_month`.
- Range picker in the page header: the five presets and a custom date range (two date inputs, calendar days); a granularity toggle (day / week / month) that appears for ranges longer than a month and sends `granularity`. Keep the choice in the URL (`?range=…&from=…&to=…`) so it survives a reload.
- Layout, top to bottom, every section loading on its own:
  1. KPI tiles from `summary`: gross revenue, net revenue, paid orders, average order value, buyers (first-time / returning), new customers; each with the change against the previous period (arrow and percent, muted when `change` is `null`). Secondary tiles: units, cancelled, abandoned, refunded, credits, delivered.
  2. The sales chart from `sales`: revenue per bucket as a line or bars, the previous period as a muted line; a switch between revenue, orders and units; refunds as a second series or a tooltip line.
  3. Best sellers from `products`: a table with image, name, units and revenue with their change, orders, the pack sizes expandable; a toggle `sortBy`. Next to it the categories as a bar or donut by share.
  4. Customers from `customers`: the four KPIs and the repeat rate, new customers per bucket as a small bar chart, the top customers table (link to the customer).
  5. Payments from `payments`: card versus PayPal as a donut, the checkout funnel (started → paid, with pending, failed, abandoned), refunds and returns by status and reason as small tables.
  6. Inventory from `inventory`: stock tiles, units moved, the low and sold-out lists (link to the product), the slow movers.
- Money is cents: format with the panel's existing money formatter. Percentages come ready.
- Empty period: tiles show 0 and the charts their zero-filled points; no error state.
- The permission `analytics.read` hides the tab when missing. The Decisions tab keeps `orders.read`.

## 5. Performance and indexes

- Each endpoint runs a handful of aggregations in parallel, each served by an index: the paid-at, cancellation and delivery dates of orders (partial indexes on the orders that have the date), `customers.createdAt`, `completedAt` of refunds and returns, `invoices (type, issuedAt)`, and the `_id` of records whose creation time matters (refunds, returns, stock movements, checkouts), since an id carries its creation second.
- The first-time buyer figure groups every paid order up to the end of the period by customer; the best sellers unwind the items of the paid orders of the period. For a shop of tens of thousands of orders both take tens of milliseconds.
- `npm run db:indexes` after deploying builds the new indexes (Mongoose builds them on start as well).
- The answers are not cached by the API. The panel may keep them for a minute per range while the admin switches sections.

## 6. Checklist

1. Two tabs; Decisions unchanged.
2. Range picker with presets, custom dates and granularity, kept in the URL.
3. Six sections from the six endpoints, loaded in parallel, every KPI with its change.
4. Money formatted from cents; empty periods without errors; the tab hidden without `analytics.read`.
5. No change to theme, colours, fonts or typography; charts in the panel's palette.
