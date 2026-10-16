# Radhe Foods Backend Architecture

Status: describes the API as built. Rewritten on 2026-10-16, after the move from a pre-order shop to a shop that sells from stock and is paid at checkout.
Scope: this repository (`radhe-api`) holds the NestJS backend only. The customer web app and the admin app are separate Next.js projects.

The plan of the move and the owner's decisions are in `ECOMMERCE_MIGRATION_PLAN.md`.

History, in one paragraph: the shop was first built as a pre-order platform. Orders were collected for an ordering cycle (a "cargo"), delivered, and paid afterwards by payment link, cash or not at all; the customer with an overdue invoice was blocked from ordering. In October 2026 the owner replaced that with a standard shop: products have stock, the customer pays on a Stripe page at checkout, the payment confirms the order, and the order is prepared, dispatched and delivered. Everything cargo- and pay-later-related was removed; the catalogue, accounts, notifications, invoices and returns stayed.

---

## 1. Core concept

**Sell from stock, pay at checkout.**

```text
Product → Cart → Checkout → Stripe Checkout (card, PayPal) → Order confirmed, invoice issued
        → Processing → Dispatched → Delivered → (Return within the return window)
```

- Every product has a stock count; 0 means sold out. The stock is what everyone sees: nothing is reserved while a customer is paying.
- An order exists from the moment the customer starts to pay (`pending_payment`). The payment confirms it; an order is never confirmed by hand.
- Overselling is prevented at the moment of payment: the bank approves the amount on the Stripe page, the API takes the stock of every item, and only then captures the money. An item that sold out meanwhile cancels the order and nothing is charged.
- Delivery is Germany-wide, one standard delivery with configurable fee tiers; the admin picks the carrier, never the customer.

## 2. Decisions

| Topic | Decision |
|---|---|
| Market | Germany, EUR, all data hosted in Frankfurt |
| Languages | English (`en`) and German (`de`) from launch |
| Shape | One NestJS modular monolith, one process, REST with OpenAPI. No microservices, no Redis, no queue service |
| Database | MongoDB Atlas, also for development. Automated tests use an in-memory MongoDB |
| Stock | Every product tracks `stock.quantity` and an optional `lowStockThreshold`; set by the admin and by CSV; every change is a record in a ledger |
| Reservation | None before payment. Products stay available to everyone until a payment is captured; overselling is prevented by taking the stock before capturing the money |
| Payment | Stripe Checkout with card and PayPal, at checkout, with manual capture: authorise on the page, deduct the stock, then capture. No cash, no cash on delivery, no coupons |
| Accounts | Browsing and the cart need no account. Checkout requires sign-in; no guest checkout |
| Pack sizes | Every pack size is its own product with its own SKU, price and page. Pack sizes of the same product share a group, and the shop offers them as sizes to choose from |
| Categories | Managed in the admin panel, up to three levels deep |
| Cancellation | The customer may cancel until the order is dispatched by default; the cutoff is a setting (`never`, `while_confirmed`, `until_dispatched`). An unpaid order can always be given up. The admin may cancel until the goods are delivered |
| Changing an order | Not possible. The customer cancels while allowed and orders again |
| Refunds | Always decided by a human: through Stripe to the original payment method, or by hand (bank transfer, cash, other) with a record |
| Prices | Entered and displayed including VAT. VAT breakdown on orders, invoices and credit notes |
| Delivery fee | Configurable tiers in the admin panel (for example free from 50 euros). Nothing hardcoded |
| Delivery area | All of Germany, no postcode excluded |
| Delivery method | Chosen by the admin, never by the customer. Delivery by Radhe Foods, DHL or Hermes; no pickup |
| Less delivered than ordered | Not the normal way. The admin corrects the affected products afterwards; the final bill follows with a credit note, the delivery fee stays |
| Returns | Kept. Single products, requested within a window after delivery, every return decided and completed by the admin, with a credit note |
| Invoices | Issued the moment the payment is captured, as PDF in the confirmation email and in the account |
| Authentication | Cookies: httpOnly, Secure, SameSite, separate for customers and admins. Admins sign in with password and TOTP |
| Permissions | Roles are sets of `<resource>.read` / `<resource>.manage` permission strings; a new role is a data change |
| Notifications | Every message to a customer is a record in MongoDB, worked by the API itself. No message broker |
| Hosting | Hostinger shared hosting (Node.js web app), one process; an external cron job calls `POST /v1/jobs/run` |
| B2B | Out of scope until explicitly requested |
| Docker | Not used for now |

## 3. System overview

```text
Customer web (Next.js) ─────────┐
                                ├─► NestJS API (Hostinger web hosting) ──► MongoDB Atlas (Frankfurt)
Admin app (Next.js) ────────────┘          │                                 (data, and the notification queue)
Stripe ──── webhooks ──────────────────────┤
Cron job ── POST /v1/jobs/run ─────────────┤
                                           ├─► S3 + CloudFront (images)
                                           ├─► Amazon SES (email)
                                           └─► WhatsApp Cloud API (when configured)
```

- One NestJS **modular monolith**. No microservices.
- One process. It serves HTTP and runs the jobs: the checkout cleanup and the notification queue. The queue is a MongoDB collection worked by the API itself. An external cron job calls `POST /v1/jobs/run` every five minutes, which keeps the process awake on shared hosting and the jobs on time.
- REST API, versioned under `/v1`, documented with OpenAPI (`/docs`, `/docs/openapi.json` when `SWAGGER_ENABLED`).

