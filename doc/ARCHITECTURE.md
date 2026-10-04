# Radhe Foods Backend Architecture

Status: agreed on 2026-09-29, before implementation.
Scope: this repository (`radhe-api`) holds the NestJS backend only. The customer web app and the admin app are separate Next.js projects.

Business source documents: `Radhe_Foods_Preorder.md` and `Radhe_Foods_Preorder_Core_Concept.md` in this folder. Where this document and those differ, this document wins, because it records later decisions.

---

## 1. Core concept

**Pre-order first, payment later.**

```text
Product → Add to Cart → Confirm Pre-Order → Cargo Processing → Delivery → Payment Enabled → Customer Pays
```

- Every order is a pre-order and belongs to exactly one cargo.
- No payment is collected at checkout. There is no "buy now, pay at checkout" flow.
- The customer sees and accepts the full bill when confirming.
- Payment is activated after delivery, in bulk per cargo, with exceptions per order.

## 2. Decisions

| Topic | Decision |
|---|---|
| Market | Germany, EUR, all data hosted in Frankfurt |
| Languages | English (`en`) and German (`de`) from launch |
| Order flows | Pre-order only. Orders carry a `type` field so other flows can be added later |
| Stock | No warehouse stock. Availability and optional quantity limits per product per cargo |
| Pack sizes | Every pack size is its own product with its own SKU, price and page. Pack sizes of the same product share a group, and the shop offers them as sizes to choose from |
| Categories | Managed in the admin panel, up to three levels deep |
| Accounts | Browsing and cart need no account. Confirming a pre-order requires login |
| Cancellation | Customer may cancel until the order is dispatched. After dispatch only a return is possible. The cutoff is configuration |
| Orders per cargo | A customer can place several separate orders in one cargo (decided for Phase 4) |
| Changing an order | Not possible. The customer cancels while allowed and orders again (decided for Phase 4) |
| Prices | Entered and displayed including VAT. VAT breakdown on order documents and invoices |
| Delivery fee | Configurable steps in the admin panel (for example free from 50 euros). Nothing hardcoded |
| Delivery area | All of Germany, no postcode excluded (decided for Phase 4) |
| Delivery method | Chosen by the admin, never by the customer at checkout (decided for Phase 4). Delivery by Radhe Foods, DHL or Hermes; no pickup (decided for Phase 5) |
| Delivery status | Updated in bulk per cargo with exclusions. Every order keeps its own status and can be overridden |
| Less delivered than ordered | Not the normal way. The admin corrects the affected products afterwards; the final bill follows, the agreed delivery fee stays (decided for Phase 5) |
| Returns | Single products, every return decided by the admin (decided for Phase 5) |
| Cancelled cargo | Its orders are not cancelled but moved to the cargo the admin names (decided for Phase 5) |
| Payment methods | Stripe Checkout with card and PayPal (online, after delivery), and cash to the driver when Radhe Foods delivers. Not chosen at checkout (decided for Phase 6) |
| Payment activation | By the admin, per order or per cargo, with a deadline in days. Not automatic (decided for Phase 6) |
| Reminders | Every day until paid (decided for Phase 6) |
| Partial payments | Not offered (decided for Phase 6) |
| Refunds | Decided by the admin, through Stripe or by hand (decided for Phase 6) |
| Unpaid orders | An order that awaits payment does not stop new pre-orders (decided for Phase 4). An order past its deadline stops the confirmation of a new order, and nothing else; the admin can override (decided for Phase 6) |
| Invoices | Issued at activation, as PDF, in the email and in the account (decided for Phase 6) |
| Database | MongoDB Atlas, also for development. Automated tests use a database of their own |
| B2B | Out of scope until explicitly requested |
| Docker | Not used for now |

## 3. System overview

```text
Customer web (Next.js, Vercel) ─┐
                                ├─► NestJS API (Hostinger web hosting) ──► MongoDB Atlas (Frankfurt)
Admin app (Next.js, Vercel) ────┘          │                                 (data, and the notification queue)
Stripe ──── webhooks ──────────────────────┤
Cron job ── POST /v1/jobs/run ─────────────┤
                                           ├─► S3 + CloudFront (images)
                                           ├─► Amazon SES (email)
                                           └─► WhatsApp Cloud API (when configured)
```

