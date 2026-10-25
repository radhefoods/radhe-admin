# Wholesale quotations (B2B)

The wholesale site (`https://radhefoods.de`) sells by the carton to shops, restaurants and other businesses. A business customer picks products and cartons, leaves their details and asks for a quotation. The admin prices the request in the admin panel and sends the quotation by email, with a PDF. This document has the workflow, every endpoint with examples, the emails, and what the wholesale site and the admin panel have to do.

Base URL and conventions (errors, validation, pagination) are the ones of `doc/ADMIN_API_DOCUMENTATION.md` section 0 and `doc/CUSTOMER_WEB_API_DOCUMENTATION.md` section 0. Amounts are **cents**; prices in a quotation are **net per carton, excluding VAT**.

## Contents

1. The workflow
2. Cartons on pack sizes (admin catalogue)
3. The wholesale site: catalogue API (`/v1/b2b/categories`, `/v1/b2b/products`)
4. The wholesale site: submitting a request (`POST /v1/b2b/quotations`)
5. The admin panel: quotation management (`/v1/admin/quotations`)
6. Emails and the PDF
7. Statuses, rules, errors, permissions
8. Integration requirements (wholesale site, admin panel, server)

---

## 1. The workflow

```text
Wholesale site                       API                                 Admin panel
──────────────                       ───                                 ───────────
GET /v1/b2b/products  ◄──────────── products with cartons
"Add to quotation" (in the browser)
POST /v1/b2b/quotations ──────────► quotation  status: new  ──────────► Decisions tab: "Quotation requests: 1"
                                    ├─ email "We received your request" ──► requester
                                    └─ email "New quotation request"  ──► company email (settings)
                                                                         PATCH /v1/admin/quotations/{id}
                                    status: draft  ◄─────────────────── prices per carton, totals shown
                                                                         POST /v1/admin/quotations/{id}/send
                                    status: sent, revision 1
                                    └─ email "Your quotation" + PDF ───► requester
                                                                         POST …/accept | …/decline | …/cancel
                                    status: accepted | declined | cancelled
```

- The site keeps the "quotation basket" in the browser (local storage). The API sees the request once, at submit.
- Prices come only from the admin. The wholesale site shows no prices.
- A price changed after sending makes the quotation a `draft` again; the next `send` is **revision 2** with the email "Your updated quotation". `resend` sends the same revision once more on purpose. Nothing is ever sent twice by accident: `send` on a quotation that is `sent` answers `409`.

---

## 2. Cartons on pack sizes (admin catalogue)

A pack size (variant) of a product gets an optional **`unitsPerCarton`**: how many packs make a carton (20 packs of 1 kg = a carton of 20 kg). Only pack sizes with a carton are offered on the wholesale site; a product with no such pack size is not listed there. Everything else about products (name, images, category, VAT rate) is shared with the retail shop.

- `POST /v1/admin/products`, `POST /v1/admin/products/{id}/variants`, `PATCH /v1/admin/products/{id}/variants/{variantId}`: field `unitsPerCarton` (integer 1–1000; `null` removes it).
- Every admin product answer shows per variant: `unitsPerCarton` (number or `null`) and `carton` (`{ units, label, content }` or `null`), for example `{ "units": 20, "label": "20 × 1 kg", "content": { "value": 20, "unit": "kg", "label": "20 kg" } }`. The content is in kg or l from 1000 g / 1000 ml on, in pieces for `pcs`.
- CSV import/export: column `units_per_carton` (pack-size column; empty leaves it, `0` removes it). See `doc/CSV_IMPORT_EXPORT.md`.
- The retail shop's answers do not change.

---

## 3. The wholesale site: catalogue API

Public, no authentication. English by default; `?locale=de` or `Accept-Language` chooses German where the texts exist. Answers are cacheable for a minute (categories: five).

### `GET /v1/b2b/categories`

Categories that have at least one product by the carton, in display order, with counts (sub-categories count toward their parents).

```json
{
  "items": [
    { "id": "66f1…", "slug": "rice", "name": "Rice", "parentId": null, "level": 1, "productCount": 12 },
    { "id": "66f2…", "slug": "basmati", "name": "Basmati", "parentId": "66f1…", "level": 2, "productCount": 7 }
  ]
}
```

### `GET /v1/b2b/products`

| Query | Meaning |
|---|---|
| `q` | Words of the name, article number or search keywords |
| `category` | Slug of a category; its sub-categories are included. Unknown: `404 CATEGORY_NOT_FOUND` |
| `brand` | One or more brands (`brand=Daawat&brand=India%20Gate`), exactly as the products name them |
| `sort` | `name` (default) or `newest` |
| `page`, `limit` | Pages; `limit` 1–100, default 24 |
| `locale` | `en` (default) or `de` |