### Route groups

| Prefix | Audience | Auth |
|---|---|---|
| `/v1/store/*` | Customer web | Public or customer session |
| `/v1/admin/*` | Admin app | Admin session plus permission |
| `/v1/webhooks/stripe` | Stripe | Signature verification |
| `/v1/jobs/run` | An external timer | `X-Jobs-Token` header |
| `/v1/unsubscribe/:token` | Link in emails | The token itself |
| `/v1/brand/logo.png` | Email clients | Public |
| `/health`, `/health/live` | The host | Public, no version prefix |

## 4. Modules

| Module | Responsibility |
|---|---|
| `auth` | Email OTP, Google sign-in, admin login with password and TOTP, sessions, guards |
| `customers` | Profiles, addresses, language, account status (blocking), communication preferences, the unsubscribe link |
| `admin-users` | Admin accounts, roles, permissions |
| `people` | The names of admins and customers next to their ids in admin answers. Owns no data |
| `catalog` | Products (one per pack size), categories, translations, SEO fields, images, prices with their history, stock with the movement ledger, CSV import and export |
| `media`, `storage` | Image validation and conversion; file storage behind a provider interface (S3, local folder) |
| `storefront` | What customers see: the catalogue with `ordering` per product (can it be ordered, why not, how many are left), facets. Owns no data |
| `cart` | Server cart for signed-in customers, price preview for anonymous carts, and the bill: totals, VAT, delivery fee |
| `orders` | The order from checkout to delivery: creation from the cart as `pending_payment`, taking stock and giving it back, statuses and history, delivery method and tracking, bulk actions, corrections of delivered quantities, cancellation, the final bill, the hooks the modules above register |
| `payments` | Stripe Checkout with manual capture, settlement from the webhook, paying again, the checkout cleanup job, credit notes after a changed bill, refunds through Stripe or by hand |
| `invoices` | Invoices and credit notes: numbers without gaps, immutable documents, PDF rendering, the PDF attachment for notifications |
| `returns` | Return requests by the customer, decision and completion by the admin, credit on the order, restocking |
| `notifications` | Every message to a customer: the queue in MongoDB, the dispatcher with retries, consent rules, templates per type and language, the WhatsApp provider, the admin's list and retry |
| `mail` | Email providers (Amazon SES, SMTP, console), the email layout, the logo endpoint |
| `announcements` | News about a product or an offer, sent by the admin to the customers who asked, by email and WhatsApp |
| `attention` | What waits for the admin, in one answer. Owns no data |
| `settings` | Configurable business rules |
| `legal` | Versioned `terms` and `privacy` documents |
| `jobs` | Every scheduled job in one call, for an external timer. Owns no data |
| `health`, `config`, `database`, `common` | Health check, validated environment, transactions, counters, errors, middleware |

Rule: modules talk through their public services. Business modules never call an email or WhatsApp provider directly: they queue a message with the notifications module, which knows the consent of the customer and the channels. There is no event bus; `notifications` sits below the business modules and is called directly.

The bill lives in `cart` and order placement in `orders`, because the cart, the preview and the order must use one computation. Statuses, delivery method and bulk updates are part of the order and live in `orders`. Returns have a module of their own: they are a conversation between customer and admin that ends with one change on the order.

Rule: dependencies between business modules point one way.

```text
attention ──► orders, returns, payments, notifications, catalog
payments ───► orders, invoices, cart, settings, notifications
returns ────► orders, settings, notifications
orders ─────► cart, catalog, customers, legal, settings, notifications
invoices ───► settings, notifications
cart ───────► catalog, settings
storefront ─► catalog
announcements ──► notifications, customers, catalog, settings
notifications ──► customers, settings, mail
```

Where a module needs an answer from a module above it, that module registers the answer:

- `orders` registers with `catalog` that a product which is part of an order that counts cannot be deleted.
- `payments` registers with `orders` what follows a changed final bill (a credit note) and a cancellation (an approval of the bank that was never captured is let go of, an open payment page is closed).
- The refunds part of `payments` registers with the webhook handler what Stripe tells about refunds.
- `invoices` registers with `notifications` how an invoice PDF is drawn, so a confirmation email can carry one. `notifications` knows nothing about orders or invoices: it stores what it is given and renders it at send time.

The payment record itself lives on the order document and is owned by the payments module.

## 5. Data model

MongoDB Atlas with Mongoose. Collections have `createdAt` and `updatedAt` unless noted.

### General rules

- **Money** is an integer in cents. Never a float.
- **VAT rate** is stored in basis points (700 = 7%, 1900 = 19%).
- **Prices are gross.** VAT is derived per line: `vat = round(gross × rate / (10000 + rate))`.
- **Dates** are stored in UTC. Calendar days are interpreted in `BUSINESS_TIMEZONE` (`Europe/Berlin`).
- **Translatable fields** are objects: `{ en: "...", de: "..." }`.
- **Orders hold snapshots**, never live references, for anything shown to the customer.
- **Settlement, corrections and the completion of a return run in transactions.** Stock changes are single atomic updates outside them.

### Collections

