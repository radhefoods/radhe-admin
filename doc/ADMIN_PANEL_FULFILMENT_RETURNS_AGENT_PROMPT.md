# Prompt for the admin panel agent: the "Fulfilment & Returns" tracker

Copy everything below the line into the agent that works on the admin panel (`radhe-admin`).

---

You are working on the Radhe Foods admin panel (`radhe-admin`, Next.js). The API has a new report: for every pack size (SKU), how many units were dispatched to customers, how many were returned, and how many stay sold. Build the page for it: a table with filters, a dialog that shows the orders behind a row, a CSV export with chosen columns, and adjustments by hand with their history.

**Read first:** `doc/FULFILMENT_RETURNS.md` in the `radhe-api` repository (the sibling folder `../radhe-api`), all of it, and section 33 of `doc/ADMIN_API_DOCUMENTATION.md` there. They hold the complete contract, with an example of every answer. This prompt repeats what you need most; where the two differ, the documents are right. If you cannot read that repository, ask for the files. All calls use the existing admin session and API client.

**Do not change the theme, colours, fonts, typography or any unrelated functionality.** Reuse what the panel has: `src/components/data/` (`data-table.tsx`, `filter-bar.tsx`, `pagination.tsx`), `src/components/ui/` (`dialog.tsx`, `badge.tsx`, `button.tsx`, `input.tsx`, `menu.tsx`), `src/components/form/` (`fields.tsx`, `reason-field.tsx`), the status badges of orders and returns in `src/components/domain/status-badge.tsx`, the date range picker of the analytics tab (`src/features/analytics/range-picker.tsx`, `range.ts`), and the CSV writer `saveCsv` in `src/features/catalogue/sheets.ts` (it guards cells that a spreadsheet would run as a formula and writes the byte order mark Excel needs).

## Names

| Where               | Label                    | API field    |
| ------------------- | ------------------------ | ------------ |
| Menu entry and page | **Fulfilment & Returns** |              |
| Column              | **Dispatched**           | `dispatched` |
| Column              | **Returned**             | `returned`   |
| Column              | **Net sold**             | `net`        |
| Row action          | **View orders**          |              |
| Row action          | **Adjust**               |              |

Keep the three column labels in one place (a constant), so that the owner can rename them later, for example to "Fulfilment", "Returns" and "Radhe Foods".

## What the figures mean

- One row is one **pack size**. Two pack sizes of a product are two rows.
- **Dispatched**: the delivered units of orders that are dispatched, delivered or returned, counted for the day of dispatch. Cancelled orders and orders that wait count nothing.
- **Returned**: the accepted units of returns that are **completed**, counted for the day they were completed.
- **Net sold** = Dispatched − Returned. It is never edited by itself.
- A return never lowers Dispatched. It raises Returned and lowers Net sold.
- With a date range, Net sold of a row can be negative: a unit came back in the period from an order that left before it. Show it as it is.
- Every figure includes adjustments made by hand; `adjusted` says how much.

**Never add figures up in the panel.** Totals come from `totals` of the API; the export comes from the export endpoint, not from the rows on the screen.

## The API

Base: `/v1/admin/fulfilment-tracker`. Permissions: `orders.read` to see everything, `orders.manage` to adjust. No new permission, nothing to add to the roles screen.