```json
{
  "items": [
    {
      "id": "66f3…",
      "slug": "daawat-original-basmati-rice",
      "slugs": { "en": "daawat-original-basmati-rice", "de": "daawat-original-basmati-reis" },
      "name": "Daawat Original Basmati Rice",
      "subtitle": "Classic Aged Basmati",
      "shortDescription": "Aged for two years.",
      "brand": "Daawat",
      "category": { "id": "66f1…", "slug": "rice", "name": "Rice" },
      "storageType": "ambient",
      "tags": ["vegan"],
      "isAvailable": true,
      "image": { "id": "…", "alt": "…", "isPrimary": true, "small": "https://cdn.…/small.webp", "medium": "…", "large": "…" },
      "cartons": [
        {
          "variantId": "66f4…",
          "sku": "DW-00041",
          "packSize": { "value": 1, "unit": "kg", "label": "1 kg" },
          "units": 20,
          "label": "20 × 1 kg",
          "content": { "value": 20, "unit": "kg", "label": "20 kg" }
        },
        { "variantId": "66f5…", "sku": "DW-00042", "packSize": { "value": 5, "unit": "kg", "label": "5 kg" }, "units": 4, "label": "4 × 5 kg", "content": { "value": 20, "unit": "kg", "label": "20 kg" } }
      ],
      "cartonCount": 2
    }
  ],
  "page": 1, "limit": 24, "total": 37, "totalPages": 2
}
```

- `cartons` lists the pack sizes sold by the carton, smallest pack first. **`variantId` is what a request names.**
- `isAvailable: false` means the product is switched off in the catalogue; show it as "currently not available" and do not let it be added.
- No prices anywhere. The `image` is the main picture of the product in three widths (same shape as the retail shop, `doc/CUSTOMER_WEB_API_DOCUMENTATION.md`).

### `GET /v1/b2b/products/{slug}`

One product by its slug (or the slug of one of its pack sizes). The list item plus `description`, `highlights[]`, `uses[]`, `images[]` (main picture first), `food { ingredients, allergens, nutrition, storageInstructions, origin, manufacturer }`, `seo { title, description }`. `404 PRODUCT_NOT_FOUND` when the product does not exist, is not active, or has no pack size by the carton.

---

## 4. The wholesale site: submitting a request

### `POST /v1/b2b/quotations`

Public. **At most 5 requests per hour per IP address** (`429 RATE_LIMITED` beyond that). The site's origin must be in the API's `CORS_ORIGINS` (it is: `https://radhefoods.de`, `https://www.radhefoods.de`).

**Request body**

```json
{
  "contact": {
    "name": "Priya Sharma",
    "company": "Sharma Supermarkt",
    "email": "priya@sharma-markt.de",
    "phone": "+49 69 1234567",
    "city": "Frankfurt am Main"
  },
  "message": "Delivery on Tuesdays please.",
  "items": [
    { "variantId": "66f4…", "cartons": 3 },
    { "variantId": "66f5…", "cartons": 2 }
  ],
  "privacyAccepted": true,
  "website": ""
}
```

| Field | Rules |
|---|---|
| `contact.name` | 2–120 characters |
| `contact.company` | 2–160 characters |
| `contact.email` | A valid email address; stored lower-case |
| `contact.phone` | 5–40 characters |
| `contact.city` | 2–120 characters |
| `message` | Optional, up to 2000 characters |
| `items[]` | 1–50 lines; `variantId` from the catalogue, `cartons` 1–10000; a `variantId` at most once |
| `privacyAccepted` | Must be `true` (the privacy checkbox) |
| `website` | **Honeypot.** Render it hidden (CSS, not `type=hidden`) and never fill it. Any value makes the API drop the request with `400` |

**Answers**

- `201` with the request as saved, `duplicate: false`. The confirmation email to the requester and the heads-up to the company are queued.
- `200` with `duplicate: true` and the request created earlier: the **same email with the same pack sizes and cartons within ten minutes**. No second email goes out. Show the same thank-you page.

