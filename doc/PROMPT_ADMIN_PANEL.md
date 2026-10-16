# Migration brief: Radhe Foods admin panel (`radhe-admin`)

You are the engineer of the existing Next.js admin panel in this folder. Its backend, `radhe-api`, changed on 2026-10-16 from a pre-order platform to a standard online shop: products are sold from stock, customers pay at checkout on a Stripe page, and the payment confirms the order. Your job is to adapt the panel to the new backend. The owner (Vrushabh) decides; when something is unclear, ask him before you build. Never assume what the API does: read it in the API documentation or ask.

---

## 1. The rule above all others: the design stays

Do not change the theme, colours, fonts, typography, spacing, layouts, components, animations or the visual identity of the panel. Reuse the existing components and patterns for everything new: the data table, the filter bar, the status badge with its six tones, the confirm dialog that restates the real numbers, the form fields, the action button that is disabled without permission. What you change is functionality, business logic, API integration and the minimal UI adjustments the new model forces:

- pages and controls that only existed for the old model are removed (cargos, payment activation, cash, waiving, reminders, pay links, ordering decisions per customer);
- texts that describe the old model are rewritten in the same place;
- what the new model adds (stock on products, the refund decision, the restock switch on a return, an order waiting for its payment) is built with existing components, inside existing pages where a natural place exists.

---

## 2. What changed

| | Until now (pre-order) | Now (shop) |
|---|---|---|
| Orders | Collected per cargo; confirmed without payment; moved between cargos; delivered per cargo | Created by the customer at checkout and confirmed by the payment; the admin never confirms by hand and never moves an order |
| Payment | Activated by the admin after delivery; deadline, reminders, pay links, cash, waiving, overdue customers | Paid at checkout through Stripe. The admin records no payment. The admin decides **refunds**: through Stripe or by hand |
| Order statuses | `confirmed`, `preparing`, `dispatched`, `delivered`, `delivery_failed`, `cancelled`, `returned` | `pending_payment`, `confirmed`, `processing`, `dispatched`, `delivered`, `cancelled`, `returned` |
| Payment statuses | `not_enabled`, `due`, `overdue`, `paid`, `waived`, `refunded`; methods `stripe`, `cash`, `credit` | `pending`, `authorized`, `paid`, `failed`, `refunded`; Stripe payment type `card` or `paypal` |
| Stock | Per cargo, with limits per cargo product | Per product: `stock { quantity, lowStockThreshold }`, a movement ledger, a low-stock filter, CSV columns |
| Customers | Ordering decisions (block, allow, overdue) | Status only (active, blocked) |
| Settings | Payment deadline days, reminder hour, cargo defaults | `payments.checkoutMinutes` (how long a Stripe page stays open), `delivery.defaultMethod` and `delivery.estimate { en, de }` |
| Legal texts | `terms`, `preorder_terms`, `privacy` | `terms`, `privacy` |
| Notifications | Including `order_moved`, `delivery_rescheduled`, `delivery_failed`, `payment_request`, `payment_reminder` | `order_confirmed`, `order_cancelled`, `order_dispatched`, `order_delivered`, `return_*`, `payment_failed`, `refund_completed`, `announcement` (section 13.1) |
| Permissions | Included the `cargos` resource | No `cargos` resource (section 17.1) |

Unchanged: sign-in with password and authenticator, forced password change, admin users and roles, categories, products with pack sizes, prices, images, CSV import and export (plus the two stock columns), returns (plus the restock switch), refunds, invoices and credit notes, notifications log, announcements (without the cargo field), legal texts, company and delivery-fee settings, the return window, the cancellation rule.

---

## 3. Files to read, in this order

| File | What to read |
|---|---|
| This brief | All of it |
| `ARCHITECTURE.md` | Sections 1, 2, 4 (modules), 6 (status models), 7 (key flows), 8 (authentication) |
| `ADMIN_API_DOCUMENTATION.md` | **The authority.** Section 0; sections 4 to 15 completely; section 17 (enums, state machines, permission matrix, error codes); sections 1 to 3 as a check that nothing changed there |
| `CSV_IMPORT_EXPORT.md` and `examples/*.csv` | The catalogue sheet with its stock columns |

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

### 4.2 New endpoints

- `POST /v1/admin/products/{id}/stock` (section 8): `{ quantity, note? }` sets the counted number, `{ delta, note? }` adds or removes units; one of the two. Errors `400 STOCK_CHANGE_INVALID`, `409 STOCK_INSUFFICIENT` (with `available` and `wanted`).
- `GET /v1/admin/products/{id}/stock/movements` (section 8): the ledger, newest first, cursor paged.

### 4.3 Changed answers and bodies

Re-read these sections and update `src/lib/api/types/*.ts` to match them exactly:

- Products (8): `stock { quantity, lowStockThreshold, isLow }` on summaries and details; `lowStockThreshold` is a field of the product form (`null` removes it); the count changes only through the stock endpoint and the CSV import. List filter `lowStock=true`. CSV columns `stock_quantity`, `low_stock_threshold`.
- Orders (9): the statuses of section 2; no `cargo`, `promisedStart`/`promisedEnd`, `canMove` or `type`; `allowedStatuses` and `canCancel` on the detail; `payment.needsRefund`; list filters `status`, `paymentStatus`, `customerId`, `email`, `orderNumber`, `deliveryMethod`, `needsRefund`, `q`, `sort`; `POST …/status` takes `status`, `trackingNumber?`, `note?`; the bulk endpoints take `processing`, `dispatched` or `delivered` and answer every order in `results` with `changed` and `reason`.
- Payments and refunds (11): the payment block of an order, `refundable { maximum, suggested, stripePossible }` from `GET /v1/admin/orders/{id}/payment`, the refund body `{ amount, reason, method: stripe | manual, manual: { way, reference? } }` as documented.
- Returns (10): `POST …/complete` takes `restock?: boolean`; the return carries `restockedAt`.
- Customers (4): no ordering override or history, no overdue list.
- Settings (5): `payments { checkoutMinutes }` only; `delivery { defaultMethod, estimate { en, de } }`; `integrations { stripeConnected, whatsappConfigured }` and `company.missingForInvoices` stay.
- Legal (6): types `terms` and `privacy`.
- Notifications (13) and announcements (14): the types of section 13.1; no cargo on either.
- Attention (15): `orders.toProcess`, `refunds { needed, orders, pending, failed, items }`, `returns.requested`, `stock { low, items }`, `notifications { failed, queued, items }`.
- Error codes (17.3): remove the cargo and old payment codes with their texts.

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

- The product form gets the low-stock threshold where the API accepts it.
- The product detail gets a stock panel built from existing components: the count and the threshold, "set the counted number" and "add or remove units" with a note (one dialog, two modes), the movement ledger as a cursor list (reason, delta, quantity after, order number, admin, note, time).
- The product list shows the stock count with the low-stock state and gets the `lowStock=true` filter chip.
- CSV import and export: the two stock columns in the sheet handling and the templates.
- The start page gets the "stock running low" group of the attention answer.

### 5.6 Customers, settings, legal, communication

- Customers: status (active, blocked) with reason only.
- Settings: the payments tab keeps `checkoutMinutes` only; the delivery form gets the estimate in both languages next to the default method; the other tabs stay.
- Legal: types `terms` and `privacy`; the reminder that both must be published before anyone can order.
- Notifications and announcements: the type list of section 13.1; no cargo anywhere.
- Today: the groups of the attention answer (orders to process, refunds needed, pending and failed, returns requested, stock low, notifications failed and queued), each linking to the filtered list.

### 5.7 Permissions

Resources are `admin_users`, `roles`, `customers`, `catalog`, `orders`, `settings`, `legal`, `payments`, `notifications`, each with `.read` and `.manage`, plus wildcards (section 17.1). Stock belongs to `catalog`; refunds to `payments`; returns and the order status to `orders`. Update the permission helper, the role matrix and their tests.

### 5.8 Mocks and tests

`mocks/`: remove the cargo, ordering, activation, cash, waiving and reminder modules; add stock (set, adjust, ledger, `STOCK_INSUFFICIENT`), the new order statuses and payment block, `needsRefund`, `refundable`, the return `restock`, the new settings and attention shapes. Update the component tests and the Playwright specs that cover the old flows (cargo and payments, auth with the cargo form, phone with mark delivered and cash, accessibility URLs); the new phone flow is: see the paid orders, mark processing, dispatch with the tracking number, mark delivered, decide a refund, correct the stock.

### 5.9 Documentation of this repository

Update `README.md`, `CONTRIBUTING.md` (cargos is no longer the reference feature; take orders or stock) and `DECISIONS.md` (remove the per-cargo bulk and activation batch decisions; record the new ones; keep "What the API cannot do" current).

---

## 6. API facts you must respect

- Base URL `<NEXT_PUBLIC_API_URL>/v1`, JSON, errors as `{ error: { code, message, details? }, requestId }`. Unknown fields in a body are rejected (`400 VALIDATION_FAILED`); send only documented fields.
- Cookie authentication, `credentials: 'include'`, refresh once on `401 AUTH_TOKEN_INVALID`, the MFA steps, the forced password change: the existing session and sign-in code does this; keep it.
- Money is integer cents, VAT rates in hundredths of a percent; inputs show euros, the API gets cents.
- Statuses and transitions are the API's. An order answers `allowedStatuses`; the panel offers exactly those. Forward steps email the customer; one step back tells the customer nothing. No order is confirmed by hand.
- Nothing is reserved before the payment: the stock count is what the shop sells. A product with quantity 0 is sold out in the shop.
- Every refund is a decision of a human, in the panel. A cancelled or credited paid order waits with `needsRefund: true` until the admin decides.
- Some features may be off on the server (Stripe, WhatsApp, incomplete company details): `GET /v1/admin/settings` says which; show the state, never hide the function.

---

## 7. How to work

1. Read the files of section 3 completely. Then write a short **plan**: every file you will remove, change or add, with the reason, the new type definitions, the permission changes, open questions, and anything the API cannot do. **Wait for the owner's go before editing.**
2. Build in phases, each ending with lint, type check and tests green and a short note of what was done and decided: types, client and permissions → removal of the cargo and old payment parts → orders, bulk and the payment card with the refund decision → products and stock → returns, customers, settings, legal, communication, start page → mocks and tests → README, CONTRIBUTING, DECISIONS.
3. Do not commit to Git unless asked. No secrets in the panel; it has none.
4. When the owner gives an instruction, follow it. When you believe it harms the result, say so once with a better alternative, then do what he decides.
5. The design does not change. If a change you think necessary would alter the look, ask first.
