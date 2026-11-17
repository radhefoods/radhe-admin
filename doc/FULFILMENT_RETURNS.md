# Fulfilment & Returns tracker

Since 2026-11-17 the API answers, for every pack size, how many units left for customers, how many came back, and how many stay sold. Written for the admin panel, which shows it as a report with filters, a dialog of the orders behind each figure, a CSV export and adjustments by hand.

## 1. Names

| In the owner's brief | In the panel (suggested)              | In the API                     |
| -------------------- | ------------------------------------- | ------------------------------ |
| Fulfilment & Returns | **Fulfilment & Returns** (menu, page) | `/v1/admin/fulfilment-tracker` |
| Fulfilment           | **Dispatched**                        | `dispatched`                   |
| Returns              | **Returned**                          | `returned`                     |
| Radhe Foods          | **Net sold**                          | `net`                          |
| View                 | **View orders**                       | `…/variants/{variantId}`       |
| Edit                 | **Adjust**                            | `…/adjustments`                |

The labels are the panel's: the three column names can be changed there without touching the API. "Dispatched" says what is counted (units that left), "Net sold" what is left of it (`dispatched − returned`). Other names that would fit: "Shipped / Returned / Kept", or the owner's own "Fulfilment / Returns / Radhe Foods".

## 2. What is counted

One row is one **pack size** (a SKU). Two pack sizes of one product are two rows and never mixed.

| Figure       | Counts                                                                                      | For the day              |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------ |
| `dispatched` | The delivered units of every order whose status is `dispatched`, `delivered` or `returned`. | the order was dispatched |
| `returned`   | The accepted units of every return whose status is `completed`.                             | the return was completed |
| `net`        | `dispatched − returned`. Always: it is never stored and cannot be set by itself.            |                          |

Both figures include what an admin adjusted by hand (section 5); `adjusted` says how much of each that is.

The rules, and where each comes from:

- **Computed, not stored.** Every figure is worked out from the orders and the returns when it is asked for. There are no counters that an event could raise twice, and nothing that could drift from the orders.
- **An order counts from the moment it is dispatched**, by its `delivery.dispatchedAt`. Paid orders that wait (`confirmed`, `processing`) count nothing. An order that is stepped back from `dispatched` to `processing` stops counting.
- **A cancelled order counts nothing**, also when it was cancelled on its way: its goods are on the shelf again. Returns of an order that no longer counts are not counted either.
- **Delivered units, not ordered units.** When the admin corrects a line ("3 ordered, 1 was missing"), the corrected quantity counts: 2. The dialog of the orders shows both numbers and the correction.
- **A return counts when it is completed**, that is when the goods are back and booked on the order. A return that is `requested` or `approved` counts nothing yet; a `rejected` or `cancelled` one never does.
- **Partial returns.** What counts is the quantity the admin accepted, per pack size: two asked for and one accepted is one.
- **`dispatched` never goes down because of a return.** A return raises `returned` and lowers `net` only.
- **Dates** are calendar days in the business time zone (Europe/Berlin), both ends included. Dispatches count for the day of dispatch, returns for the day they were completed, adjustments for the day they were made for.
- **A period can be down.** With a date range, a return of an order that was dispatched before the range still counts in the range: a pack size can show `dispatched: 0, returned: 1, net: -1`. Over all dates `net` is never below 0.
- **Names** (product, brand, SKU, pack) are those of the catalogue today. A pack size that left the catalogue keeps the name its orders recorded, has `brand: null` and `inCatalogue: false`.

## 3. The API

Permissions: `orders.read` for everything that reads, `orders.manage` to adjust. No new permission.

| Call                                                    | Answers                                          |
| ------------------------------------------------------- | ------------------------------------------------ |
| `GET /v1/admin/fulfilment-tracker`                      | the report: totals and a page of rows            |
| `GET /v1/admin/fulfilment-tracker/brands`               | the brands in the report, for the brand filter   |
| `GET /v1/admin/fulfilment-tracker/variants/{variantId}` | the orders and returns behind one row            |
| `GET /v1/admin/fulfilment-tracker/export`               | every row under the filters, with chosen columns |
| `GET /v1/admin/fulfilment-tracker/adjustments`          | the history of the adjustments                   |
| `POST /v1/admin/fulfilment-tracker/adjustments`         | a new adjustment                                 |