```json
{
  "quotation": {
    "id": "6700…",
    "number": "Q-2026-0001",
    "status": "new",
    "contact": { "name": "Priya Sharma", "company": "Sharma Supermarkt", "email": "priya@sharma-markt.de", "phone": "+49 69 1234567", "city": "Frankfurt am Main" },
    "message": "Delivery on Tuesdays please.",
    "items": [
      {
        "id": "6701…",
        "productId": "66f3…",
        "variantId": "66f4…",
        "sku": "DW-00041",
        "name": "Daawat Original Basmati Rice",
        "brand": "Daawat",
        "packSize": { "value": 1, "unit": "kg", "label": "1 kg" },
        "carton": { "units": 20, "label": "20 × 1 kg", "content": { "value": 20, "unit": "kg", "label": "20 kg" } },
        "cartons": 3
      }
    ],
    "cartons": 5,
    "submittedAt": "2026-10-25T09:12:00.000Z"
  },
  "duplicate": false
}
```

**Errors**

| Status | Code | When | `details` |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | A field is missing or malformed, `privacyAccepted` is not `true` | `errors[]` |
| 400 | `QUOTATION_ITEMS_INVALID` | A pack size is unknown or not sold by the carton (or the product is inactive), a `variantId` repeats, or the honeypot was filled | `items: [{ variantId, reason: "not_found" \| "not_offered" }]` or `repeated: [variantId]` |
| 403 | `ORIGIN_NOT_ALLOWED` | The request came from a browser origin not in `CORS_ORIGINS` | |
| 429 | `RATE_LIMITED` | More than 5 requests in an hour from one address | |

Show `not_found` / `not_offered` lines as "no longer available, please remove it" and let the visitor submit again.

---

## 5. The admin panel: quotation management

All under `/v1/admin/quotations`, with the admin cookie session. **Permissions:** `quotations.read` to see and download, `quotations.manage` to price, send and close.

### `GET /v1/admin/quotations`

| Query | Meaning |
|---|---|
| `status` | `new`, `draft`, `sent`, `accepted`, `declined`, `cancelled` |
| `q` | Searches the number, the company, the contact name and the email |
| `sort` | `newest` (default), `updated`, `company` |
| `page`, `limit` | Pages, `limit` default 24 |

Answer: `{ items: [summary], page, limit, total, totalPages }`. **Summary:**

```json
{
  "id": "6700…",
  "number": "Q-2026-0001",
  "status": "draft",
  "contact": { "name": "Priya Sharma", "company": "Sharma Supermarkt", "email": "priya@sharma-markt.de", "phone": "+49 69 1234567", "city": "Frankfurt am Main" },
  "itemCount": 3,
  "cartons": 7,
  "pricedLines": 2,
  "totals": null,
  "revision": 0,
  "sentAt": null,
  "firstSentAt": null,
  "sentCount": 0,
  "pricedAt": "2026-10-25T10:02:00.000Z",
  "closedAt": null,
  "updatedBy": { "id": "…", "name": "Vrushabh" },
  "sentBy": null,
  "closedBy": null,
  "createdAt": "2026-10-25T09:12:00.000Z",
  "updatedAt": "2026-10-25T10:02:00.000Z"
}
```

`totals` is `null` until every line has a price; then `{ cartons, net, vat: [{ vatRate, net, vat, gross }], vatTotal, gross }` in cents (`vatRate` 700 = 7 %).

### `GET /v1/admin/quotations/{id}`

```json
{
  "quotation": {
    "…summary…": "",
    "message": "Delivery on Tuesdays please.",
    "consent": { "acceptedAt": "2026-10-25T09:12:00.000Z", "ip": "203.0.113.7", "userAgent": "Mozilla/5.0 …" },
    "locale": "en",
    "items": [
      {
        "id": "6701…",
        "productId": "66f3…",
        "variantId": "66f4…",
        "sku": "DW-00041",
        "name": "Daawat Original Basmati Rice",
        "brand": "Daawat",
        "packSize": { "value": 1, "unit": "kg", "label": "1 kg" },
        "carton": { "units": 20, "label": "20 × 1 kg", "content": { "value": 20, "unit": "kg", "label": "20 kg" } },
        "cartons": 3,
        "vatRate": 700,
        "unitPrice": 8000,
        "lineTotal": 24000
      }
    ]
  },
  "notifications": [
    { "id": "…", "type": "quotation_sent", "channel": "email", "to": "priya@sharma-markt.de", "status": "sent", "subject": "Your quotation Q-2026-0001 from Radhe Foods", "attachments": [{ "kind": "quotation_pdf", "id": "6700…" }], "sentAt": "…", "attempts": 1, "lastError": null, "quotationId": "6700…" },
    { "type": "quotation_request_admin", "to": "info@radhefoods.de", "status": "sent", "…": "" },
    { "type": "quotation_received", "to": "priya@sharma-markt.de", "status": "sent", "…": "" }
  ]
}
```