- One NestJS **modular monolith**. No microservices.
- One process. It serves HTTP and runs the jobs: the cargo check, the payment jobs, the notification queue. Changed during Phase 7: a separate worker with Redis and BullMQ was planned; the hosting plan is shared hosting without Redis, and a pre-order shop sends a few thousand messages a month, so the queue is a MongoDB collection worked by the API itself. An external cron job calls `POST /v1/jobs/run` every five minutes, which keeps the process awake on shared hosting and the jobs on time.
- REST API, versioned, documented with OpenAPI. Both frontends use a client generated from the spec.

### Route groups

| Prefix | Audience | Auth |
|---|---|---|
| `/v1/store/*` | Customer web | Public or customer session |
| `/v1/admin/*` | Admin app | Admin session plus permission |
| `/v1/webhooks/*` | Stripe and other providers | Signature verification |
| `/v1/jobs/*` | An external timer | `X-Jobs-Token` header |
| `/v1/pay/:token`, `/v1/unsubscribe/:token` | Links in emails | The token itself |

## 4. Modules

| Module | Responsibility |
|---|---|
| `auth` | Email OTP, Google sign-in, admin login, sessions, guards |
| `customers` | Profiles, addresses, language, account status, blocking |
| `admin-users` | Admin accounts, roles, permissions |
| `catalog` | Products (SKUs), categories, translations, SEO fields |
| `media`, `storage` | Image validation and conversion; file storage behind a provider interface (S3, local folder) |
| `cargos` | Cargo cycles, scheduling, rollover, per-cargo product availability and limits |
| `storefront` | What customers see: the catalogue together with the answer whether each product can be ordered now. Owns no data |
| `cart` | Server cart for logged-in customers, price preview for anonymous carts, and the bill: totals, VAT, delivery fee |
| `orders` | Order placement with consent capture, status transitions, history, cancellation, delivery method and tracking, bulk updates per cargo, moving orders between cargos, corrections of delivered quantities, the final bill |
| `returns` | Return requests by the customer, decision and completion by the admin, credit on the order |
| `payments` | Activation with the invoice, Stripe Checkout and webhooks, cash, waiving, reminders and the overdue job, the overdue rule for new orders, credit notes after a changed bill, refunds through Stripe or by hand |
| `invoices` | Invoices and credit notes: numbers without gaps, immutable documents, PDF rendering |
| `notifications` | Every message to a customer: the queue in MongoDB, the dispatcher with retries, consent rules, templates per type and language, the WhatsApp provider, the admin's list and retry |
| `announcements` | News about a product or a cargo, sent by the admin to the customers who asked, by email and WhatsApp |
| `attention` | What waits for the admin, in one answer. Owns no data |
| `jobs` | Every scheduled job in one call, for an external timer. Owns no data |
| `legal` | Versioned terms and privacy documents |
| `settings` | Configurable business rules |
| `audit` | Record of admin actions (not built yet) |
| `reports` | Aggregations per cargo, product and period (not built yet) |

Rule: modules talk through their public services. Business modules never call an email or WhatsApp provider directly: they queue a message with the notifications module, which knows the consent of the customer and the channels. Changed during Phase 7: "domain events" became direct calls into `notifications`, which is below the business modules; an event bus added a layer without a second consumer.

Changed during Phase 4: a separate `checkout` module was planned. The bill moved into `cart` and order placement into `orders`, because the cart, the preview and the order must use one computation, and a third module between them added nothing.

Changed during Phase 5: a separate `delivery` module was planned. The way of an order is part of the order, so statuses, delivery method and bulk updates live in `orders`. Returns got a module of their own: they are a conversation between customer and admin that ends with one change on the order.

Rule: dependencies between business modules point one way.

```text
payments ──► invoices ──► notifications
   │            │
   ▼            ▼
returns ──► orders ──► cart ──► cargos ──► catalog
   └──────────┴──► notifications ──► customers, settings, mail
storefront ────────────────────► cargos ──► catalog
announcements ──► notifications, customers, catalog, cargos
```

`orders` also uses `customers`, `legal` and `settings`, and `cart` uses `settings`. `notifications` knows nothing about orders or invoices: it stores what it is given and renders it at send time; the invoices module registers with it how an invoice PDF is made, so a payment request can carry one. None of them knows about orders. Orders know nothing about returns or payments: payments register with orders what an overdue payment means for a new order, and what follows a changed bill (a credit note). The payment record itself lives on the order document, owned by the payments module.

