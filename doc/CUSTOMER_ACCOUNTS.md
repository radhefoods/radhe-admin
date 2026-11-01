# Customer accounts, guest checkout, wishlists, referrals, reviews and problem reports

For the Customer Web agent and the Admin Panel agent. What the Radhe Foods API does for the retail shop (`shop.radhefoods.de`) as of 2026-11-01 for: guest checkout, sign-up with an emailed code, closing an account, address labels, the account overview, unpaid orders, several wishlists per customer, the referral code, product reviews with order feedback, and problem reports after a delivery. The short forms are in `doc/CUSTOMER_WEB_API_DOCUMENTATION.md` (sections 1, 2, 3, 9, 16, 20 to 23) and `doc/ADMIN_API_DOCUMENTATION.md` (sections 4, 9, 15, 27 to 29).

**Strict rule for both frontends:** do not change the theme, colours, fonts or typography. Everything below goes into the existing layouts and components.

## Contents

1. [Sign-up with an emailed code](#1-sign-up-with-an-emailed-code)
2. [Guest checkout](#2-guest-checkout)
3. [Closing an account](#3-closing-an-account)
4. [Addresses with labels, and the account overview](#4-addresses-with-labels-and-the-account-overview)
5. [Orders nobody paid for](#5-orders-nobody-paid-for)
6. [Several wishlists](#6-several-wishlists)
7. [Referrals](#7-referrals)
8. [Product reviews and order feedback](#8-product-reviews-and-order-feedback)
9. [Problem reports](#9-problem-reports)
10. [What the admin sees](#10-what-the-admin-sees)
11. [Errors](#11-errors)
12. [Deployment notes](#12-deployment-notes)

---

## 1. Sign-up with an emailed code

The account is created only once the person has proven the email address with a six-digit code. Signing in afterwards needs no code; existing accounts count as verified.

| Step | Call | Answer |
| --- | --- | --- |
| 1. The form | `POST /v1/store/auth/signup` `{ firstName, lastName, email, password, locale?, referralCode? }` | `202 { email, validMinutes: 15, resendAfterSeconds: 60 }`. An email with the code goes out. `409 CUSTOMER_EMAIL_TAKEN` when the address has an account (not when it only has guest orders, see section 2). `400 PASSWORD_TOO_WEAK` as before. |
| 2. The code | `POST /v1/store/auth/signup/verify` `{ email, code }` | `201 { customer, accessTokenExpiresInSeconds, referral: { applied, reason } }`, the session cookies set as after a login. The welcome email follows. `400 SIGNUP_CODE_INVALID` with `details.attemptsLeft` for a wrong code; `400 SIGNUP_NOT_FOUND` when nothing waits for the address, the code expired, or the attempts are used up: start again at step 1. |
| Another code | `POST /v1/store/auth/signup/resend` `{ email }` | `204` whatever happened. A new code comes at most once a minute and three times per sign-up; the old code stops working. |

Rules: the code is six digits, valid for 15 minutes, five wrong attempts end the sign-up. A sign-up started again for the same address replaces the one before. Only a keyed hash of the code and the hashed password are stored, in `pendingSignups`, which empties itself. `referralCode` is the `ref` of a referral link (section 7); a code that does not count never fails the sign-up.

**Shop:** the sign-up form keeps its fields; after it, show a code field with "Resend code" (disabled for `resendAfterSeconds`) and "Start again". Treat `SIGNUP_NOT_FOUND` as "start again". The customer's `kind` is `registered` and `emailVerifiedAt` is set on every profile answer.

## 2. Guest checkout

A visitor orders with the cart from the browser, an address and an email, without an account. The order belongs to a **guest record** of that email (`kind: "guest"`, no password) and is opened with a **token** instead of a session. If the person registers with the same email later, the guest record becomes the account and the orders, invoices and the address are there.

### Before the checkout

Price the cart as today with `POST /v1/store/cart/preview`; it now takes `discountCode` too and answers the bill with `discount` (applied or `reason`), so a guest can enter a code on the checkout page.

### `POST /v1/store/guest/checkout`

No session. Header `Idempotency-Key` as for the account checkout. Rate limit 10 per minute per IP.

```json
{
  "email": "gita@example.com",
  "items": [{ "variantId": "66f2…", "quantity": 2 }],
  "address": { "firstName": "Gita", "lastName": "Guest", "company": null, "street": "Hauptstraße", "houseNumber": "12a", "additionalLine": null, "postalCode": "60311", "city": "Frankfurt am Main", "countryCode": "DE", "phone": "+4915112345678" },
  "discountCode": "DIWALI10",
  "expectedTotal": 1297,
  "consent": { "accepted": true, "versions": { "terms": 3, "privacy": 2 } },
  "note": "Please ring twice.",
  "language": "de"
}
```

`address` has the fields of a saved address without `label` and `isDefault`. `language` defaults to `Accept-Language`.

**Success:** `201 { created: true, token, order, checkout: { url, expiresAt } }` (`200` with `created: false` when the key was seen before). `order` is the order detail of section 9.2 of the customer documentation, with `isGuest: true`. **Keep `token`**: every other guest call needs it, and it is in the links of every email about the order. Redirect to `checkout.url`.

**Errors:** `409 CUSTOMER_EMAIL_TAKEN` with `details.action: "sign_in"` (the address has an account: offer the sign-in, keep the cart), `403 CUSTOMER_BLOCKED`, and the errors of the account checkout (`ORDER_TOTAL_CHANGED`, `ORDER_ITEMS_NOT_ORDERABLE`, `LEGAL_VERSION_CHANGED`, `DISCOUNT_NOT_APPLICABLE`, `PAYMENTS_NOT_CONFIGURED`).

### The guest order

The token goes in the query (`?token=…`) or in the header `X-Order-Token`. Without it, or with the wrong one, every call answers `403 ORDER_TOKEN_INVALID`; an order that does not exist or was given up unpaid answers `404 ORDER_NOT_FOUND`.

| Call | Answer |
| --- | --- |
| `GET /v1/store/guest/orders/{orderNumber}` | `{ order, payment, documents[] }`: the order detail, the payment block (with `canPayOnline`, `checkout`), the invoices and credit notes with `pdfPath` (add `?token=` to it). Asks Stripe about an open payment page first, so it is right when the customer comes back from paying. |
| `POST /v1/store/guest/orders/{orderNumber}/pay` | `{ url, expiresAt }`: a payment page for an order that still waits. `409 ORDER_NOT_PAYABLE` otherwise. |
| `POST /v1/store/guest/orders/{orderNumber}/cancel` `{ reason, text? }` | `{ order }`. The same rule as for an account (`canCancel`). |
| `GET /v1/store/guest/orders/{orderNumber}/invoices/{number}/pdf` | The PDF. |

**The way back from Stripe** leads to `/guest/orders/<orderNumber>?token=<token>&payment=success|cancelled`. The emails about the order (confirmation with the invoice, dispatched, delivered, payment failed, refund, returns, problem reports) link to `/guest/orders/<orderNumber>?token=<token>`. The shop needs that page; it is the account order page without the sidebar, reading everything from the guest endpoint. Returns and problem reports are not offered to guests from the shop (the endpoints need a session); the emails tell them to reply.

### Later: the account

When the guest signs up (section 1) with the same email, the guest record becomes the account in place: `kind` turns `registered`, the password is set, and `GET /v1/store/orders`, `GET /v1/store/invoices` and `GET /v1/store/me/addresses` show what the guest ordered and where. The token links keep working. A guest cannot sign in and gets no password-reset email: the shop's login page says "Create an account" for them, which it does anyway when the login fails.

## 3. Closing an account

`POST /v1/store/me/delete` `{ "password": "…", "confirm": true }` → `204`, the session cookies cleared.

- `401 CUSTOMER_CREDENTIALS_INVALID` for a wrong password; `400 VALIDATION_FAILED` without `confirm: true`.
- `409 CUSTOMER_HAS_OPEN_ORDERS` with `details { orderNumbers[], openReturns, openIssues }` while an order waits for its payment, its delivery (confirmed, processing, dispatched) or a refund, or a return or a problem report is open. The shop shows the numbers and says to wait or to contact Radhe Foods.
- Afterwards: every session is revoked, the record keeps its id but loses email (replaced by `deleted:<id>`), name, phone, addresses, preferences, password, referral code; cart, wishlists, reviews and the referral records of the person are deleted. Orders, invoices, credit notes, returns and reports stay for the books, pointing at the anonymised record. A goodbye email goes to the old address. The email address is free for a new account at once. There is no undo.

**Shop:** in Settings, a "Delete account" section with the password field, a checkbox, and the irreversible-warning text; on `204`, sign the customer out and go to the home page. **Panel:** section 10.

## 4. Addresses with labels, and the account overview

- Every address has an optional `label` (up to 30 characters, any words: "Home", "Work", "Mummy"). Send it on `POST`/`PATCH /v1/store/me/addresses`; `null` removes it. The address object carries `label` (or `null`) before `firstName`. Default handling is unchanged (`POST …/{id}/default`, `isDefault`).
- `GET /v1/store/me/overview` answers everything the account page shows at a glance:

```json
{
  "customer": { "…profile…" },
  "memberSince": "2025-03-01T10:00:00.000Z",
  "counts": { "orders": 12, "openOrders": 1, "invoices": 24, "wishlists": 3, "wishlistItems": 4, "addresses": 3, "openIssues": 0 },
  "defaultAddress": { "…address…" } ,
  "referral": { "code": "K7Q3XM9P", "link": "https://shop.radhefoods.de/?ref=K7Q3XM9P", "counts": { "registered": 2, "qualified": 1 } },
  "locale": "en"
}
```

`orders` counts the orders the customer sees (unpaid orders that were given up are not among them); `openOrders` the ones confirmed, processing or dispatched. The screenshot's "Radhe Points", "Subscriptions" and "Rewards" have no API yet: leave those tiles out or show them without numbers.

## 5. Orders nobody paid for

- An order may be paid for **72 hours** after the checkout (`pendingUntil`). The payment page expiring does not shorten that; "Pay now" opens a new one.
- When the time is up and nothing was paid, the order is **deleted** by the cleanup job (`POST /v1/jobs/run`, also run by the API itself). If the page was paid at the last moment, the order is settled instead.
- An unpaid order the customer (or the admin) cancels is hidden from the customer at once: it is not in `GET /v1/store/orders`, and its detail answers `404`. The cleanup deletes it once it is 72 hours old. The admin sees it until then (section 10).
- A paid order that is cancelled stays as it is: visible, with the refund.
- The answer of the cleanup is `{ expired, settled, purged }`.

**Shop:** after `POST …/cancel` of an unpaid order, go to the orders list instead of reloading the order. Treat `404` on an order page as "this order is gone".

## 6. Several wishlists

Every customer has one **default** list, the one the heart on a product adds to, and may have up to 20 lists under names of their own (unique per customer, whatever the case; up to 40 characters). Each list holds up to 200 products, one entry per product with the remembered pack size, as before.

The old routes keep working and address the **default list**: `GET /v1/store/wishlist`, `PUT`/`DELETE /v1/store/wishlist/items/{productId}`, `DELETE /v1/store/wishlist`, `POST /v1/store/wishlist/merge` (into the default list), `POST /v1/store/wishlist/preview` (visitors, unchanged). Their answer now starts with `wishlist: { id, name, isDefault, count, createdAt, updatedAt }` before `items` and `count`. Lists from before this change are read as the default list, named "My Favourites" / "Meine Favoriten" on first use.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /v1/store/wishlists` | | `{ items: [ { id, name, isDefault, count, createdAt, updatedAt } ] }`, the default first |
| `POST /v1/store/wishlists` | `{ name, isDefault? }` | `201 { wishlist }`; `409 WISHLIST_NAME_TAKEN`, `400 WISHLIST_LIMIT_REACHED` |
| `GET /v1/store/wishlists/{id}` | | the list: `{ wishlist, items, count }` |
| `PATCH /v1/store/wishlists/{id}` | `{ name?, isDefault? }` (`isDefault: true` makes it the default; `false` is ignored) | `{ wishlist }` |
| `DELETE /v1/store/wishlists/{id}` | | `204`. Deleting the default makes the oldest remaining list the default; without any list, a fresh default appears on the next look |
| `PUT /v1/store/wishlists/{id}/items/{productId}` | `{ variantId? }` | the list |
| `DELETE /v1/store/wishlists/{id}/items/{productId}` | | the list |
| `POST /v1/store/wishlists/{id}/items/{productId}/transfer` | `{ to, copy? }` | this list afterwards. Moves the product to list `to`, or copies it with `copy: true`; a product that is on `to` already stays as it is there; `404 PRODUCT_NOT_FOUND` when it is not on this list |
| `DELETE /v1/store/wishlists/{id}/items` | | the emptied list |

`404 WISHLIST_NOT_FOUND` for a list of somebody else. Visitors still keep one list in the browser and merge it into the default list after sign-in.

**Shop:** the heart keeps calling the old routes. The wishlist page gets a list chooser (the default marked), "New list", rename, "Make default", delete with a confirmation, and on every product "Move to…" / "Copy to…". Show `wishlist.name` as the page title.

## 7. Referrals

Every registered account has a code (8 letters and digits, made on first request) and a link `https://shop.radhefoods.de/?ref=<code>`.

- `GET /v1/store/me/referral` → `{ referral: { code, link, counts: { registered, qualified }, invitees: [ { name, email (masked, "ra***@example.com"), status, registeredAt, qualifiedAt } ] } }`. `name` and `email` are `null` once the invited person closed the account.
- The shop reads `ref` from the URL on any page, keeps it (local storage or a cookie, say 30 days), and sends it as `referralCode` with the sign-up. The verify answer says `referral: { applied: true | false, reason }` with `reason` ∈ `unknown_code`, `own_code`, `already_customer` (the person paid for an order as a guest before), `already_referred`. Show a small line on success.
- A referral is `registered` at the sign-up, `qualified` when the invited person's **first delivered order** stands with nothing to refund, and `void` (with `voidReason: "refunded"`) when all the goods of that order are credited afterwards. Guests, blocked and deleted accounts cannot refer; a person is referred once; nobody can use their own code.
- Rewards are not part of this yet: the records are what a reward will rest on.

## 8. Product reviews and order feedback

### Reviews

One review per customer and product, for a product of a **delivered** order. Every review waits for the admin before the shop shows it; a published review that is rewritten waits again. The rating of a product is the average of its published reviews, with one decimal, and comes with every product in the catalogue: `rating: { average, count }` or `null` on list entries and product pages.

| Endpoint | Auth | Answer |
| --- | --- | --- |
| `GET /v1/store/products/{productId}/reviews?page=&limit=&rating=` | none | `{ items: [ { id, rating, title, text, locale, authorName, verifiedPurchase: true, publishedAt, editedAt, reply: { text, at } \| null } ], page, limit, total, totalPages, summary: { average, count, distribution: { "1": 0, …, "5": 3 } } }`, published reviews only, newest first |
| `GET /v1/store/me/reviews` | customer | own reviews with `productId`, `product { id, slug, name, imageUrl }`, `orderNumber`, `status` (`pending`, `published`, `rejected`), `rejectionNote` |
| `GET /v1/store/me/reviews/reviewable` | customer | `{ items: [ { product, orderNumber, deliveredAt, review \| null } ] }`: every product of a delivered order, newest delivery first, with what was written for it so far |
| `PUT /v1/store/me/reviews/{productId}` | customer | `{ review }`. Body `{ rating 1–5, title?, text (10–2000), orderNumber?, locale? }`. `403 REVIEW_NOT_ALLOWED` when no delivered order has the product |
| `DELETE /v1/store/me/reviews/{productId}` | customer | `204` |

`authorName` is the first name and the initial of the last name ("Priya S."). `productId` is the product's `id`, not a pack size.

**Shop:** stars and the count on cards and product pages from `rating`; a "Reviews" section on the product page from the public endpoint; "Write a review" on the order detail of a delivered order and in the account ("Reviews" page from `reviewable` and `mine`), with the status badge and the rejection note. German and English texts as the shop has them.

### Order feedback

`POST /v1/store/orders/{orderNumber}/feedback` `{ rating 1–5, deliveryRating? 1–5, comment? }` → `201 { feedback }`. Once per delivered order: `409 FEEDBACK_ALREADY_GIVEN`, `409 FEEDBACK_NOT_POSSIBLE` before the delivery. The order detail carries `feedback` (or `null`) and `canGiveFeedback`. Never public; the admin sees it on the order.

## 9. Problem reports

After a delivery, a customer reports what went wrong with the order: the products concerned with the units affected, the problems, a description, up to five photos, and what they would like. Radhe Foods looks and makes it right. A refund goes **through the order**: the delivered quantity is corrected, the credit note is issued, and the refund waits in the refund queue, the way a return does.

- Possible for a delivered order within `issueWindowDays` of the return policy (default 14, settable by the admin; `GET /v1/store/settings` answers `returns: { windowDays, issueWindowDays }`), at most five reports per order.
- Problems: `damaged`, `missing`, `wrong_item`, `not_fresh`, `late`, `other`. Wishes (`preferredResolution`): `refund`, `replacement`, `none` (just telling). The screenshot's "Radhe Points" option is left out until rewards exist.
- Statuses: `open` (nobody looked yet; the customer can take it back and add photos), `in_review` (the admin is on it; photos can still be added), `resolved` (see `resolution`), `rejected` (see the note), `cancelled` (taken back).
- Emails to the customer: when the report is received, resolved, or rejected.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /v1/store/orders/{orderNumber}/issues` | | `{ items, window: { possible, until }, reportable: [ { productId, variantId, sku, available } ] }` (`available` = delivered and kept) |
| `POST /v1/store/orders/{orderNumber}/issues` | `{ items?: [ { variantId, quantity } ], problems: [ … ], description (10–2000), preferredResolution, locale? }`; `items` may be left out for a problem with the delivery as a whole | `201 { issue }`; `409 ISSUE_NOT_POSSIBLE`, `409 ISSUE_WINDOW_CLOSED`, `409 ISSUE_QUANTITY_INVALID`, `400 ORDER_ITEM_NOT_FOUND` |
| `POST /v1/store/issues/{issueNumber}/images` | multipart, field `files`, JPEG/PNG/WebP, up to five per report in all | `201 { issue }`; `400 IMAGE_LIMIT_REACHED`, `400 IMAGE_INVALID` |
| `DELETE /v1/store/issues/{issueNumber}/images/{imageId}` | | `{ issue }` |
| `GET /v1/store/issues` | | `{ items }`, own reports, newest first |
| `GET /v1/store/issues/{issueNumber}` | | `{ issue }` |
| `POST /v1/store/issues/{issueNumber}/cancel` | | `{ issue }`; `409 ISSUE_TRANSITION_NOT_ALLOWED` once the admin is on it |

The report as the customer sees it: `issueNumber` ("RF-1084-P1"), `orderNumber`, `status`, `reportedAt`, `decidedAt`, `items[] { productId, variantId, sku, name, packSize, quantity, refundedQuantity, unitPrice }`, `problems`, `description`, `images[]` (as product images: `id`, `url`, `sizes`), `preferredResolution`, `resolution { type, amount (cents credited), note, at } | null`, `history[] { status, at, by, note }`, `canCancel`, `canAddImages`.

**Shop:** the "Report a problem" page of the screenshot from the order detail: steps 1 to 3 as drawn (items with a counter up to `available`, the problem chips, the text, the photos), step 4 with the three wishes minus the points. Create the report, then upload the photos, then show the report page with its history. A "Reports" list in the account, and the "Previous reports" box on the order.

## 10. What the admin sees

- **Customers:** `kind` (`registered`, `guest`), `emailVerifiedAt`, `status` now also `deleted` with `deletedAt`, `referralCode`, `referredBy`. Filters `kind` and `status=deleted` on the list. A deleted account shows `email: "deleted:<id>"` and empty personal fields: display it as "Deleted account" everywhere, including where orders, returns, reports, refunds and notifications name their customer (`customer.deleted: true`, `customer.name: "Deleted account"`, `customer.email: null`). `PATCH …/status` on a deleted account answers `409 CUSTOMER_DELETED`.
- **Orders:** `isGuest` on summaries and details; `feedback` on the detail. Unpaid orders that were given up stay in the admin list (status `cancelled`, `paidAmount: 0`) until the cleanup deletes them after 72 hours; an order that nobody paid for is deleted outright when its 72 hours are up.
- **Referrals:** `GET /v1/admin/referrals?status=&referrerId=&referredId=&limit=&cursor=&sort=` and `GET /v1/admin/referrals/count`, permission `customers.read`. Each: `{ id, status, code, referrerId, referrer, referredId, referred, registeredAt, orderId, orderNumber, qualifiedAt, voidReason, voidAt }`.
- **Reviews:** `GET /v1/admin/reviews?status=&productId=&customerId=&rating=`, `GET …/count`, `GET …/{id}` (`reviews.read`); `POST …/{id}/approve`, `POST …/{id}/reject { note }`, `POST …/{id}/reply { text }`, `DELETE …/{id}/reply`, `DELETE …/{id}` (`reviews.manage`). The attention overview carries `reviews.pending`.
- **Problem reports:** `GET /v1/admin/issues?status=&orderNumber=&customerId=`, `GET …/count`, `GET …/{id}` (`orders.read`); `POST …/{id}/review { note?, internalNote? }`, `POST …/{id}/resolve { resolution: "refund" | "replacement" | "none", items?: [ { variantId, quantity } ], note?, internalNote? }`, `POST …/{id}/reject { note, internalNote? }` (`orders.manage`). A refund corrects the order's delivered quantities (reason from the problems: `missing`, `wrong_item`, `damaged`, else `customer_complaint`; note "Problem report RF-1084-P1"), which issues the credit note and puts the refund in the queue of section 11 of the admin documentation. `resolution.amount` is what was credited. The attention overview carries `issues: { open, items }`.
- **Settings:** `PUT /v1/admin/settings/return-policy { windowDays, issueWindowDays? }`; `issueWindowDays` defaults to `windowDays`.

## 11. Errors

| Code | Status | When |
| --- | --- | --- |
| `SIGNUP_CODE_INVALID` | 400 | Wrong code; `details.attemptsLeft` |
| `SIGNUP_NOT_FOUND` | 400 | No sign-up waits, the code expired, or the attempts are used up |
| `CUSTOMER_EMAIL_TAKEN` | 409 | At sign-up: the address has an account. At the guest checkout: `details.action: "sign_in"` |
| `ORDER_TOKEN_INVALID` | 403 | The token does not open this guest order |
| `CUSTOMER_HAS_OPEN_ORDERS` | 409 | The account cannot be deleted yet; `details { orderNumbers, openReturns, openIssues }` |
| `CUSTOMER_DELETED` | 409 | The admin tries to change a deleted account |
| `WISHLIST_NOT_FOUND`, `WISHLIST_NAME_TAKEN`, `WISHLIST_LIMIT_REACHED` | 404, 409, 400 | Named lists |
| `REVIEW_NOT_ALLOWED` | 403 | No delivered order has the product |
| `REVIEW_NOT_FOUND` | 404 | Admin routes |
| `FEEDBACK_ALREADY_GIVEN`, `FEEDBACK_NOT_POSSIBLE` | 409 | Order feedback |
| `ISSUE_NOT_FOUND` | 404 | |
| `ISSUE_NOT_POSSIBLE` | 409 | Not delivered, or five reports already |
| `ISSUE_WINDOW_CLOSED` | 409 | After `issueWindowDays`, or reports switched off |
| `ISSUE_QUANTITY_INVALID` | 409 / 400 | More than delivered and kept; or nothing to refund |
| `ISSUE_TRANSITION_NOT_ALLOWED` | 409 | The step is not possible from the current status |

## 12. Deployment notes

- Run `npm run db:indexes` after deploying: new collections (`pendingSignups`, `referrals`, `reviews`, `issues`), new indexes on `customers`, `orders` and `wishlists`, and the old unique index on `wishlists.customerId` is dropped. The run also sets `kind: "registered"` on the accounts from before.
- New permissions `reviews.read` and `reviews.manage`: grant them to the roles that moderate.
- The emails of the new flows: sign-up code, account deleted, problem report received / resolved / rejected. No new environment variables. Customer photos are stored under `catalog/support/issues/<id>/` in the bucket, which the S3 policy allows.