`notifications` are the emails about this quotation, newest first, in the shape of section 13 of the admin reference (`status` `queued`, `sending`, `sent`, `failed`, `skipped`; `lastError`; `history`). A `failed` email can be retried with `POST /v1/admin/notifications/{id}/retry` as any other.

### `GET /v1/admin/quotations/{id}/pdf`

The quotation as a PDF (`application/pdf`, `Content-Disposition: inline; filename="Q-2026-0001.pdf"`), exactly what the customer gets. Works in any status: unpriced lines show "–" and the totals read "Prices to be confirmed". Open it in a new tab (`window.open` with credentials: the cookie goes along on the same site).

### `PATCH /v1/admin/quotations/{id}` (save prices)

```json
{
  "items": [
    { "id": "6701…", "unitPrice": 8000 },
    { "id": "6702…", "unitPrice": 7500, "cartons": 2 }
  ]
}
```

- `unitPrice`: net price per carton in cents, 1–10,000,000. `cartons`: a corrected quantity, 1–10000. Only the lines sent change; others keep what they have. Send the lines the admin edited, or all of them.
- Allowed in `new`, `draft` and `sent`. The quotation becomes **`draft`** (from `sent`: the next send is a revision). `pricedAt` and `updatedBy` are set.
- A line with a price gets `lineTotal`; once every line has one, `totals` appears.
- Answer: `{ quotation, notifications }` as the detail.
- Errors: `404 QUOTATION_ITEM_NOT_FOUND` (`details.id`), `409 QUOTATION_STATUS_INVALID` (accepted, declined, cancelled).

### `POST /v1/admin/quotations/{id}/send`

From `new` or `draft`, with every line priced. The quotation becomes `sent`, `revision` counts up (1 the first time), `sentAt`, `firstSentAt`, `sentBy`, `sentCount` are set, and the email with the PDF is queued. Answer `200 { quotation, notifications }`.

- `400 QUOTATION_NOT_PRICED` with `details.unpriced: [itemId]` when a line has no price.
- `409 QUOTATION_STATUS_INVALID` when it is `sent` already (message: change a price for a revision, or resend), or closed.

### `POST /v1/admin/quotations/{id}/resend`

From `sent`: the same revision once more (a customer lost the email). `sentCount` counts up, `sentAt` is now. `409 QUOTATION_STATUS_INVALID` otherwise.

### `POST /v1/admin/quotations/{id}/accept`, `POST …/decline`

From `sent`: records that the customer ordered, or did not. `closedAt`, `closedBy`. No email. `409 QUOTATION_STATUS_INVALID` otherwise.

### `POST /v1/admin/quotations/{id}/cancel`

From `new`, `draft` or `sent`: withdrawn, spam, no longer wanted. No email. Closed quotations cannot be cancelled (`409`).

### The Decisions tab

`GET /v1/admin/attention` (section 15 of the admin reference) now has a group `quotations: { new: 2, items: [summary, …] }`: requests in `new`, the newest five. Link to the list with `?status=new`.

---

## 6. Emails and the PDF

All emails use the shared Radhe Foods layout (logo, company footer from the settings). English only. They are queued in the notifications module: retries on failure, one message per event (`dedupeKey`), listed on the quotation and under Notifications in the panel.

| Event | Type | To | Subject | Content |
|---|---|---|---|---|
| Request submitted | `quotation_received` | requester | `We received your quotation request Q-2026-0001` | Thank you; the lines (name, carton, cartons); request number; cartons; the message; "we usually reply within one business day" |
| Request submitted | `quotation_request_admin` | the company email of the settings (`PUT /v1/admin/settings/company`, field `email`) | `New quotation request Q-2026-0001 from Sharma Supermarkt` | Contact details, the lines, the message, a button to the quotation in the panel (`<ADMIN_URL>/quotations/{id}`) when `ADMIN_URL` is set |
| Quotation sent | `quotation_sent` | requester | `Your quotation Q-2026-0001 from Radhe Foods`; revision 2+: `Your updated quotation …` | A table (product with SKU and carton, cartons, net price per carton, net amount), net total, VAT per rate, total including VAT, the note "prices per carton and net of VAT", the PDF attached |

If the company email is empty in the settings, the heads-up is skipped and a warning is logged; the request still shows on the Decisions tab.