The catalogue knows nothing about cargos, and cargos know nothing about orders. Where a module needs an answer from a module above it, that module registers the answer: this is how a product that is part of a cargo is protected from deletion, how a cargo with orders is protected from cancellation, how the orders of a cargo follow it when it delivers, and how they are given to another cargo when it is cancelled.

## 5. Data model

MongoDB Atlas with Mongoose. All collections have `createdAt` and `updatedAt`.

### General rules

- **Money** is an integer in cents. Never a float.
- **VAT rate** is stored in basis points (700 = 7%, 1900 = 19%).
- **Prices are gross.** VAT is derived per line: `vat = round(gross × rate / (10000 + rate))`.
- **Dates** are stored in UTC. Business deadlines are interpreted in `Europe/Berlin`.
- **Translatable fields** are objects: `{ en: "...", de: "..." }`.
- **Orders hold snapshots**, never live references, for anything shown to the customer.
- **Order placement and payment activation run in transactions.**

### Collections

| Collection | Key contents |
|---|---|
| `adminUsers` | email, password hash, TOTP secret, role, status |
| `customers` | email, name, phone, addresses, language, account status, Google ID, the ordering decision of the admin, communication preferences (WhatsApp number and yes, news yes, dated) |
| `customerSessions`, `adminSessions` | hashed refresh token, user, expiry, previous token hash for reuse detection |
| `otpChallenges` | email, keyed hash of the login code, attempts, expiry |
| `roles` | key, name, permission strings |
| `categories` | translated name and slug, parent, ancestors, sort order, visibility, image |
| `products` | one document per sellable pack size: SKU, translated name, slug and description, category and category path, pack size, pack-size group, regular and sale price, VAT rate, status (`draft`, `active`, `archived`), `isAvailable`, images, food information, SEO fields |
| `productPriceChanges` | one entry per price change of a product |
| `cargos` | number, names, order window, delivery window, operational status, payment status, payment dates, reminder settings, messages |
| `cargoProducts` | cargo, product, available flag, maximum quantity, reserved quantity |
| `carts` | customer, items |
| `orders` | see below |
| `orders.payment` | Part of the order: activation, deadline, invoice, invoiced / credited / paid / refunded amounts, amount due, method, Stripe and cash details, reminders, the hash of the payment link token (built in Phase 6; the separate `payments` collection of the first plan was not needed) |
| `paymentEvents` | Stripe event id (unique), type, processed flag, order, error; kept 90 days |
| `refunds` | number, order, customer, invoice, amount, reason, method (stripe, manual), status, Stripe refund id and status, manual way and reference, history |
| `returns` | return number, order, customer, cargo, status, items with requested and approved quantities and reasons, notes, credit amount, history |
| `notifications` | type, channel, recipient, customer, order, cargo, product, return, refund, announcement, language, the data it is rendered from, subject, attachments by reference, status, dedupe key, attempts, next attempt, lock, sent time, provider message id, last error, reason, history of attempts |
| `announcements` | subject and message per language, link, product, cargo, channels, recipients, queued, who sent it, cancelled |
| `legalDocuments` | type, version, translated title and content, status (`draft`, `published`), published date |
| `invoices` | number (per type and year, without gaps), type (invoice, credit note), order, customer, seller and customer as printed, lines, totals with VAT per rate, dates, language. Immutable; PDF rendered on request |
| `counters` | atomic sequences for order, cargo and invoice numbers |
| `settings` | delivery fee steps, cancellation policy, overdue blocking rule, defaults |
| `auditLogs` | actor, action, target, before and after |

Changed during Phase 4: the delivery fee is a setting with steps, not a collection of rules (`deliveryFeeRules`). One fee that depends on the value of the goods is all that is needed. Delivery addresses are part of the customer document.

Changed during Phase 5: delivery methods are a fixed list in code (`radhe_delivery`, `dhl`, `hermes`), not a collection (`deliveryMethods`). Three methods that the admin chooses need no management screen; the default for new orders is a setting.

### Order document

As built in Phases 4 and 5. Fields in brackets follow in later phases.