### 3.1 The filters

The report, the brands and the export take the same query parameters, all optional:

| Parameter   | Meaning                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`      | First day, `YYYY-MM-DD`. Left out: from the beginning.                                                                                                                                |
| `to`        | Last day, included. Left out: until now. `from` = `to` is one day; neither is all dates.                                                                                              |
| `q`         | 2 to 80 characters. Every word must be in the product name (English or German), the brand or the SKU.                                                                                 |
| `brand`     | A brand; repeat the parameter for several (`brand=TRS&brand=Heera`). Case does not matter.                                                                                            |
| `productId` | One product, with all its pack sizes.                                                                                                                                                 |
| `variantId` | One pack size.                                                                                                                                                                        |
| `sort`      | `name`, `brand`, `sku`, `dispatched`, `returned` or `net`, with `:asc` or `:desc`. Default `dispatched:desc`; numbers sort largest first and words A to Z when no direction is given. |

`400 VALIDATION_FAILED` for a day that does not exist, `from` after `to`, an unknown sort or column.

### 3.2 `GET /v1/admin/fulfilment-tracker`

The filters, plus `page` (default 1) and `limit` (default 25, at most 100).

```json
{
  "range": {
    "from": "2026-11-01",
    "to": "2026-11-17",
    "timeZone": "Europe/Berlin"
  },
  "totals": {
    "packSizes": 2,
    "products": 2,
    "dispatched": 30,
    "returned": 4,
    "net": 26,
    "adjusted": { "dispatched": 0, "returned": 0 }
  },
  "items": [
    {
      "productId": "66f3…",
      "variantId": "66f4…",
      "sku": "RF-04433",
      "name": {
        "en": "TRS Chana Dal",
        "de": "TRS Chana Dal (Kichererbsen halbiert)"
      },
      "brand": "TRS",
      "packSize": { "value": 1, "unit": "kg", "label": "1 kg" },
      "dispatched": 20,
      "returned": 2,
      "net": 18,
      "orders": 14,
      "returns": 2,
      "adjusted": { "dispatched": 0, "returned": 0 },
      "inCatalogue": true
    }
  ],
  "page": 1,
  "limit": 25,
  "total": 2,
  "totalPages": 1
}
```

- `range.from` and `range.to` are `null` when the side is open.
- `totals` are those of **every** row under the filters, not of the page: use them for the figures above the table.
- `orders` is the number of orders the dispatched units came from, `returns` the number of completed returns.
- A pack size appears when it has a dispatch, a completed return or an adjustment in the period.

### 3.3 `GET /v1/admin/fulfilment-tracker/brands`

The filters (the `brand` filter itself is ignored, so the list stays whole while brands are chosen).

```json
{
  "range": { "from": null, "to": null, "timeZone": "Europe/Berlin" },
  "items": [
    {
      "brand": "Heera",
      "packSizes": 3,
      "dispatched": 12,
      "returned": 0,
      "net": 12
    },
    {
      "brand": "TRS",
      "packSizes": 9,
      "dispatched": 30,
      "returned": 4,
      "net": 26
    },
    { "brand": null, "packSizes": 1, "dispatched": 2, "returned": 0, "net": 2 }
  ]
}
```

By name; `brand: null` (pack sizes without a brand) last.

### 3.4 `GET /v1/admin/fulfilment-tracker/variants/{variantId}`

The orders behind one row. Query: `from`, `to`, `page`, `limit` (default 25, at most 100). `404 PRODUCT_VARIANT_NOT_FOUND` for an id that is neither in the catalogue nor in any order.

```json
{
  "range": { "from": null, "to": null, "timeZone": "Europe/Berlin" },
  "row": { "…a row of the report: the pack size and its figures…": "" },
  "fromOrders": { "dispatched": 4, "returned": 1 },
  "orders": {
    "items": [
      {
        "orderId": "6af9…",
        "orderNumber": "RF-1042",
        "placedAt": "2026-11-10T09:12:00.000Z",
        "orderStatus": "delivered",
        "paymentStatus": "paid",
        "customerName": "Anna Schmidt",
        "delivery": {
          "method": "dhl",
          "trackingNumber": "00340434161094042557",
          "dispatchedAt": "2026-11-11T08:00:00.000Z",
          "deliveredAt": "2026-11-12T13:40:00.000Z"
        },
        "orderedQuantity": 3,
        "deliveredQuantity": 2,
        "dispatched": 2,
        "returned": 1,
        "corrections": [
          {
            "from": 3,
            "to": 2,
            "reason": "missing",
            "at": "2026-11-11T07:55:00.000Z"
          }
        ],
        "returns": [
          {
            "id": "6afa…",
            "returnNumber": "RF-1042-R1",
            "status": "completed",
            "reason": "damaged",
            "requestedQuantity": 2,
            "acceptedQuantity": 1,
            "countedQuantity": 1,
            "requestedAt": "2026-11-13T10:00:00.000Z",
            "completedAt": "2026-11-15T16:20:00.000Z",
            "restocked": true
          }
        ]
      }
    ],
    "page": 1,
    "limit": 25,
    "total": 2,
    "totalPages": 1
  },
  "adjustments": [{ "…an adjustment, see 3.6…": "" }]
}
```

- **Which orders are listed:** every order that adds to `dispatched` in the period, and every order with a return that adds to `returned` in the period. Newest dispatch first.
- `dispatched` and `returned` of an entry are what **this order adds to the figures of the period**. An order that was dispatched before the period and had a unit come back inside it is listed with `dispatched: 0, returned: 1`.
- `orderedQuantity` is what the customer ordered, `deliveredQuantity` what left after the admin's `corrections` (reasons: `missing`, `damaged`, `wrong_item`, `customer_complaint`, `other`).
- `returns` has every return of the order with this pack size, whatever its status. `countedQuantity` is what it adds to `returned`: the accepted quantity of a completed return inside the period, else 0. `acceptedQuantity` is `null` until the admin decided.
- `row` is the line of the report for this pack size and period (all zeros when nothing happened). `fromOrders` is the sum of the entries; `row.dispatched − fromOrders.dispatched` is what `adjustments` add, and the same for `returned`.
- Link an entry to the order page by `orderId`, a return to the return page by its `id`.

### 3.5 `GET /v1/admin/fulfilment-tracker/export`

The filters and the sort of the report, plus `columns`. Answers **every** row, not a page, as a sheet the panel writes to a file (as the catalogue export does).

`columns`: the keys wanted, comma separated or as a repeated parameter, in the order they shall have in the file. Left out: the usual seven (`product_name`, `brand`, `sku`, `pack_size`, `dispatched`, `returned`, `net`).

| Key                   | Label                  | Value                                 |
| --------------------- | ---------------------- | ------------------------------------- |
| `product_name`        | Product name           | English name                          |
| `product_name_de`     | Product name (German)  | German name, or empty                 |
| `brand`               | Brand                  | or empty                              |
| `sku`                 | SKU                    |                                       |
| `pack_size`           | Pack size              | `1 kg`, `500 ml`                      |
| `dispatched`          | Dispatched             | number                                |
| `returned`            | Returned               | number                                |
| `net`                 | Net sold               | number                                |
| `orders`              | Orders                 | orders the dispatched units came from |
| `completed_returns`   | Completed returns      | returns the returned units came from  |
| `adjusted_dispatched` | Adjustment: dispatched | the part adjusted by hand             |
| `adjusted_returned`   | Adjustment: returned   | the part adjusted by hand             |
| `product_id`          | Product ID             |                                       |
| `variant_id`          | Pack size ID           |                                       |

`GET /v1/admin/fulfilment-tracker/export?brand=TRS&from=2026-11-01&to=2026-11-17&columns=product_name,sku,dispatched,returned,net` answers:

```json
{
  "range": {
    "from": "2026-11-01",
    "to": "2026-11-17",
    "timeZone": "Europe/Berlin"
  },
  "fileName": "fulfilment-returns_2026-11-01_to_2026-11-17.csv",
  "columns": [
    { "key": "product_name", "label": "Product name" },
    { "key": "sku", "label": "SKU" },
    { "key": "dispatched", "label": "Dispatched" },
    { "key": "returned", "label": "Returned" },
    { "key": "net", "label": "Net sold" }
  ],
  "rows": [
    {
      "product_name": "TRS Chana Dal",
      "sku": "RF-04433",
      "dispatched": 20,
      "returned": 2,
      "net": 18
    },
    {
      "product_name": "TRS Moong Dal",
      "sku": "RF-04436",
      "dispatched": 10,
      "returned": 2,
      "net": 8
    }
  ],
  "totals": {
    "packSizes": 2,
    "products": 2,
    "dispatched": 30,
    "returned": 4,
    "net": 26,
    "adjusted": { "dispatched": 0, "returned": 0 }
  }
}
```

The rows are the rows of the report under the same filters, so the file always matches the screen. `fileName` follows the dates: `…_all-dates.csv`, `…_2026-11-17.csv` (one day), `…_from_2026-11-01.csv`, `…_until_2026-11-17.csv`. The labels are the suggested ones; the panel may write its own in the header line.

### 3.6 Adjustments by hand

For what the orders cannot know: units handed over outside the shop, a count that was wrong. An adjustment changes **the report only**: no order, no return, no stock.

`POST /v1/admin/fulfilment-tracker/adjustments` (`orders.manage`):

```json
{
  "variantId": "66f4…",
  "dispatched": 2,
  "returned": 1,
  "reason": "Two bags sold at the market stall, one came back",
  "date": "2026-11-17"
}
```

| Field        | Rule                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `variantId`  | A pack size of the catalogue, or one that an order names. `404 PRODUCT_VARIANT_NOT_FOUND` otherwise. |
| `dispatched` | Whole units to **add** to the dispatched figure; negative takes units off. Optional.                 |
| `returned`   | Whole units to **add** to the returned figure; negative takes units off. Optional.                   |
| `reason`     | Required, 5 to 500 characters.                                                                       |
| `date`       | The day the adjustment counts for, `YYYY-MM-DD`, today or earlier. Left out: today.                  |

`net` has no field: it is always `dispatched − returned`. To lower "Net sold" without touching "Dispatched", add returned units; to raise both, add dispatched units.

Answers `201`:

```json
{
  "adjustment": {
    "id": "6b01…",
    "productId": "66f3…",
    "variantId": "66f4…",
    "sku": "RF-04433",
    "name": { "en": "TRS Chana Dal" },
    "packSize": { "value": 1, "unit": "kg", "label": "1 kg" },
    "date": "2026-11-17",
    "dispatched": 2,
    "returned": 1,
    "net": 1,
    "reason": "Two bags sold at the market stall, one came back",
    "before": { "dispatched": 20, "returned": 2, "net": 18 },
    "after": { "dispatched": 22, "returned": 3, "net": 19 },
    "admin": { "id": "66a0…", "name": "Vrushabh" },
    "createdAt": "2026-11-17T13:05:00.000Z"
  },
  "totals": { "dispatched": 22, "returned": 3, "net": 19 }
}
```

`before`, `after` and `totals` are the figures of the pack size **over all dates**.

Refused with `409 FULFILMENT_ADJUSTMENT_INVALID` (`details.current` has the figures over all dates) when:

- both `dispatched` and `returned` are 0 or left out;
- the dispatched or the returned figure would fall below 0;
- more units would be returned than dispatched.

`400 VALIDATION_FAILED` for a missing or short reason, a number that is not whole, a date in the future.

**The audit history.** `GET /v1/admin/fulfilment-tracker/adjustments` (`orders.read`), query `variantId` (optional), `page`, `limit`: a page `{ items, page, limit, total, totalPages }` of adjustments, newest first, each as above with who made it and when. An adjustment is never changed or deleted. A wrong one is taken back by a second adjustment with the opposite numbers; both stay in the history.

## 4. What the tracker does not do

- It does not change stock. Stock follows orders, corrections and returns as before (`doc/CSV_IMPORT_EXPORT.md`, the stock history of a pack size).
- It does not show money. Revenue, costs and profit are in the analytics tab and in "Cost & profit" of an order.
- It does not count wholesale quotations: only orders of the retail shop.
- A unit corrected away as "damaged" after delivery lowers `dispatched` like one that was missing: both are corrections of the delivered quantity. The dialog shows them; if such units shall count as dispatched, add them with an adjustment.

## 5. Screens for the admin panel

1. **Navigation.** An entry "Fulfilment & Returns" directly below "Orders", shown with `orders.read`.
2. **The report page.**
   - Above the table: the period, and four figures from `totals`: Dispatched, Returned, Net sold, Pack sizes.
   - Filters: a date range (presets: today, yesterday, last 7 days, this month, last month, all dates, custom), a search field (`q`), a brand multi-select fed by `/brands`, and, when the page is opened for one product, that product. Every filter changes table, totals and export together. Keep the filters in the address of the page.
   - Table columns: Product (name, with the German name below when it differs), Brand, SKU, Pack size, Dispatched, Returned, Net sold, Actions. Sort by clicking the headers (`sort`). Pages of 25.
   - A row whose `adjusted` is not zero shows a small mark "adjusted" with the two numbers on hover. A row with `inCatalogue: false` shows "no longer in the catalogue" and no link to the product.
   - A negative Net sold (possible only with a date range) is shown as it is, with the hint "More units came back in this period than left in it."
   - Empty: "Nothing was dispatched or returned in this period." Loading and error states as in the other lists, with "Try again".
3. **View orders** (a dialog per row). Header: product, SKU, pack size, the three figures of the period. A table of `orders.items`: order number (link), placed, dispatched, status, ordered, dispatched, returned. Below an order with returns or corrections: its returns (number as link, status, requested, accepted, completed, "counts" or "does not count yet") and its corrections. A line under the table when adjustments exist: "Orders: 4 dispatched, 1 returned. Adjustments: +2 dispatched, +1 returned." and the list of `adjustments`. Pages inside the dialog.
4. **Adjust** (a dialog per row, with `orders.manage`). Shows the figures over all dates, two number fields ("Dispatched: add or remove units", "Returned: add or remove units"), the date, the reason, and a live line "Dispatched 20 → 22, Returned 2 → 3, Net sold 18 → 19". Net sold has no field; say why in one sentence. After saving, reload the report. Below the form: the history of the pack size.
5. **Adjustment history** (a link on the page): all adjustments, newest first: date, product, change, before and after, reason, who, when.
6. **Export** (a dialog). Columns as a checklist in the order of section 3.5 with the usual seven ticked; brands (all, or chosen ones); dates (taken from the page, changeable); a line "N rows will be exported" from `totals.packSizes`. "Export CSV" calls `/export` with the filters and `columns`, and writes `rows` under `columns[].label` into `fileName`.

## 6. Where it lives

- Module `src/modules/fulfilment-tracker/`: `tracker-report.ts` (the rules as plain functions, with tests), `fulfilment-tracker.service.ts` (the counting), the controller, the request classes.
- One new collection, `fulfilmentAdjustments`, with two small indexes: run `npm run db:indexes` after the deployment. The report works without them.
- Reads `orders`, `returns` and `products` through their schemas; writes to none of them.
- Tests: `tracker-report.spec.ts`, `test/fulfilment-tracker.e2e-spec.ts`.