| Collection | Key contents |
|---|---|
| `adminUsers` | email, password hash, encrypted TOTP secret, role, status, failed logins |
| `customers` | email, name, phone, addresses, language, account status, Google ID, communication preferences (WhatsApp number and yes, news yes, dated), search words |
| `customerSessions`, `adminSessions` | hashed refresh token, user, expiry, previous token hash for reuse detection; expire by TTL |
| `otpChallenges` | email, keyed hash of the login code, attempts, expiry; purged by TTL |
| `roles` | key, name, permission strings |
| `categories` | translated name and slug, parent, ancestors, sort order, visibility, image |
| `products` | one document per sellable pack size: SKU, translated name, slug and description, category and category path, pack size, pack-size group, regular and sale price, VAT rate, status (`draft`, `active`, `archived`), `isAvailable`, `minOrderQuantity`, `maxOrderQuantity`, `stock { quantity, lowStockThreshold }`, images, food information, SEO fields, search words |
| `productPriceChanges` | one entry per price change of a product |
| `stockMovements` | the ledger: product, SKU, reason (`restock`, `adjustment`, `import`, `order`, `cancel`, `return`, `release`), delta, quantity afterwards, the order or the admin, note. Appended, never edited; `createdAt` only |
| `carts` | customer, items; one per customer, dropped after 90 days without a change |
| `orders` | see below |
| `paymentEvents` | Stripe event id (unique), type, processed flag, order, error; kept 90 days |
| `refunds` | number (`RF-1084-RF1`), order, customer, invoice number, amount, reason, method (`stripe`, `manual`), status, Stripe refund id and status, manual way, reference and paid date, note, history |
| `returns` | number (`RF-1084-R1`), order, customer, status, items with requested and approved quantities and reasons, comments, notes, credit amount, decided, completed and restocked dates, history |
| `notifications` | type, channel, recipient, customer, order, product, return, refund, announcement, language, the data it is rendered from, subject, attachments by reference, status, dedupe key, attempts, next attempt, lock, sent time, provider message id, last error, history of attempts |
| `announcements` | subject and message per language, link, product, channels, recipients, queued, who sent it, cancelled |
| `legalDocuments` | type (`terms`, `privacy`), version, translated title and content, status (`draft`, `published`), published date |
| `invoices` | number (per type and year, without gaps), type (`invoice`, `credit_note`), order, customer, seller and customer as printed, lines, totals with VAT per rate, issued and paid dates, language, the invoice a credit note corrects and why. Immutable; PDF rendered on request |
| `counters` | atomic sequences for order, invoice, credit note and legal version numbers |
| `settings` | one document per key: `delivery_fee` (tiers), `order_policy` (customer cancellation rule), `delivery` (default method, estimate per language), `return_policy` (window in days), `company` (invoice details), `payments` (minutes a payment page stays open) |

The delivery fee is a setting with tiers, not a collection of rules. Delivery methods are a fixed list in code (`radhe_delivery`, `dhl`, `hermes`), not a collection; the default for new orders is a setting. Delivery addresses are part of the customer document.

### Order document

```text
orderNumber ("RF-1001" onwards), customerId
customer: { email, firstName, lastName, phone }            (snapshot)
searchTokens[]                                             (number, name, email, phone)
items[]:
  productId, sku, name { en, de }, packValue, packUnit, imageKey
  quantity, unitPrice, regularUnitPrice, vatRate
  lineTotal, vatAmount                                     (agreed)
  deliveredQuantity, returnedQuantity
  finalLineTotal, finalVatAmount                           (charged)
totals:      currency, subtotal, deliveryFee, total, netTotal, vatTotal,
             vat[]: { vatRate, gross, net, vat }           (agreed, never changes)
finalTotals: the same fields                               (after corrections and returns)
adjustments[]: { productId, sku, from, to, reason, note, adminId, at }
deliveryAddress (snapshot)
delivery: { method, trackingNumber, dispatchedAt, deliveredAt }
orderStatus, paymentStatus
payment: { amount, paidAmount, creditedAmount, refundedAmount, attempts,
           checkoutSessionId, checkoutUrl, checkoutExpiresAt,
           paymentIntentId, chargeId, paymentType, receiptUrl,
           authorizedAt, paidAt, invoiceId, invoiceNumber, lastFailure }
pendingUntil                                               (while pending_payment: when the cleanup gives it up)
stockTakenAt                                               (while the units are off the shelf for this order)
language, customerNote
consent: { acceptedAt, documents[]: { type, version, documentId }, ip, userAgent }
cancellation: { reason, text, by ("customer" | "admin" | "system"), adminId, at }
statusHistory[]: { field ("order" | "payment" | "delivery"), from, to, at, by, adminId, note }
idempotencyKey
```

### Important indexes