```text
orderNumber, type ("preorder"), customerId, cargoId, cargoCode
customer: { email, firstName, lastName, phone }            (snapshot)
items[]:
  productId, sku, name { en, de }, packValue, packUnit, imageKey
  quantity, unitPrice, regularUnitPrice, vatRate
  lineTotal, vatAmount                                     (agreed)
  deliveredQuantity, returnedQuantity
  finalLineTotal, finalVatAmount                           (charged)
totals:      subtotal, deliveryFee, total, netTotal, vatTotal,
             vat[]: { vatRate, gross, net, vat }           (agreed, never changes)
finalTotals: the same fields                               (after corrections and returns)
adjustments[]: { productId, sku, from, to, reason, note, adminId, at }
deliveryAddress (snapshot)
delivery: { method, trackingNumber, dispatchedAt, deliveredAt }
promisedDeliveryStart, promisedDeliveryEnd                 (of the cargo the order is in)
orderStatus, paymentStatus
language, customerNote
cancellation: { reason, text, by, adminId, at }
consent: { acceptedAt, documents[]: { type, version, documentId }, ip, userAgent }
statusHistory[]: { field ("order" | "payment" | "cargo" | "delivery"), from, to, at, by, adminId, note }
idempotencyKey
[accessToken (hashed, for the secure order link)]
```

### Important indexes

- `cargos`: partial unique index on `status = taking_orders`, so the database itself guarantees one active ordering cargo.
- `cargoProducts`: unique on `(cargoId, productId)`.
- `orders`: unique `orderNumber`; unique `(customerId, idempotencyKey)`, so the database itself guarantees one order per attempt; `(customerId, _id)`, `(cargoId, _id)`, `(cargoId, orderStatus, _id)`, `(orderStatus, _id)` for the lists and the bulk updates. `(cargoId, paymentStatus)` follows with payments.
- `returns`: unique `returnNumber`; `(orderId, _id)`, `(customerId, _id)`, `(status, _id)`.
- `orders`: `(cargoId, paymentStatus, _id)`, `(customerId, paymentStatus, payment.deadlineAt)`, `(paymentStatus, payment.deadlineAt)`, `(paymentStatus, payment.reminders.nextAt)` for the payment jobs and the overdue rule; sparse `payment.payLinkTokenHash` and `payment.stripe.paymentIntentId` for lookups.
- `invoices`: unique `number`; `(orderId, _id)`, `(customerId, _id)`, `(type, issuedAt)`.
- `refunds`: unique `refundNumber`; `(orderId, _id)`, `(status, _id)`, sparse `stripe.refundId`.
- `paymentEvents`: unique Stripe event id, which makes webhooks safe to receive twice.
- `notifications`: `(status, nextAttemptAt)` is the queue; unique sparse `dedupeKey` makes every event one message; `(customerId, _id)`, `(orderId, _id)`, `(status, _id)`, `(type, _id)`, sparse `(announcementId, status)` for the lists.
- `customers`: partial `(communication.marketingOptIn, _id)` on `true` for the recipients of an announcement.
- Indexes on optional fields are sparse, not partial with a `$type` filter: MongoDB uses a sparse index for a lookup by value, and does not use such a partial one.
- `products`: unique SKU; unique slug per language.

## 6. Status models

Each status field has its allowed transitions defined in one place in code. Every change is written to `statusHistory`.

### Cargo

| Field | Values |
|---|---|
| Operational status | `draft` → `scheduled` → `taking_orders` → `orders_closed` → `in_transit` → `arrived` → `delivering` → `delivered`; `cancelled` |
| Payment status | `not_active` → `active` → `remaining` → `completed` |

The business plan lists these as one sequence. They are split here so a cargo can be "delivering" for some orders while payment logic runs independently.

Built in Phase 3: the operational status. One step back is possible to correct a mistake, and a closed cargo can be opened again while its deadline lies ahead. The payment status follows with the payments phase.

### Order

| Field | Values |
|---|---|
| Order status | `confirmed` → `preparing` → `dispatched` → `delivered`; `delivery_failed`; `cancelled`; `returned` |
| Payment status | `not_enabled` → `due` → `paid`; `overdue`; `waived`; `refunded` |

Built in Phase 5: the order status. One step back is possible to correct a mistake. `delivery_failed` follows a dispatch and leads to a new dispatch, or to the next cargo. `returned` is set by a completed return that leaves nothing. `cancelled` has its own rules (Phase 4).