**The PDF** (`Q-2026-0001.pdf`, A4): the seller (name, address, logo from the company settings), "Prepared for" with the company, contact, city, email and phone, the number, date, request date and (from revision 2) the revision, the table of lines (No., product with SKU and carton, cartons, per carton, VAT, amount), net total, VAT per rate, total including VAT, cartons, the terms ("prices per carton and net of VAT; delivery arranged at the order"), and the footer with VAT id, tax number and register from the settings on every page. Drawn when the email is sent and whenever the admin opens `…/pdf`, always from the stored quotation.

---

## 7. Statuses, rules, errors, permissions

**Statuses**

| Status | Meaning | Next |
|---|---|---|
| `new` | Arrived; no price yet | `draft` (first price), `cancelled` |
| `draft` | Being priced; may be fully priced and ready | `sent`, `cancelled` |
| `sent` | Quotation emailed (revision ≥ 1) | `draft` (price changed), `sent` (resend), `accepted`, `declined`, `cancelled` |
| `accepted` | The customer ordered | final |
| `declined` | The customer did not order | final |
| `cancelled` | Withdrawn, spam, not wanted | final |

**Rules**

- Numbers: `Q-<year>-<0001>`, per year, in the business time zone (`BUSINESS_TIMEZONE`).
- The lines copy the product's name, brand, pack size, carton and VAT rate at the request; later catalogue changes do not alter a quotation.
- Line amount = cartons × net price per carton. VAT is added per rate on the net sum of that rate, rounded once per rate (as on invoices). Gross = net + VAT.
- Duplicate protection: same email + same lines within 10 minutes → the existing request. Honeypot field `website`. 5 submissions per hour per IP. Consent required and recorded with IP and user agent.
- Sending: `send` only from `new`/`draft` with all lines priced; a `sent` quotation needs a price change (revision) or `resend`. Each send is one notification with its own dedupe key; the queue never sends one twice.
- The PDF is rendered from the stored quotation at sending time, so a retry attaches the same document.

**Error codes** (added to the admin reference 17.3): `400 QUOTATION_ITEMS_INVALID`, `400 QUOTATION_NOT_PRICED`, `404 QUOTATION_NOT_FOUND`, `404 QUOTATION_ITEM_NOT_FOUND`, `409 QUOTATION_STATUS_INVALID` (`details.status`, `details.allowed`).

**Permissions:** `quotations.read`, `quotations.manage`. The super admin has both through the wildcard; grant them to other roles under Roles.

**Data:** collection `quotations` (number, status, contact, consent, items with prices, totals, revision and send data, closed data, fingerprint, search words). Notifications about a quotation carry `quotationId`. Indexes: unique `number`; `(status, _id)`; `(fingerprint, _id)`; `(contact.email, _id)`; `searchTokens`; on `notifications`, sparse `(quotationId, _id)`. Run `npm run db:indexes` after deploying.

---

## 8. Integration requirements

**Wholesale site (radhefoods.de)**

- Read `GET /v1/b2b/categories` and `GET /v1/b2b/products` for the product grid, the category chips, the search box and the "cartons per pack size" modal; `GET /v1/b2b/products/{slug}` for "View product details".
- Keep the quotation basket in the browser: `{ variantId, cartons }` per line, plus the product name, SKU, carton label and content for display. Weight shown on the site = sum of `cartons × content.value` per line (in kg/l/pcs, from `content.unit`).
- "Request quotation" posts `POST /v1/b2b/quotations` with the contact form, the message, the lines, `privacyAccepted: true` and the hidden honeypot `website` left empty. On `201` or `200 duplicate: true`: thank-you page with the `number`, clear the basket. On `400 QUOTATION_ITEMS_INVALID`: mark the named lines and ask to remove them. On `429`: ask to try again later.
- The API answers in English by default. Nothing else is needed: no account, no key.

**Admin panel**

- A "Quotations" section: list with status filter and search; detail with the contact, the message, the lines with editable price per carton and cartons, the totals, the status actions (Save prices, Send, Resend, Accept, Decline, Cancel), the PDF button and the email history. Decisions tab: a "Quotation requests" card from `attention.quotations`. Catalogue: an "Packs per carton" field on each pack size.
- Permissions `quotations.read` / `quotations.manage` in the roles form.

**Server**

- No new environment variables. `ADMIN_URL` (already present) gives the button in the heads-up email its link; the route is `<ADMIN_URL>/quotations/{id}`.
- The company email, address, VAT id and logo come from Settings → Company (`PUT /v1/admin/settings/company`); the heads-up goes to that email, and the PDF prints those details.
- `CORS_ORIGINS` must contain the wholesale site's origin (it does).
- Run `npm run db:indexes` after deploying (new collection and index).