- `orders`: unique `orderNumber`; unique `(customerId, idempotencyKey)` where the key exists, so the database itself guarantees one order per attempt; `(customerId, _id)` and `(orderStatus, _id)` for the lists; `(orderStatus, pendingUntil)` on `pending_payment` only, for the cleanup; sparse `payment.checkoutSessionId` and `payment.paymentIntentId` for what Stripe talks about; `(paymentStatus, orderStatus)` for the refunds to decide.
- `products`: unique SKU; unique slug per language; `(status, isDefaultVariant, sortOrder, _id)` for the shop listing; sparse `variantGroupId`; `searchTokens`.
- `stockMovements`: `(productId, _id)`, the history of one product newest first.
- `carts`: unique `customerId`; TTL on `updatedAt` of 90 days.
- `invoices`: unique `number`; `(orderId, _id)` ascending, so the documents of an order come in order of issue; `(customerId, _id)`; `(type, issuedAt)`.
- `refunds`: unique `refundNumber`; `(orderId, _id)`, `(status, _id)`; sparse `stripe.refundId`.
- `returns`: unique `returnNumber`; `(orderId, _id)`, `(customerId, _id)`, `(status, _id)`.
- `paymentEvents`: unique Stripe event id, which makes webhooks safe to receive twice; TTL of 90 days.
- `notifications`: `(status, nextAttemptAt)` is the queue; unique sparse `dedupeKey` makes every event one message; `(customerId, _id)`, `(orderId, _id)`, `(status, _id)`, `(type, _id)`, sparse `(announcementId, status)` for the lists.
- `customers`: unique email; unique sparse `googleId`; partial `(communication.marketingOptIn, _id)` on `true` for the recipients of an announcement; `searchTokens`.
- `legalDocuments`: unique `(type, version)`. `categories`: unique slug per language, `(parentId, sortOrder)`, `ancestorIds`.
- `customerSessions`, `adminSessions`, `otpChallenges`: TTL on the expiry.
- Indexes on optional fields are sparse, not partial with a `$type` filter: MongoDB uses a sparse index for a lookup by value, and does not use such a partial one.

`npm run db:indexes` builds every index and fills in the search words of older orders and customers.

## 6. Status models

Each status field has its allowed transitions defined in one place in code (`src/modules/orders/order-status.ts`, `refund.schema.ts`, `return.schema.ts`). Every change is written to the history of the record.

### Order

| Field | Values |
|---|---|
| Order status | `pending_payment` → `confirmed` → `processing` → `dispatched` → `delivered`; `cancelled`; `returned` |
| Payment status | `pending` → `authorized` → `paid` → `refunded`; `failed` |

Transitions of the order status:

| From | To, by the admin | Otherwise |
|---|---|---|
| `pending_payment` | nothing by hand | `confirmed` by the payment; `cancelled` by the customer, the admin or the API |
| `confirmed` | `processing`, `dispatched` | `cancelled` |
| `processing` | `confirmed` (step back), `dispatched` | `cancelled` |
| `dispatched` | `processing` (step back), `delivered` | `cancelled` |
| `delivered` | `dispatched` (step back) | `returned` by a completed return that leaves nothing |
| `cancelled`, `returned` | none | none |

- Forward steps tell the customer (`dispatched`, `delivered`); a step back corrects a mistake and tells nobody.
- Bulk moves take only orders on the normal way: to `processing` from `confirmed`, to `dispatched` from `confirmed` or `processing`, to `delivered` from `dispatched`. Every other order in the request is answered with the reason it stayed.
- The stock of an order is off the shelf in `confirmed`, `processing`, `dispatched`, `delivered` and `returned`. Delivery method, tracking and delivered quantities can be changed in `confirmed`, `processing`, `dispatched` and `delivered`.
- Cancellation by the customer, by the rule `order_policy.customerCancellation`: `never` only in `pending_payment`; `while_confirmed` also in `confirmed`; `until_dispatched` (default) also in `processing`. By the admin in `pending_payment`, `confirmed`, `processing` and `dispatched`. Reasons: customer `changed_mind`, `ordered_by_mistake`, `wrong_items`, `delivery_too_late`, `other`; admin `customer_request`, `product_unavailable`, `duplicate_order`, `suspected_misuse`, `other`; system `payment_not_completed`, `sold_out`.
- Adjustment reasons: `missing`, `damaged`, `wrong_item`, `customer_complaint`, `other`.

Payment status: `pending` while the customer has not paid; `authorized` once the bank approved the amount and the API is taking the stock and capturing; `paid` once captured; `failed` when the last attempt did not go through (the customer can pay again, which sets it to `pending`); `refunded` once everything that was paid went back. A failed attempt is noted in `payment.lastFailure`.

### Refund

`pending` → `completed` for a manual refund, completed by the admin. `processing` → `completed` or `failed` for a refund through Stripe, completed when Stripe confirms. `pending` and `failed` → `cancelled` by the admin. Methods `stripe`, `manual` (ways `bank_transfer`, `cash`, `other`); reasons `return`, `adjustment`, `goodwill`, `duplicate_payment`, `other`.

### Return

`requested` → `approved`, `rejected` or `cancelled` (by the customer); `approved` → `completed` or `rejected`. Reasons `damaged`, `wrong_item`, `quality`, `not_as_described`, `changed_mind`, `other`. Only completion changes the order.

### Notification

`queued` → `sending` → `sent`; `failed` after the last attempt or at once on a refusal; `skipped` when the channel is not configured or not consented to; `cancelled` by the admin while queued.

## 7. Key flows

### 7.1 Checkout

`POST /v1/store/checkout`, signed-in customers only, header `Idempotency-Key`, body `addressId`, `expectedTotal`, `consent { accepted, versions { terms, privacy } }`, optional `note` and `language`.

