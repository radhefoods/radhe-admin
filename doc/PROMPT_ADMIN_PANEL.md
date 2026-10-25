# Migration brief: Radhe Foods admin panel (`radhe-admin`)

You are the engineer of the existing Next.js admin panel in this folder. Its backend, `radhe-api`, changed on 2026-10-16 from a pre-order platform to a standard online shop: products are sold from stock, customers pay at checkout on a Stripe page, and the payment confirms the order. Your job is to adapt the panel to the new backend. The owner (Vrushabh) decides; when something is unclear, ask him before you build. Never assume what the API does: read it in the API documentation or ask.

---

## 1. The rule above all others: the design stays

Do not change the theme, colours, fonts, typography, spacing, layouts, components, animations or the visual identity of the panel. Reuse the existing components and patterns for everything new: the data table, the filter bar, the status badge with its six tones, the confirm dialog that restates the real numbers, the form fields, the action button that is disabled without permission. What you change is functionality, business logic, API integration and the minimal UI adjustments the new model forces:

- pages and controls that only existed for the old model are removed (cargos, payment activation, cash, waiving, reminders, pay links, ordering decisions per customer);
- texts that describe the old model are rewritten in the same place;
- what the new model adds (pack sizes with their own prices and stock inside the product form, the refund decision, the restock switch on a return, an order waiting for its payment) is built with existing components, inside existing pages where a natural place exists.

---

## 2. What changed

| | Until now (pre-order) | Now (shop) |
|---|---|---|
| Orders | Collected per cargo; confirmed without payment; moved between cargos; delivered per cargo | Created by the customer at checkout and confirmed by the payment; the admin never confirms by hand and never moves an order |
| Payment | Activated by the admin after delivery; deadline, reminders, pay links, cash, waiving, overdue customers | Paid at checkout through Stripe. The admin records no payment. The admin decides **refunds**: through Stripe or by hand |
| Order statuses | `confirmed`, `preparing`, `dispatched`, `delivered`, `delivery_failed`, `cancelled`, `returned` | `pending_payment`, `confirmed`, `processing`, `dispatched`, `delivered`, `cancelled`, `returned` |
| Payment statuses | `not_enabled`, `due`, `overdue`, `paid`, `waived`, `refunded`; methods `stripe`, `cash`, `credit` | `pending`, `authorized`, `paid`, `failed`, `refunded`; Stripe payment type `card` or `paypal` |
| Products | One product document per pack size, linked by `variantGroupId`; `make-default` chose the size shown in lists | One product with all its pack sizes in `variants[]`, each with its own article number, prices, enabled switch and stock; the default size is computed by the API (the smallest enabled one in stock) |
| Stock | Per cargo, with limits per cargo product | Per pack size: `stock { quantity, lowStockThreshold, isLow }` on every entry of `variants`, a movement ledger per pack size, a low-stock filter, CSV columns |
| Customers | Ordering decisions (block, allow, overdue) | Status only (active, blocked) |
| Settings | Payment deadline days, reminder hour, cargo defaults | `payments.checkoutMinutes` (how long a Stripe page stays open), `delivery.defaultMethod` and `delivery.estimate { en, de }` |
| Legal texts | `terms`, `preorder_terms`, `privacy` | `terms`, `privacy` |
| Notifications | Including `order_moved`, `delivery_rescheduled`, `delivery_failed`, `payment_request`, `payment_reminder` | `order_confirmed`, `order_cancelled`, `order_dispatched`, `order_delivered`, `return_*`, `payment_failed`, `refund_completed`, `announcement` (section 13.1) |
| Permissions | Included the `cargos` resource | No `cargos` resource (section 17.1) |

Unchanged: sign-in with password and authenticator, forced password change, admin users and roles, categories, product texts and images, CSV import and export (with the row rules of 4.3), returns (plus the restock switch), refunds, invoices and credit notes, notifications log, announcements (without the cargo field), legal texts, company and delivery-fee settings, the return window, the cancellation rule.

---

## 3. Files to read, in this order