| Call                        | Use                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /`                     | The report: `{ range, totals, items, page, limit, total, totalPages }`                     |
| `GET /brands`               | `{ range, items: [{ brand, packSizes, dispatched, returned, net }] }` for the brand filter |
| `GET /variants/{variantId}` | `{ range, row, fromOrders, orders: { items, page, … }, adjustments }` for the dialog       |
| `GET /export`               | `{ range, fileName, columns: [{ key, label }], rows, totals }`: every row, chosen columns  |
| `GET /adjustments`          | A page of adjustments, newest first; `?variantId=` for one pack size                       |
| `POST /adjustments`         | `{ variantId, dispatched?, returned?, reason, date? }` → `201 { adjustment, totals }`      |

Filters of the report, the brands and the export (all optional): `from`, `to` (`YYYY-MM-DD`, days of Europe/Berlin, both included; neither means all dates), `q` (2 to 80 characters), `brand` (repeat the parameter for several), `productId`, `variantId`, `sort` (`name`, `brand`, `sku`, `dispatched`, `returned`, `net`, with `:asc` or `:desc`; default `dispatched:desc`). The report also takes `page` and `limit` (default 25, at most 100); the dialog takes `from`, `to`, `page`, `limit`.

A row: `productId`, `variantId`, `sku`, `name { en, de? }`, `brand` (or `null`), `packSize { value, unit, label }`, `dispatched`, `returned`, `net`, `orders`, `returns`, `adjusted { dispatched, returned }`, `inCatalogue`.

Errors to give a text of their own in `src/lib/api/error-text.ts` (an unknown code shows as a generic server error today):

- `FULFILMENT_ADJUSTMENT_INVALID` (409): show the message of the API; it names the reason. `details.current` has the figures over all dates.
- `PRODUCT_VARIANT_NOT_FOUND` (404) on the dialog: "This pack size no longer exists."

## Where to change the panel

| File or place                                                        | Change                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/routes.ts`                                                  | `fulfilment: "/fulfilment"`.                                                                                                                                                                                                                  |
| `src/components/shell/nav.ts`                                        | An entry "Fulfilment & Returns" **directly below "Orders"** in the group that holds Orders; `requires: "orders.read"`; an icon that fits (for example `PackageCheck`); keywords "dispatched shipped returns units sold sku brand export csv". |
| `src/lib/api/types/` (new `fulfilment.ts`, exported from `index.ts`) | Types of the answers, taken from the examples in `doc/FULFILMENT_RETURNS.md`.                                                                                                                                                                 |
| `src/lib/api/endpoints/` (new `fulfilment.ts`), `query-keys.ts`      | The six calls.                                                                                                                                                                                                                                |
| `src/lib/api/error-text.ts`, `errors.ts`                             | The two error codes above.                                                                                                                                                                                                                    |
| `src/app/(panel)/fulfilment/page.tsx`, `src/features/fulfilment/`    | The page and its parts.                                                                                                                                                                                                                       |
| `mocks/`                                                             | The mock API: rows computed from the mock orders and returns, the same shapes.                                                                                                                                                                |
| Tests next to the feature                                            | The table with filters, the dialog, the export call and the adjustment form.                                                                                                                                                                  |

## Step 1: the report page

1. **Header**: the title, the period in words ("1 to 17 November 2026", or "All dates"), and the buttons "Export CSV" and "Adjustment history".
2. **Four figures** from `totals`: Dispatched, Returned, Net sold, Pack sizes (`packSizes`, with "in N products" from `products`).
3. **Filters** in the filter bar:
   - a date range with the presets Today, Yesterday, Last 7 days, This month, Last month, **All dates** (the default) and Custom; send `from` and `to` as days;
   - a search field for product name or SKU (`q`, sent after a short pause, from two characters);
   - a brand multi-select with a search inside it, filled from `/brands` called with the same dates and `q`; each option shows its number of pack sizes; "No brand" is not selectable in this version (`brand: null` rows appear when no brand is chosen);
   - "Clear filters".
     Keep all filters, the sort and the page in the address of the page, so that a filtered report can be opened again and shared. A change of a filter goes back to page 1.
4. **Table**: Product (the English name; the German name small below it when there is one and it differs; a link to the product in the catalogue when `inCatalogue`), Brand, SKU, Pack size (`packSize.label`), Dispatched, Returned, Net sold, Actions. Numbers right-aligned in tabular figures. The headers of Product, Brand, SKU and the three figures sort (`sort`).
   - `adjusted` not zero: a small mark "adjusted" next to the figures; on hover "+2 dispatched, +1 returned by hand".
   - `inCatalogue: false`: a small note "no longer in the catalogue".
   - Net sold below zero: shown as it is, with the hint "More units came back in this period than left in it."
   - Actions: "View orders" for everyone; "Adjust" only with `orders.manage`.
5. **Pagination** as in the other lists, 25 per page.
6. **States**: a skeleton while loading; "Nothing was dispatched or returned in this period." with "Clear filters" when filters are set; the panel's error block with "Try again".

## Step 2: the dialog "View orders"