A failed payment attempt is recorded on the payment record. The order stays `due`, so the customer can retry.

## 7. Key flows

### 7.1 Placing a pre-order

As built in Phase 4.

1. Customer must be logged in. If not, the web app sends them to login and returns to checkout.
2. Request carries an idempotency key, the address, the total the customer saw, and the accepted versions of the legal texts. It carries no items and no prices: the order is made of the cart on the server.
3. If an order with this key exists, it is answered, and nothing else happens.
4. Checks, reading only:
   - The customer is not blocked, and the address is theirs.
   - The accepted legal texts are the current ones.
   - Find the cargo with status `taking_orders` whose order window includes the current time.
   - Every product is active, available, and available in this cargo, in the quantity asked for.
   - Prices come from the database. VAT, delivery fee and totals are computed.
   - The total is the one the customer saw.
5. Take the next order number.
6. In one transaction:
   - Reserve quantities with a conditional update, which fails if a limit would be exceeded.
   - Store the order with its snapshots and the consent record.
   - Empty the cart.
7. No payment is started.
8. From the notifications phase on: emit `order.confirmed`, and the notifications module sends the confirmation.

The order window is checked by time at step 4, so an order can never enter a closed cargo even if the rollover job runs late.

The checks of step 4 run before the transaction, so a transaction is short and rarely fails. What can change between step 4 and step 6 is the number of units left, and step 6 checks exactly that again, in the database.

The order number is taken outside the transaction. Inside, every order would have to wait for the one before it. The price is that a failed transaction leaves a gap in the numbers.

### 7.2 Cargo rollover

- An automatic check inside the API closes the cargo whose deadline has passed and opens the scheduled cargo whose time has come. It runs every hour on the hour, and once after every start.
- Admin can do the same by hand at any time, without waiting for the check.
- Both go through one function with one set of rules. It is safe to ask twice, or from two sides at once:
  - Asking for the status a cargo already has does nothing.
  - A status is written under the condition that it is still the one that was read.
  - A unique index lets the database refuse a second cargo that takes orders.
- The order deadline counts to the second for customers, whether or not the status was updated yet.
- A product can be ordered in a cargo only if the admin enabled it for that cargo. Limits are per product, and every pack size is a product.

### 7.3 Cancellation

- Customer may cancel while the order status is before `dispatched`. The cutoff is read from settings: `until_dispatched`, `while_confirmed` or `never`.
- Admin may cancel until the goods are delivered, with a reason.
- Cancelling releases the reserved quantity and keeps the order and its history. Both happen in one transaction, and only if the status is still the one that was read, so units are released once.
- After dispatch the customer uses the return process.
- A cargo with orders is cancelled only together with the cargo that takes its orders over. The orders move with their items, prices and bill; nothing is cancelled. Orders that are on their way already must be looked at first.

Built in Phases 4 and 5. An override of the cutoff per cargo was planned and is not built: nobody has asked for it yet.

### 7.4 Delivery updates

As built in Phase 5.

- The orders of a cargo follow the cargo: `delivering` dispatches the orders that are confirmed or preparing, `delivered` delivers the dispatched ones. The admin names the orders to leave out. Both are one write for the whole cargo.
- The same by hand, per cargo (`status`, `delivery-method`) or per order, at any time. One step back is possible.
- Every order carries its delivery method (chosen by the admin; the default is a setting), tracking number, and the times it was dispatched and delivered. The customer sees a link to the carrier.
- A failed delivery is recorded with a note. The order is dispatched again, or moved to the next cargo, where it is confirmed again with the delivery days of that cargo. Units move with it.
- The admin corrects delivered quantities per product, with a reason. The final bill (`finalTotals`) is recomputed from delivered minus returned units at the agreed prices; the agreed bill (`totals`) never changes; the agreed delivery fee stays, and is 0 only when nothing was kept.

### 7.4a Returns

As built in Phase 5.

1. The customer asks to send back single products of a delivered order, within the return window (a setting, 14 days by default), up to what was delivered and not asked back already.
2. The admin approves, as asked or with other quantities, or declines. The customer can take the request back until it is decided.
3. When the goods are back, the admin completes the return. The returned units are booked on the order and its final bill goes down, in one transaction; the return records the credit. When nothing is left, the order is `returned` and the delivery fee is credited too.
4. Paying the credit back, or collecting less, is the payments phase.