| File | What to read |
|---|---|
| This brief | All of it |
| `ARCHITECTURE.md` | Sections 1, 2, 4 (modules), 6 (status models), 7 (key flows), 8 (authentication) |
| `ADMIN_API_DOCUMENTATION.md` | **The authority.** Section 0; sections 4 to 15 and 20 completely; section 17 (enums, state machines, permission matrix, error codes); sections 1 to 3 as a check that nothing changed there |
| `BANNERS.md` | The homepage banners page: upload, replace, link, switch, period, drag-and-drop order (2026-10-19) |
| `CSV_IMPORT_EXPORT.md` and `examples/*.csv` | The catalogue sheet: one row per pack size, the rows of a product tied by `slug_en`, the stock columns |

These files come from `radhe-api/doc/` and replace the copies under `doc/` of this repository, which describe the old API. Delete `doc/Radhe_Foods_Preorder.md`, `doc/Radhe_Foods_Preorder_Core_Concept.md` and the old `doc/PROMPT_ADMIN_PANEL.md`; put this brief in their place.

Rule: **where any other text (this brief, README, CONTRIBUTING, DECISIONS, code comments) and the API documentation differ, the API documentation is right.** Do not invent endpoints, fields, statuses, transitions, permissions or error codes. Where the API lacks something you need, record it under "What the API cannot do" and ask the owner.

---

## 4. API changes

### 4.1 Removed endpoints

Delete their client functions, types, query keys, hooks, mocks, tests and every caller:

- Everything under `/v1/admin/cargos` (list, overview, create, detail, update, delete, open, close, status, check, rollover, cargo products with copy, cargo orders status, delivery method and move, payments activate and summary).
- `GET /v1/admin/customers/{id}/ordering`, `POST /v1/admin/customers/{id}/ordering`.
- `POST /v1/admin/orders/{id}/move`, `POST /v1/admin/orders/{id}/payment/activate`, `…/payment/cash`, `…/payment/waive`, `…/payment/remind`, `PATCH …/payment/reminders`.
- `GET /v1/admin/orders/summary`, `POST /v1/admin/payments/run-jobs`.
- `POST /v1/admin/products/{id}/make-default` and `GET /v1/admin/products/{id}/price-history`: the default pack size is computed by the API now, and the price history is per pack size (section 4.2). The product fields `variantGroupId`, `isDefaultVariant`, `packSizes`, `packSizeCount` and `variantOf` are gone, and so is the list filter `variantGroupId`.

### 4.2 New endpoints

- `POST /v1/admin/products/{id}/variants`, `PATCH …/variants/{variantId}`, `DELETE …/variants/{variantId}` (section 8): add, change and remove a pack size of a product; each answers the whole `{ product }`. Errors `400 PRODUCT_VARIANT_INVALID` (another unit family, a pack twice, more than 20 sizes), `404 PRODUCT_VARIANT_NOT_FOUND`, `409 PRODUCT_VARIANT_LAST`, `409 PRODUCT_VARIANT_IN_USE` (disable the size instead), plus `PRODUCT_SKU_TAKEN`, `PRODUCT_SLUG_TAKEN`, `PRODUCT_PRICE_INVALID`.
- `GET …/variants/{variantId}/price-history` (section 8): the prices one pack size had, newest first.
- `POST …/variants/{variantId}/stock` (section 8): `{ quantity, note? }` sets the counted number of one pack size, `{ delta, note? }` adds or removes units; one of the two. Errors `400 STOCK_CHANGE_INVALID`, `409 STOCK_INSUFFICIENT` (with `variantId`, `sku`, `available` and `wanted`).
- `GET …/variants/{variantId}/stock/movements` (section 8): the ledger of one pack size, newest first, cursor paged; every movement carries `variantId` and `sku`.

### 4.3 Changed answers and bodies

Re-read these sections and update `src/lib/api/types/*.ts` to match them exactly:

- Products (8): one product carries its pack sizes in `variants[]` (each with `id`, `sku`, `gtin`, `packSize`, `slug`, `displayName`, `pricing`, `isEnabled`, `isDefault`, `stock { quantity, lowStockThreshold, isLow }`, `createdAt`), plus `slug` (the base of the URLs), `vatRate`, `priceFrom`, `defaultVariant`, `variantCount` and `stock { quantity, lowVariants, isLow }` (the sum over the sizes and the number of low ones). No `sku`, `gtin`, `packSize`, `pricing` or `stock` on the product itself. `POST /products` takes `variants[]` (1 to 20, each with `packSize` and `regularPrice`, optionally `sku`, `gtin`, `salePrice` or `discountPercent`, `isEnabled`, `stockQuantity`, `lowStockThreshold`); `PATCH /products/{id}` takes product fields only; the sizes change through the endpoints of 4.2. The duplicate body is `{ slug?, variants?, copyImages? }`. List filters `status`, `categoryId`, `q`, `isAvailable`, `onSale`, `lowStock=true` (a size at or below its threshold); sort `sku` by the smallest article number, `price_asc`/`price_desc` by `priceFrom`. CSV (8.2): one row per pack size; the rows of one product share `slug_en` and the product columns are read from the first of them; `variant_enabled` (yes/no) is new, `variant_of_sku` is gone; every product row result carries `variantId` next to `id`.
- Orders (9): the statuses of section 2; no `cargo`, `promisedStart`/`promisedEnd`, `canMove` or `type`; `allowedStatuses` and `canCancel` on the detail; `payment.needsRefund`; list filters `status`, `paymentStatus`, `customerId`, `email`, `orderNumber`, `deliveryMethod`, `needsRefund`, `q`, `sort`; `POST …/status` takes `status`, `trackingNumber?`, `note?`; the bulk endpoints take `processing`, `dispatched` or `delivered` and answer every order in `results` with `changed` and `reason`; `items[]` and `adjustments[]` carry `variantId` (items also `displayName`), and the delivered-quantity correction is `PATCH …/items/{variantId}`.
- Payments and refunds (11): the payment block of an order, `refundable { maximum, suggested, stripePossible }` from `GET /v1/admin/orders/{id}/payment`, the refund body `{ amount, reason, method: stripe | manual, manual: { way, reference? } }` as documented.
- Returns (10): the items carry `variantId`; `POST …/approve` takes `items: [{ variantId, quantity }]`; `POST …/complete` takes `restock?: boolean`; the return carries `restockedAt`.
- Customers (4): no ordering override or history, no overdue list.
- Settings (5): `payments { checkoutMinutes }` only; `delivery { defaultMethod, estimate { en, de } }`; `integrations { stripeConnected, whatsappConfigured }` and `company.missingForInvoices` stay.
- Legal (6): types `terms` and `privacy`.
- Notifications (13) and announcements (14): the types of section 13.1; no cargo on either.
- Attention (15): `orders.toProcess`, `refunds { needed, orders, pending, failed, items }`, `returns.requested`, `stock { low, items }` (product summaries with `variants`), `notifications { failed, queued, items }`.
- Error codes (17.3): remove the cargo and old payment codes with their texts; add `PRODUCT_VARIANT_NOT_FOUND`, `PRODUCT_VARIANT_LAST` and `PRODUCT_VARIANT_IN_USE`.

---

## 5. What to do, by area

### 5.1 Remove

- The cargo pages, features, endpoints, types, query keys, mocks and tests; the "Cargos" navigation item; the cargo pill in the top bar; the cargo search in the command palette; the `cargos` resource in the permission helper and its labels.
- On orders: the move dialog, the payment actions activate, cash, waive, pause reminders, remind now and the pay link; the delivery-window history, the promised days, the `delivery_failed` alert and transition; the cargo column and filter of the list; the pre-order copy.
- On customers: the ordering decision dialog, the ordering badge, the overdue list, their schemas and queries.
- On the start page: overdue payments, failed deliveries, collecting cargos.
- In settings: deadline days, reminder hour, the pay-link copy, the per-cargo copy, the "payment cannot be activated" notice.
- On the sign-in layout: the pre-order marketing copy.
- In announcements and notifications: the cargo field and the related-cargo row.
- In the catalogue: the "part of a cargo" copy.