1. Online payment must be configured (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), else 503 `PAYMENTS_NOT_CONFIGURED`. The company settings must be complete enough for an invoice (name, address, email, VAT id or tax number), else 409 `COMPANY_DETAILS_MISSING`.
2. If an order with this key exists for this customer, it is answered with status 200 and `created: false`, with its open payment page or a new one; 409 `ORDER_NOT_PAYABLE` when that order is paid or given up.
3. Checks, reading only: the customer is not blocked; the address is theirs; the accepted versions are the current published ones of `terms` and `privacy`; the cart is not empty; every line can be ordered (the product exists and is available, the stock covers the quantity, the quantity is within the product's minimum and maximum), else 409 `ORDER_ITEMS_NOT_ORDERABLE` with the lines and their issue; prices, VAT, delivery fee and totals are computed from the database; the total equals `expectedTotal`, else 409 `ORDER_TOTAL_CHANGED` with the new bill.
4. The next order number is taken (`RF-1001` onwards) and the order is written as `pending_payment` / `pending` with its snapshots, the consent record, `payment.amount` and `pendingUntil` 24 hours ahead. Nothing is reserved; the cart is kept.
5. A Stripe Checkout Session is created: the amount, the order number as description, the email and language of the customer, card and PayPal, **manual capture**, expiry after `payments.checkoutMinutes` (default 60, 30 to 1440), success and cancel URLs `SHOP_URL/account/orders/{number}?payment=success|cancelled`, one idempotency key per attempt. The session is noted on the order (`attempts` + 1, `pendingUntil` = page expiry + 10 minutes) and `{ created: true, order, checkout: { url, expiresAt } }` is answered with 201.

The customer pays on Stripe's page; the bank approves the amount; nothing is taken yet. The order number is taken outside any transaction; a failed request can leave a gap in the numbers.

### 7.2 Settlement

Stripe reports through `POST /v1/webhooks/stripe`, verified with the signing secret. Every event is recorded in `paymentEvents` by its id before it is worked and marked processed afterwards; an event that arrived before changes nothing, and two arriving at once are worked once. The events used: `checkout.session.completed` and `checkout.session.async_payment_succeeded` settle; `checkout.session.async_payment_failed` and `payment_intent.payment_failed` record a failure; `checkout.session.expired` forgets the page; `refund.*`, `charge.refund.updated` and `charge.refunded` go to the refunds.

Settling an order, given the payment intent:

1. An order that is `paid` or `refunded` is left alone. An order that is no longer `pending_payment` (cancelled while the customer was paying) lets the approval go: nothing is charged.
2. The payment is read from Stripe. An approval that was cancelled, or an amount that differs from `payment.amount`, marks the payment `failed` (the approval is let go of when the amount differs).
3. The order is claimed: one conditional update sets `authorized`, so only one worker goes on with it.
4. The stock is taken, one atomic decrement per item guarded by `quantity >= wanted`, written to the ledger as `order`. When an item sold out meanwhile, the items taken so far are given back (`release`), the approval is cancelled at Stripe, the payment is marked `failed`, the order is cancelled with reason `sold_out`, and the customer gets the cancellation email. Nothing was charged.
5. The money is captured, with an idempotency key per payment intent. If Stripe refuses, the stock is given back (`release`), the payment is marked `failed` and the error is raised; the webhook is retried by Stripe.
6. In one transaction: the invoice is issued from the final bill with the next number (`INV-YYYY-NNNNNN`, issued and paid at the same moment), the order becomes `confirmed` with payment `paid` (amount received, charge, card or PayPal, receipt URL, invoice), the page and `pendingUntil` are removed, the cart of the customer is emptied.
7. The confirmation email goes out with the invoice PDF attached.

Crash recovery: `stockTakenAt` is set when the stock is taken. An order found `authorized` later (by the webhook again, by the customer coming back, or by the cleanup) is finished from where it stopped: captured already → confirm; stock not taken → take it; then capture and confirm. The stock is never taken twice.

The customer coming back before the webhook: `GET /v1/store/orders/{number}/payment` asks Stripe about the open page; a complete session is settled at once, an expired one is forgotten. A pending order whose page expired or whose payment failed gets a new page with `POST /v1/store/orders/{number}/pay` (409 `ORDER_NOT_PAYABLE` otherwise); a page that is still open for more than five minutes is handed out again instead of a new one. A recorded failure sends the `payment_failed` email with a link to the order page.

### 7.3 Abandoned checkouts

The cleanup finds orders that are `pending_payment` with `pendingUntil` in the past, 200 at a time. An order that is `authorized` is settled late (or cancelled with `sold_out` when the stock is gone); if the capture fails, the payment is marked `failed` and the next run gives the order up. Any other one has its page expired at Stripe and is cancelled by the system with reason `payment_not_completed`; no email is sent for an order that was never paid. The cleanup runs 15 seconds after the start and then at every full `PAYMENT_JOB_INTERVAL_MINUTES` on the clock, and it is the first job of `POST /v1/jobs/run`.

### 7.4 Cancellation and refund

- The customer cancels with `POST /v1/store/orders/{number}/cancel` while `canCancel` of the order is true (see section 6); the admin with `POST /v1/admin/orders/{id}/cancel`, with a reason. Cancelling an order that is cancelled already changes nothing.
- The status is written under the condition that it is still the one that was read. If the stock of the order was taken, it is given back with ledger reason `cancel`. An approval of the bank that was never captured is let go of; an open payment page is closed at Stripe.
- The customer is emailed (`order_cancelled`, saying whether money was paid), except for an order the system gave up before any payment.
- When money was paid, the order waits for a refund: `needsRefund` of its payment is true while `paidAmount` exceeds `refundedAmount` on a cancelled order, or while credit notes exceed what was refunded. Both cases are listed by `needsRefund=true` and counted on the attention page.
- The admin decides the refund with `POST /v1/admin/orders/{id}/payment/refunds`: amount at most `paidAmount − refundedAmount − open refunds` (`refundable.maximum`; `refundable.suggested` is what the cancellation or the credit notes call for), reason, and `method`. `stripe` asks Stripe at once with an idempotency key per refund and becomes `processing`, then `completed` or `failed` when Stripe answers (through the webhook, or `POST /v1/admin/refunds/{id}/sync`); it needs a payment through Stripe. `manual` records the way and a reference and stays `pending` until the admin confirms with `POST /v1/admin/refunds/{id}/complete`. Either can be withdrawn while not complete.
- A completed refund is booked on the order: `refundedAmount` grows, the payment status becomes `refunded` when everything paid went back, and the customer is emailed (`refund_completed`, with the way the money comes back).

### 7.5 Fulfilment

- `POST /v1/admin/orders/{id}/status` moves one order forward (`processing`, `dispatched`, `delivered`) or one step back, with a note and, when dispatching, the tracking number. The order answers `allowedStatuses`. Dispatching sets `delivery.dispatchedAt`, delivering `delivery.deliveredAt`; a step back clears what no longer holds.
- `POST /v1/admin/orders/bulk/status` and `POST /v1/admin/orders/bulk/delivery-method` take up to 500 chosen orders and answer every one in `results` (`changed`, or the `reason` why not). The status change is one write for all eligible orders.
- `PATCH /v1/admin/orders/{id}/delivery` sets the method and the tracking number; changing the method removes the tracking number, because it belongs to one carrier. The default method of a new order is the setting `delivery.defaultMethod`.
- The customer sees a tracking link for DHL and Hermes, none for delivery by Radhe Foods. The dispatch email carries carrier, tracking number and link and the delivery estimate of the settings; the delivery email names the return window.

### 7.6 Corrections

`PATCH /v1/admin/orders/{id}/items/{productId}` with `deliveredQuantity` (between what was returned and what was ordered), `reason` and an internal `note`. In one transaction the line and `finalTotals` are recomputed from delivered minus returned units at the agreed prices (the agreed bill and the delivery fee stay), the adjustment is recorded, and the hook of the payments module issues a credit note (`CN-YYYY-NNNNNN`) for the difference on the invoice, growing `creditedAmount`. Units that were not delivered go back to the stock with reason `release`. The order then waits for a refund that the admin decides (7.4).

### 7.7 Returns

1. The customer asks to send back single products of a `delivered` order with `POST /v1/store/orders/{number}/returns`, within `return_policy.windowDays` after `deliveredAt` (14 by default; 0 switches returns off), up to what was delivered, not returned and not in an open request (`returnable` of `GET .../returns`). The request is numbered per order (`RF-1084-R1`); the admin is not emailed, the customer gets `return_requested`.
2. The admin approves (`POST /v1/admin/returns/{id}/approve`, as asked or with other quantities, 0 declines a product) or rejects, each with a note the customer reads and an internal note. The customer can take the request back until it is decided. Approval changes nothing on the order.
3. When the goods are back, the admin completes the return (`POST /v1/admin/returns/{id}/complete`). In one transaction the accepted units are booked as returned on the order, `finalTotals` go down, the order becomes `returned` when nothing of a delivered order is kept, the return records `creditAmount` and the credit note is issued through the hook. With `restock: true` the accepted units go back on the shelf with ledger reason `return` and the return carries `restockedAt`. The customer gets `return_completed` with the credit; the order waits for a refund that the admin decides (7.4).

### 7.8 Jobs

`POST /v1/jobs/run` with header `X-Jobs-Token` runs the checkout cleanup and then the notification queue once, and answers what each did. The same jobs run on timers inside the process (`PAYMENT_JOB_INTERVAL_MINUTES`, `NOTIFICATION_INTERVAL_SECONDS`); the endpoint exists for shared hosting, where the process may be put to sleep. Without `JOBS_TOKEN` the endpoint is off.

## 8. Authentication

| User | Method |
|---|---|
| Customer | Email OTP: 6 digits, 10 minutes, 5 attempts, stored as a keyed hash in MongoDB, rate-limited per email and IP |
| Customer | Google sign-in, verified on the server, linked by verified email |
| Admin | Email and password (Argon2id) plus TOTP |

- Signing up and logging in are the same OTP flow.
- Login codes live in MongoDB with automatic expiry, not in Redis, so that authentication needs no second data store; the job queue in MongoDB follows the same choice.
- Access token: JWT, 15 minutes. Refresh token: opaque, rotating, stored hashed, with reuse detection.
- Tokens travel in httpOnly, Secure, SameSite cookies under one parent domain.
- Customer and admin sessions use separate cookies, audiences and collections.
- Admin endpoints check a permission string. Roles are sets of permissions, so new roles need no code change.

## 9. Localization

| Text | Owner |
|---|---|
| Interface text | Next.js apps |
| Product and category content | Database, as translated fields |
| Emails and WhatsApp messages | Backend templates per language |
| API errors | Backend returns stable error codes; frontends translate them |

- Store endpoints return one language, chosen by a `locale` parameter or the `Accept-Language` header, falling back to English.
- Admin endpoints return all languages for editing.
- Each customer and each order stores its language.

## 10. Notifications

```text
Business module queues a message (type, customer, data, dedupe key)
→ notifications decides the channels from the consent of the customer and writes one record per channel
→ the dispatcher claims a queued record, renders it, sends it, records the outcome
→ a failure that can pass comes back in 1 min, 5 min, 30 min, 2 h, 12 h; a refusal fails at once
→ the admin sees every record, retries a failed one, cancels a queued one
```

| Type | Sent when | WhatsApp |
|---|---|---|
| `order_confirmed` | the payment was captured; carries the lines, the total, the payment method, the invoice number and the invoice PDF | no |
| `payment_failed` | an attempt did not go through; links to the order page to pay again | no |
| `order_cancelled` | the customer, the admin or a sold-out item cancelled; says whether money was paid | no |
| `order_dispatched` | the order was set to `dispatched`; carrier, tracking number and link, delivery estimate | yes (transactional) |
| `order_delivered` | the order was set to `delivered`; names the return window | no |
| `return_requested`, `return_approved`, `return_rejected`, `return_completed` | the return changed status; the completed one carries the credit | no |
| `refund_completed` | a refund was completed; says how the money comes back | no |
| `announcement` | the admin sent news about a product or an offer | yes (marketing) |

- The record is the queue. Nothing waits in memory; a restart loses nothing; a record `sending` for more than ten minutes is queued again.
- Sending happens at once after queueing (a kick of the dispatcher) and every `NOTIFICATION_INTERVAL_SECONDS` for retries; in tests, before the request answers.
- Rendering at send time, from the data stored with the record, so a retry says the same thing and the admin sees what was said.
- Email always, for messages about the customer's own orders. WhatsApp only for `order_dispatched`, to customers who gave a number and said yes, and for `announcement`, which needs the marketing yes of its own, by any channel, and carries an unsubscribe link that works without a login.
- Email and WhatsApp are adapters behind interfaces. Email: Amazon SES through its API, SMTP, or the console. WhatsApp: the Cloud API of Meta with approved templates, or a disabled adapter that records messages as skipped until credentials exist.
- Attachments are references (`invoice_pdf` with the invoice id); the invoices module makes the file when the message is sent.
- No separate admin channel: `GET /v1/admin/attention` and the lists show what needs a look: orders to process, orders waiting for a refund, refunds pending or failed, returns requested, products at or below their low-stock threshold, failed messages.

## 11. Storage

- Private S3 bucket in Frankfurt, served through CloudFront. Setup: `AWS_S3_SETUP.md`.
- Images are uploaded to the API, which validates them, converts them to WebP in three sizes and stores only the converted files.
- The database stores object keys, not URLs.
- Every upload gets a new key, so stored files never change and are cached for a year.
- Invoice PDFs are not stored. An invoice is an immutable document in the database; its PDF is rendered on request, behind the login of the customer or the admin, in about 50 ms.

Uploading through the API was chosen over a direct upload from the browser to S3 with a presigned URL, for three reasons. The file is proven to be an image before anything is stored. No unconverted upload ever exists in the bucket. No worker or queue is needed. The cost is that the API handles the file, which is acceptable for a few admins uploading product photos. A presigned upload can be added later for large files.

## 12. Security

- Input validation on every endpoint; unknown fields rejected.
- Rate limiting: `THROTTLE_LIMIT_PER_MINUTE` per IP on every route (120 by default); tighter on auth, checkout (20 per minute), the payment status (30), paying again (10) and return requests (10); the webhook allows 600.
- Stripe webhook signatures verified on the raw body; events processed once; the approved amount compared with the order before the money is captured; nothing is charged for an order that sold out.
- Prices, VAT, delivery fee and stock are always determined on the server. The shop sends the total it showed, and the order is refused when it differs.
- Secure headers (helmet), strict CORS for the two frontend origins, an origin check on every non-GET request.
- Secrets only in environment configuration, validated at startup.
- Who did what is recorded on the record itself: status histories, adjustments, refunds and returns carry the admin. There is no separate audit log.
- No card data is stored; Stripe holds the payment method.

## 13. Infrastructure

| Piece | Choice |
|---|---|
| API | Hostinger web hosting, Node.js web app, one process. `doc/HOSTINGER_DEPLOYMENT.md` |
| Jobs | Timers inside the API, plus a cron job of the host that calls `POST /v1/jobs/run` every five minutes |
| Redis | Not used |
| Payments | Stripe Checkout (card, PayPal), webhook endpoint `/v1/webhooks/stripe` |
| Email | Amazon SES, Frankfurt. `doc/AWS_SES_SETUP.md` |
| WhatsApp | WhatsApp Cloud API of Meta, when configured. `doc/WHATSAPP_SETUP.md` |
| Database | MongoDB Atlas, Frankfurt (a replica set is required for the transactions) |
| Files | S3 and CloudFront. `doc/AWS_S3_SETUP.md` |
| Frontends | Vercel or Hostinger |
| Errors | JSON log lines in production. No error tracker is wired in |
| CI | None set up; `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:e2e` by hand |
| Environments | Local, staging, production |

### Environment

All variables are in `.env.example`; `npm run secrets` prints every secret at once.

| Group | Variables |
|---|---|
| Application | `NODE_ENV`, `PORT`, `TRUST_PROXY`, `SWAGGER_ENABLED`, `THROTTLE_LIMIT_PER_MINUTE` |
| Database | `MONGODB_URI`, `MONGODB_DB_NAME`, `MONGODB_MAX_POOL_SIZE` |
| Browser access | `CORS_ORIGINS`, `COOKIE_DOMAIN`, `COOKIE_SECURE` |
| Tokens and sessions | `JWT_CUSTOMER_ACCESS_SECRET`, `JWT_ADMIN_ACCESS_SECRET`, `JWT_ADMIN_MFA_SECRET`, `ACCESS_TOKEN_TTL_SECONDS`, `CUSTOMER_REFRESH_TTL_DAYS`, `ADMIN_REFRESH_TTL_HOURS`, `CUSTOMER_SESSION_MAX_DAYS`, `ADMIN_SESSION_MAX_HOURS` |
| Login codes | `OTP_HMAC_SECRET`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_MAX_PER_HOUR`, `GOOGLE_CLIENT_ID` |
| Admin security | `ADMIN_MFA_REQUIRED`, `TOTP_ENCRYPTION_KEY`, `ADMIN_MAX_FAILED_LOGINS`, `ADMIN_LOCKOUT_MINUTES` |
| Email | `MAIL_PROVIDER` (`console`, `ses`, `smtp`), `MAIL_FROM`, `MAIL_REPLY_TO`, `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_CONFIGURATION_SET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` |
| Notifications and jobs | `NOTIFICATION_INTERVAL_SECONDS`, `NOTIFICATION_CONCURRENCY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, `JOBS_TOKEN` |
| Images | `STORAGE_PROVIDER` (`local`, `s3`), `STORAGE_LOCAL_DIR`, `MEDIA_PUBLIC_BASE_URL`, `MEDIA_MAX_UPLOAD_MB`, `AWS_REGION`, `S3_CATALOG_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` |
| Business | `BUSINESS_TIMEZONE` |
| Payments and links | `SHOP_URL` (links in emails and the way back from Stripe), `ADMIN_URL`, `API_URL` (the logo in emails), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_JOB_INTERVAL_MINUTES` (the checkout cleanup) |
| First admin | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD` |

Without `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` the shop can be browsed but not bought from: checkout answers 503 `PAYMENTS_NOT_CONFIGURED`, and `GET /v1/admin/settings` shows `integrations.stripeConnected: false`.

### Command line

| Command | Does |
|---|---|
| `npm run secrets` | Prints every secret the environment needs |
| `npm run seed:admin` | Creates the first admin from `SEED_ADMIN_*` |
| `npm run reset:mfa -- <email>` | Removes the authenticator of an admin who lost it |
| `npm run db:indexes` | Builds the indexes and fills in the search words of older orders and customers |
| `npm run storage:check` | Verifies the image storage configuration |

## 14. Build order

The foundation (configuration, database, errors, OpenAPI, health), authentication, customers and admin users, the catalogue with images, the cart, invoices, returns, notifications and the attention page were built first, for the pre-order shop. The move to the current model was done in phases, each ending with green tests and a commit:

1. Inventory: stock on products, the movement ledger, admin stock endpoints, the low-stock filter, CSV columns.
2. Checkout and payment: the new order model, `POST /v1/store/checkout`, the Stripe session with manual capture, settlement from the webhook, the invoice at payment, the pending-order cleanup, customer order endpoints, the confirmation and payment-failed emails. Cargos and pre-orders removed from the store.
3. Fulfilment: admin order list and detail, transitions, dispatch with tracking, bulk actions, corrections, cancellation with the refund decision, the attention page.
4. Returns and refunds on the new model: stock back on completed returns, credit note and refund after a return, trimmed admin payment routes.
5. Removal: the cargos module, payment activation, reminders, pay links, cash, waiving, the overdue block and overrides, obsolete notification types and templates, settings and environment keys, the concept documents of the pre-order shop. A script for moving a database of the old shop existed briefly and was removed again, since no database with real data existed.
6. Hardening and documentation: this document, both API references, the prompts for the shop and the panel, README and the Hostinger guide.

## 15. Open items

| Item | Needed before |
|---|---|
| The customer web and the admin panel were built against the pre-order API and must be adapted to the current one, design unchanged (migration briefs `PROMPT_CUSTOMER_WEB.md`, `PROMPT_ADMIN_PANEL.md`) | Launch |
| German distance selling needs a Widerrufsbelehrung (withdrawal notice with a model form) and an Impressum. The API provides the legal types `terms` and `privacy` only; both pages are static content of the shop, not of the API | Launch |
| Stripe account: PayPal switched on and allowed to authorise without capturing (the checkout uses manual capture), branding of the payment page, the webhook endpoint with the events of section 7.2 | Launch |
| Legal review: the wording of the order button ("zahlungspflichtig bestellen"), terms, withdrawal right, invoices | Launch |
| VAT of the delivery fee: shared between the rates of the goods by net value. To be confirmed by the tax adviser | Launch |
| Return process: who pays the way back, and products excluded from returns (food that spoils quickly). The steps and the refunds are built | Launch |
| Amazon SES: domain verification, production access, IAM user | Launch |
| Card disputes (chargebacks): recorded by hand for now | Later |
| WhatsApp business account and the approval of the two message templates (dispatch, announcement) | When WhatsApp is wanted |
| Reports and dashboard aggregations (sales per product and period) are not built; the attention page and the lists serve for now | Later |
| An error tracker and a CI pipeline are not set up | Later |
| The plan: Hostinger's Business plan (Node.js web apps) or a VPS | Deployment |