### 7.5 Payment activation

As built in Phase 6.

1. The admin activates payment for one delivered order, or for the delivered orders of a cargo (a batch of 100 per request; the admin app asks again while orders remain), with the deadline in days. Excluded, undelivered and already activated orders are left alone.
2. In one transaction: the invoice number is taken (per year, without gaps), the invoice is written from the final bill, and the order gets its payment record: status `due`, deadline at the end of the chosen day in German time, amount due, the time of the first reminder, the hash of the payment link token.
3. The customer is emailed the invoice as PDF with the amount, the deadline and the payment link. A failed email never fails the activation; the reminder of the next day follows.
4. Activation needs the details of the seller (company settings); it is refused until they are set.

### 7.6 Paying

As built in Phase 6.

- **Online:** the payment link in the email (`SHOP_URL/pay/<token>`, no login, pays one order and nothing else) or the order page in the account lead to a Stripe Checkout session for the full amount due, card or PayPal, in the language of the order, open for a set time; an open session is handed out again. Stripe confirms through the webhook (`checkout.session.completed`, or the asynchronous variants), verified with the signing secret; every event is recorded once. When the customer comes back before the webhook, the API asks Stripe about the session. The payment is booked by the payment intent, once, with card or PayPal, charge and receipt; the invoice is marked paid; the customer gets a receipt email.
- **Cash:** the admin records the full amount, the time and a note. Offered to the customer only when Radhe Foods delivers.
- **Waiving:** the admin lets the customer off what is owed, with a reason.
- **Credit notes:** a return completed or a correction after the invoice issues a credit note in the same transaction; what is owed goes down; an unpaid invoice with nothing left is settled by the credit note; on a paid invoice the credit is what to refund.
- **Refunds:** decided by the admin, full or partial up to what was paid. Through Stripe, asked at once with an idempotency key and complete when Stripe confirms (at once for cards, through `refund.updated` otherwise; a failure is recorded with Stripe's reason). By hand, recorded with the way and a reference and completed by the admin. The order carries the refunded amount and becomes `refunded` when everything went back. The customer is emailed.
- The payment status of a cargo (`completed`) of the first plan is not a field: the summary per cargo is computed from the orders.

### 7.7 Reminders and the overdue customer

As built in Phase 6.

- An hourly job marks payments past their deadline `overdue` and sends the reminders that are due: one per order per day at the reminder hour of the settings, from the day after activation, until the order is paid, waived or settled. The next time is written before the email goes out, so a reminder is never sent twice. The admin can pause, resume and send by hand.
- A customer with an overdue payment cannot confirm a new order (`PAYMENT_OVERDUE`, with the invoices to pay and their links). Browsing, the cart, the account, the documents and paying keep working. The moment the payment arrives, ordering is possible again.
- The admin can block ordering, allow it for a number of days although a payment is overdue, and clear the decision. Every decision carries a reason and the admin and is kept in the record of the customer.

## 8. Authentication

| User | Method |
|---|---|
| Customer | Email OTP: 6 digits, 10 minutes, 5 attempts, stored as a keyed hash in MongoDB, rate-limited per email and IP |
| Customer | Google sign-in, verified on the server, linked by verified email |
| Admin | Email and password (Argon2id) plus TOTP |

- Signing up and logging in are the same OTP flow.
- Login codes live in MongoDB with automatic expiry, not in Redis. This was changed during Phase 1 so that authentication needs no second data store; Phase 7 confirmed the choice by putting the job queue in MongoDB as well.
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

As built in Phase 7.

```text
Business module queues a message (type, customer, data, dedupe key)
→ notifications decides the channels from the consent of the customer and writes one record per channel
→ the dispatcher claims a queued record, renders it, sends it, records the outcome
→ a failure that can pass comes back in 1 min, 5 min, 30 min, 2 h, 12 h; a refusal fails at once
→ the admin sees every record, retries a failed one, cancels a queued one
```

- The record is the queue. Nothing waits in memory; a restart loses nothing; a record `sending` for more than ten minutes is queued again.
- Sending happens at once after queueing (a kick of the dispatcher) and every `NOTIFICATION_INTERVAL_SECONDS` for retries; in tests, before the request answers.
- Rendering at send time, from the data stored with the record, so a retry says the same thing and the admin sees what was said.
- Email always, for messages about the customer's own orders. WhatsApp for the few types worth a message on the phone (dispatch, payment request, reminder, news), to customers who gave a number and said yes. News (announcements) needs a yes of its own, by any channel, and carries an unsubscribe link that works without a login.
- Email and WhatsApp are adapters behind interfaces. Email: Amazon SES through its API, SMTP, or the console. WhatsApp: the Cloud API of Meta with approved templates, or a disabled adapter that records messages as skipped until credentials exist.
- Attachments are references (`invoice_pdf` with the invoice id); the module that owns the document makes the file when the message is sent.
- No separate admin channel: `GET /v1/admin/attention` and the lists show what needs a look.

## 11. Storage

- Private S3 bucket in Frankfurt, served through CloudFront. Setup: `AWS_S3_SETUP.md`.
- Images are uploaded to the API, which validates them, converts them to WebP in three sizes and stores only the converted files.
- The database stores object keys, not URLs.
- Every upload gets a new key, so stored files never change and are cached for a year.
- Invoice PDFs are not stored. An invoice is an immutable document in the database; its PDF is rendered on request, behind the login of the customer or the admin. Changed during Phase 6: a private bucket with signed URLs was planned, and is not needed for a one-page document that renders in about 50 ms.

Changed during Phase 2: the first plan was a direct upload from the browser to S3 with a presigned URL, converted later by a worker. Uploading through the API was chosen instead, for three reasons. The file is proven to be an image before anything is stored. No unconverted upload ever exists in the bucket. No worker or queue is needed. The cost is that the API handles the file, which is acceptable for a few admins uploading product photos. A presigned upload can be added later for large files.

## 12. Security

- Input validation on every endpoint; unknown fields rejected.
- Rate limiting on auth, checkout and payment endpoints.
- Stripe webhook signatures verified; events processed once.
- Prices, VAT, delivery fee and cargo are always determined on the server.
- Secure headers, strict CORS for the two frontend origins.
- Secrets only in environment configuration, validated at startup.
- Audit log for admin actions.
- No card data is stored.

## 13. Infrastructure

| Piece | Choice |
|---|---|
| API | Hostinger web hosting, Node.js web app, one process (changed in Phase 7; a VPS was the plan of Phase 3, Render the first plan). `doc/HOSTINGER_DEPLOYMENT.md` |
| Jobs | Timers inside the API, plus a cron job of the host that calls `POST /v1/jobs/run` every five minutes |
| Redis | Not used |
| Email | Amazon SES, Frankfurt. `doc/AWS_SES_SETUP.md` |
| WhatsApp | WhatsApp Cloud API of Meta, when configured. `doc/WHATSAPP_SETUP.md` |
| Database | MongoDB Atlas, Frankfurt, M10 for production |
| Files | S3 and CloudFront |
| Frontends | Vercel |
| Errors | Sentry, EU region |
| CI | GitHub Actions: lint, type check, tests |
| Environments | Local, staging, production |

## 14. Build order

1. Foundation: configuration, database, error format, logging, OpenAPI, health check.
2. Auth, customers, admin users.
3. Catalog, categories, media, translations.
4. Cargos, including per-cargo availability and limits.
5. Cart, checkout, orders, delivery fee rules.
6. Delivery updates and cancellation.
7. Payments: activation, Stripe, cash collection, reminders.
8. Notifications: the queue, every email, WhatsApp prepared, announcements, the attention overview.
9. Reports and dashboard endpoints, account deletion and export, housekeeping.

## 15. Open items

These do not block the start.

| Item | Needed before |
|---|---|
| Return process: who pays the way back. The steps and the refunds are built (Phases 5 and 6) | Launch |
| Products excluded from returns (food that spoils quickly), and the return window | Launch |
| Stripe account, PayPal switched on, branding of the payment page, webhook endpoint | Launch |
| Card disputes (chargebacks): recorded by hand for now | Later |
| VAT of the delivery fee: shared between the rates of the goods by net value. To be confirmed by the tax adviser | Launch |
| Legal review: button wording, terms, withdrawal right, invoices | Launch |
| WhatsApp business account and the approval of the four message templates | When WhatsApp is wanted |
| Amazon SES: domain verification, production access, IAM user | Launch |
| The plan: Hostinger's Business plan (Node.js web apps) or a VPS | Deployment |