### 5.2 Orders

- List: the filters of section 4.3, with `needsRefund` as a filter chip; the status badge tones for the new statuses (`pending_payment` is neutral: it waits for the customer; `confirmed` is the one that needs work: paid and not yet in processing).
- Detail: status buttons from `allowedStatuses` only, with the new names; a `pending_payment` order has no status button ("the payment confirms it"); dispatching asks for the tracking number in the existing dialog; the delivery card keeps method and tracking number (`PATCH …/delivery`); cancel with the admin reasons of section 17; the delivered-quantity correction stays.
- Bulk: the existing bulk bar with `processing`, `dispatched`, `delivered` and the delivery method; show every order's `changed` and `reason` from `results`, never a bare success.
- The payment card shows the payment block (status, method and type, receipt, paid, credited, refunded amounts, attempts, last failure) and, when `needsRefund`, the refund decision: `refundable.suggested` restated in the existing confirm dialog, then the existing create-refund dialog (Stripe or manual).

### 5.3 Payments page

Group by the new payment statuses and add the group "waiting for a refund" (`needsRefund=true`). Remove "not invoiced", overdue and waived. The refunds and invoices pages stay; the invoice no longer has a deadline.

### 5.4 Returns

Add the restock switch to the complete dialog (`restock`, off by default: food that came back is not sold again unless the admin says so) and show `restockedAt` on the return. Remove the `not_enabled` payment check.

### 5.5 Products and stock

- One product form: the shared fields (name, base slug, texts, brand, category, VAT rate, status, switches, sort order, order quantities, storage type, food information, tags, keywords, SEO, images) and a **pack-size table** with one row per entry of `variants`: article number (generated when left empty), barcode, pack (value and unit), regular price, sale price or discount, the enabled switch, the low-stock threshold and the stock count. A new product sends the rows in `variants[]` of `POST /products`. An existing product sends its fields to `PATCH /products/{id}` and each row to `POST …/variants` (added), `PATCH …/variants/{variantId}` (changed) or `DELETE …/variants/{variantId}` (removed); every answer is the whole product, so re-render from it. The URL of a size (`variants[].slug`) follows from the base slug and the pack: show it read-only.
- Rules the form checks before the API refuses: all sizes in one unit family (weight, volume or pieces), no pack twice, 1 to 20 sizes. The last size cannot be removed, and neither can a size an order holds (`409 PRODUCT_VARIANT_LAST`, `409 PRODUCT_VARIANT_IN_USE`): offer "disable" (`isEnabled: false`) instead of "remove" in those cases.
- Stock per size: the count and the threshold in the row; "set the counted number" and "add or remove units" with a note (one dialog, two modes, built from existing components) call `POST …/variants/{variantId}/stock`; the ledger per size (`GET …/variants/{variantId}/stock/movements`) as a cursor list (reason, delta, quantity after, order number, admin, note, time). The opening stock of a new size goes in `stockQuantity` of its row; afterwards only the stock dialog and the CSV import change the count. The price history is per size as well (`GET …/variants/{variantId}/price-history`).
- Lists: one row per product, shown as `defaultVariant` (the smallest enabled size in stock, chosen by the API; there is nothing to set by hand) with `priceFrom`, `variantCount` and `stock { quantity, lowVariants, isLow }` with the low-stock state; the `lowStock=true` filter chip. The `q` search finds every article number of a product.
- CSV import and export: one row per pack size; the rows of one product share `slug_en` and the product columns come from the first of them; the column `variant_enabled` (yes/no) is new and `variant_of_sku` is gone; the two stock columns stay. Show `variantId` of a row result next to `id` where the panel shows what a row matched.
- Order corrections (`PATCH /orders/{id}/items/{variantId}`) and return decisions (`items[].variantId` of `POST /returns/{id}/approve`) are per pack size: key them by `variantId` of the order or return item, never by `productId`.
- The start page gets the "stock running low" group of the attention answer; its items are product summaries, and `variants[].stock.isLow` names the sizes that run low.