Opens for one row and loads `GET /variants/{variantId}` with the dates of the page.

1. **Header**: product, SKU, pack size, brand; the three figures of `row` for the period; the period in words.
2. **Orders**, a table of `orders.items`: Order (the number as a link to the order page, `orderId`), Customer (`customerName`), Placed, Dispatched on, Status (the order status badge), Ordered (`orderedQuantity`), Dispatched (`dispatched`), Returned (`returned`).
   - Mark what an order contributed: a "dispatched" tag when `dispatched > 0`, a "returned" tag when `returned > 0`. An order with `dispatched: 0` and a return was dispatched before the period: say "dispatched before this period".
   - When `orderedQuantity` differs from `deliveredQuantity`, show "3 ordered, 2 delivered" and the `corrections` (reason and date) under the row.
   - Under an order with `returns`: one line per return with its number (a link to the return page, `id`), the return status badge, "2 requested, 1 accepted", the completed date, "restocked" when `restocked`, and "counts: 1" or "does not count yet" from `countedQuantity`.
3. **A line that explains the sum** when `adjustments` is not empty: "Orders: 4 dispatched, 1 returned. Adjustments: +2 dispatched, +1 returned." (`fromOrders`, and `row` minus `fromOrders`), then the adjustments: date, change, reason, who.
4. Pages inside the dialog (`orders.page`, `orders.totalPages`). Empty: "No orders in this period."

## Step 3: the export

A dialog "Export CSV":

1. **Columns**: a checklist of the fourteen keys of `doc/FULFILMENT_RETURNS.md` section 3.5 with their labels, the usual seven ticked. "Select all" and "Reset". The order of the file is the order of the list.
2. **Brands**: "All brands", or the multi-select of step 1, preset with the brands of the page.
3. **Dates**: preset with the dates of the page, changeable here: one day, a range, or all dates.
4. The search and the product filter of the page are carried over and shown as a note ("Search: dal").
5. A line "N rows will be exported" (`totals.packSizes` of a report call with these filters and `limit=1`).
6. "Export CSV" calls `GET /export` with the filters and `columns=a,b,c`, then writes the file with `saveCsv(fileName, labels, rows)`: the header line from `columns[].label` (use the labels of the panel for the three figures), the cells from `rows` by `columns[].key`, numbers as they are. Never build the file from the rows on the screen: the endpoint answers every row under the filters, and the figures then match the report by construction.
7. Without rows, say so and write no file.

## Step 4: adjusting by hand

**"Adjust"** on a row, only with `orders.manage`:

1. Load the figures **over all dates** for the pack size (`GET /?variantId=…` without dates) and show them: Dispatched, Returned, Net sold.
2. Two whole-number fields that may be negative: "Dispatched: add or remove units" and "Returned: add or remove units", each with − and + buttons. A date (default today, not in the future). A reason (required, 5 to 500 characters; use the panel's reason field).
3. A live line under the fields: "Dispatched 20 → 22 · Returned 2 → 3 · Net sold 18 → 19". Check before sending what the API refuses anyway: both fields 0; a figure below 0; more returned than dispatched.
4. One sentence: "Net sold is always Dispatched minus Returned. To lower it without changing Dispatched, add returned units."
5. And one more: "This changes the report only. Orders, returns and stock stay as they are."
6. Send `POST /adjustments`. On success: a toast, close, reload the report, the brands and an open dialog. On `409 FULFILMENT_ADJUSTMENT_INVALID`: the message of the API under the form.
7. Below the form: the history of this pack size (`GET /adjustments?variantId=…`).

**"Adjustment history"** on the page: a dialog or a sub-page with all adjustments, newest first: counts for (date), product with SKU and pack size, change ("+2 dispatched, +1 returned"), before → after, reason, who (`admin.name`), when. Pages of 25. There is no edit and no delete: an entry is taken back by a second adjustment with the opposite numbers. Offer "Take back" on an entry (with `orders.manage`): it opens the form with the opposite numbers and the reason prefilled "Takes back the adjustment of …".

## How to work

Write your plan first and wait for my go before coding. Then do step 1, run the panel's lint, type check and tests, and report. Wait for my go, then do steps 2 to 4 the same way, one at a time.
