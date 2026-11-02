# Order reviews

For the Customer Web agent and the Admin Panel agent. What the Radhe Foods API does for reviews as of 2026-11-02: a customer reviews a **delivered order as a whole**, once, with stars and words; the admin reads the review; the shop then shows it among what customers say. Reviews are **not** about products: nothing is rated on a product card or a product page, and no product carries a rating.

This replaces the product reviews and the order feedback of 2026-11-01, which never reached production. Section 7 says what the deployment clears.

**Strict rule for both frontends:** do not change the theme, colours, fonts or typography. Everything below goes into the existing layouts and components.

## Contents

1. [Rules](#1-rules)
2. [Store API](#2-store-api)
3. [Errors](#3-errors)
4. [Shop integration](#4-shop-integration)
5. [Admin API](#5-admin-api)
6. [Panel integration](#6-panel-integration)
7. [Deployment notes](#7-deployment-notes)

---

## 1. Rules

- One review per order, for an order whose status is `delivered`. Unpaid, cancelled, confirmed, processing and dispatched orders cannot be reviewed; delivered orders are paid orders by construction.
- The review has two fields, both required: **"Your order"**, 1 to 5 stars, and **"Tell us about your experience"**, 10 to 2000 characters. Nothing else: no title, no delivery stars.
- Written once. The customer can neither change nor delete the review; only the admin deletes.
- Only the order's owner can review it: another customer's order answers `404 ORDER_NOT_FOUND`. Guests have no session and cannot review.
- Every review waits for the admin (`pending`). The admin publishes it (`published`, shown in the shop) or rejects it with a note the customer sees (`rejected`). The admin may answer a review in public and may delete it.
- The author is shown as the first name and the initial of the last name: "Priya S.". Closing the account deletes the person's reviews.

## 2. Store API

| Endpoint                                     | Auth     | Answer                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/store/reviews?page=&limit=&rating=` | none     | `{ items: [ public review ], page, limit, total, totalPages, summary: { average, count, distribution: { "1": 0, …, "5": 3 } } }`: the published reviews, newest first. `limit` up to 50, default 10. `rating` narrows to one number of stars; `summary` always counts all published reviews. 60 calls per minute per IP |
| `GET /v1/store/orders/{orderNumber}/review`  | customer | `{ review: own review \| null, canReview }`. `canReview` is true for a delivered order without a review                                                                                                                                                                                                                 |
| `POST /v1/store/orders/{orderNumber}/review` | customer | Body `{ rating: 1–5, text: "…", locale? }`. `201 { review }`, status `pending`. `409 REVIEW_NOT_POSSIBLE` while the order is not delivered, `409 REVIEW_ALREADY_WRITTEN` for the second attempt, `400 VALIDATION_FAILED` without stars or words                                                                         |
| `GET /v1/store/me/reviews`                   | customer | `{ items: [ own review ] }`, newest first, whatever the status                                                                                                                                                                                                                                                          |
| `GET /v1/store/me/reviews/reviewable`        | customer | `{ items: [ order summary ] }`: the delivered orders without a review, newest delivery first, as `GET /v1/store/orders` lists them (`orderNumber`, `status`, `itemCount`, `preview[]`, totals, dates). Up to 50                                                                                                         |

`locale` defaults to the `Accept-Language` header, as everywhere.

**Public review** (what everyone sees):

```json
{
  "id": "672f…",
  "rating": 4,
  "text": "Everything arrived fresh and well packed.",
  "locale": "en",
  "authorName": "Anna S.",
  "verifiedPurchase": true,
  "writtenAt": "2026-11-02T10:12:00.000Z",
  "publishedAt": "2026-11-02T14:30:00.000Z",
  "reply": { "text": "Thank you, Anna!", "at": "2026-11-02T15:00:00.000Z" }
}
```

`reply` is `null` without an answer. `verifiedPurchase` is always true: every review belongs to a delivered order.

**Own review** (the customer's, from the order and the account): the public review plus `orderNumber`, `status` (`pending`, `published`, `rejected`) and `rejectionNote` (the admin's note when rejected, else `null`).

The order detail (`GET /v1/store/orders/{orderNumber}`) does **not** carry the review. Read it with the review endpoint of the order.

## 3. Errors

| Code                     | Status | When                                                                        |
| ------------------------ | ------ | --------------------------------------------------------------------------- |
| `REVIEW_NOT_POSSIBLE`    | 409    | The order is not delivered (`details.status` says what it is)               |
| `REVIEW_ALREADY_WRITTEN` | 409    | The order has its review                                                    |
| `ORDER_NOT_FOUND`        | 404    | Not the customer's order, or an order that was given up unpaid              |
| `VALIDATION_FAILED`      | 400    | Stars missing or out of 1 to 5, words missing or shorter than 10 characters |
| `REVIEW_NOT_FOUND`       | 404    | Admin routes                                                                |

## 4. Shop integration

**Remove** what the product reviews brought: stars and counts on product cards and product pages, the reviews section of the product page, "Write a review" per product, and the "How was it?" feedback form with its delivery stars and "Anything to add? (optional)". None of these have an API any more.

**The review form** lives on the order detail of a delivered order. Read `GET /v1/store/orders/{orderNumber}/review` with the order:

- `canReview: true`: show the form. "Your order" with five stars (required) and "Tell us about your experience" as a text area (required, 10 to 2000 characters, count shown). Submit with `POST …/review`. On `201` show the review in place of the form with "Thank you. Your review will be shown once Radhe Foods has read it." On `409 REVIEW_ALREADY_WRITTEN` reload the review.
- `review` present: show the stars, the text, the date and a status badge: `pending` "Waiting for approval", `published` "Published", `rejected` "Not published" with `rejectionNote`. No edit, no delete.
- Not delivered and no review: show nothing about reviews.

**The account** gets a "Reviews" page: "Orders you can review" from `GET /v1/store/me/reviews/reviewable` (the order summary with a "Write a review" link to the order detail) and "Your reviews" from `GET /v1/store/me/reviews` with the status badge and the note. The sidebar needs no new count.

**"What our customers say"**: a section (home page, or a page of its own) from `GET /v1/store/reviews`: `summary.average` with the count ("4.6 of 5 from 128 orders"), the distribution bars if wanted, then the reviews with stars, the text, the author, the month of `publishedAt`, a "Verified order" mark, and the answer of Radhe Foods under a review when `reply` is set. Page with `page`; filter by `rating` if the section offers it. Show the section only while `summary.count > 0`.

**Texts** in English and German as the shop has them. Suggested German: "Ihre Bestellung", "Erzählen Sie uns von Ihrer Erfahrung", "Bewertung absenden", "Vielen Dank. Ihre Bewertung wird angezeigt, sobald Radhe Foods sie gelesen hat.", "Wartet auf Freigabe", "Veröffentlicht", "Nicht veröffentlicht", "Das sagen unsere Kunden", "Verifizierte Bestellung".

## 5. Admin API

| Endpoint                              | Body / query                                                                                                 | Answer                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `GET /v1/admin/reviews`               | `status`, `customerId`, `orderNumber`, `rating`, `limit`, `cursor`, `sort` (`createdAt`, `status`, `rating`) | `{ items, nextCursor }`                                                      |
| `GET /v1/admin/reviews/count`         | the same filters                                                                                             | `{ total }`                                                                  |
| `GET /v1/admin/reviews/{id}`          |                                                                                                              | `{ review }`                                                                 |
| `POST /v1/admin/reviews/{id}/approve` |                                                                                                              | `{ review }`, `published`; approving twice changes nothing                   |
| `POST /v1/admin/reviews/{id}/reject`  | `{ note }` (shown to the customer)                                                                           | `{ review }`, `rejected`; a published review is taken off the shop           |
| `POST /v1/admin/reviews/{id}/reply`   | `{ text }`                                                                                                   | `{ review }`, the answer shown under the review; answering again replaces it |
| `DELETE /v1/admin/reviews/{id}/reply` |                                                                                                              | `{ review }`                                                                 |
| `DELETE /v1/admin/reviews/{id}`       |                                                                                                              | `204`. The customer may review the order again afterwards                    |

**The review:** `id`, `orderId`, `orderNumber`, `customerId`, `customer` (`{ id, name, email, deleted }`; "Deleted account" for a closed account), `rating`, `text`, `locale`, `authorName`, `status`, `publishedAt`, `moderation { adminId, admin, at, note } | null`, `reply { text, adminId, admin, at } | null`, `writtenAt`, `updatedAt`.

**Permissions:** `reviews.read` to look, `reviews.manage` to decide, answer and delete. The attention overview (`GET /v1/admin/attention`) carries `reviews: { pending }`.

## 6. Panel integration

- **Reviews page** (sidebar entry, `reviews.read`): the list with the `status` filter (`pending` first by default), columns order (link to the order), customer (link), stars, text (clamped), author name, written at, status badge. `rating` and `orderNumber` filters if the page has room.
- **Review detail**: the full text, the order and the customer, the history (`moderation`, `reply`), and the actions by status: Approve, Reject (note required, the customer sees it), Reply (public, editable, removable), Delete (confirmation).
- **Order detail**: a "Review" box from `GET /v1/admin/reviews?orderNumber={orderNumber}`: the stars, the text, the status, a link to the review. Delivered orders without a review show nothing. The `feedback` block of the earlier prompt is gone.
- **Customer detail**: a "Reviews" tab from `GET /v1/admin/reviews?customerId={id}`.
- **Start page**: the attention card for `reviews.pending` stays.
- **Products**: nothing. No rating, no reviews tab.

## 7. Deployment notes

- Run `npm run db:indexes` after deploying. It builds the new indexes of `reviews` (unique `orderId`, `(customerId, _id)`, `(status, _id)`), drops the product-review indexes, and clears what the release of 2026-11-01 left: reviews with a `productId`, the `rating` field of products and the `feedback` block of orders. The live database held none of them on 2026-11-02.
- Permissions `reviews.read` and `reviews.manage` are unchanged.
- No new environment variables, no new emails.