### 5.6 Customers, settings, legal, communication

- Customers: status (active, blocked) with reason only.
- Settings: the payments tab keeps `checkoutMinutes` only; the delivery form gets the estimate in both languages next to the default method; the other tabs stay.
- Legal: types `terms` and `privacy`; the reminder that both must be published before anyone can order.
- Notifications and announcements: the type list of section 13.1; no cargo anywhere.
- Today: the groups of the attention answer (orders to process, refunds needed, pending and failed, returns requested, stock low, notifications failed and queued), each linking to the filtered list.

### 5.7 Permissions

Resources are `admin_users`, `roles`, `customers`, `catalog`, `orders`, `settings`, `legal`, `payments`, `notifications`, each with `.read` and `.manage`, plus wildcards (section 17.1). Stock belongs to `catalog`; refunds to `payments`; returns and the order status to `orders`. Update the permission helper, the role matrix and their tests.

### 5.8 Mocks and tests

`mocks/`: remove the cargo, ordering, activation, cash, waiving and reminder modules; add products with `variants`, the pack-size endpoints, stock per pack size (set, adjust, ledger, `STOCK_INSUFFICIENT`), the new order statuses and payment block, `needsRefund`, `refundable`, the return `restock`, the new settings and attention shapes. Update the component tests and the Playwright specs that cover the old flows (cargo and payments, auth with the cargo form, phone with mark delivered and cash, accessibility URLs); the new phone flow is: see the paid orders, mark processing, dispatch with the tracking number, mark delivered, decide a refund, correct the stock of a pack size.

### 5.9 Documentation of this repository

Update `README.md`, `CONTRIBUTING.md` (cargos is no longer the reference feature; take orders or stock) and `DECISIONS.md` (remove the per-cargo bulk and activation batch decisions; record the new ones; keep "What the API cannot do" current).

---

## 6. API facts you must respect

- Base URL `<NEXT_PUBLIC_API_URL>/v1`, JSON, errors as `{ error: { code, message, details? }, requestId }`. Unknown fields in a body are rejected (`400 VALIDATION_FAILED`); send only documented fields.
- Cookie authentication, `credentials: 'include'`, refresh once on `401 AUTH_TOKEN_INVALID`, the MFA steps, the forced password change: the existing session and sign-in code does this; keep it.
- Money is integer cents, VAT rates in hundredths of a percent; inputs show euros, the API gets cents.
- Statuses and transitions are the API's. An order answers `allowedStatuses`; the panel offers exactly those. Forward steps email the customer; one step back tells the customer nothing. No order is confirmed by hand.
- Nothing is reserved before the payment: the stock count of a pack size is what the shop sells of it. A pack size with quantity 0 is sold out in the shop; the other sizes of the product stay on sale.
- Every refund is a decision of a human, in the panel. A cancelled or credited paid order waits with `needsRefund: true` until the admin decides.
- Some features may be off on the server (Stripe, WhatsApp, incomplete company details): `GET /v1/admin/settings` says which; show the state, never hide the function.

---

## 7. How to work

1. Read the files of section 3 completely. Then write a short **plan**: every file you will remove, change or add, with the reason, the new type definitions, the permission changes, open questions, and anything the API cannot do. **Wait for the owner's go before editing.**
2. Build in phases, each ending with lint, type check and tests green and a short note of what was done and decided: types, client and permissions → removal of the cargo and old payment parts → orders, bulk and the payment card with the refund decision → products with their pack sizes and stock → returns, customers, settings, legal, communication, start page → mocks and tests → README, CONTRIBUTING, DECISIONS.
3. Do not commit to Git unless asked. No secrets in the panel; it has none.
4. When the owner gives an instruction, follow it. When you believe it harms the result, say so once with a better alternative, then do what he decides.
5. The design does not change. If a change you think necessary would alter the look, ask first.
