# Radhe Foods – Admin API Documentation

For the Next.js Admin Panel. Generated from the implemented NestJS backend (`radhe-api`); every route, field, status and error below exists in the code as of 2026-10-16. Customer-facing APIs are documented separately in `CUSTOMER_WEB_API_DOCUMENTATION.md`.

**What the admin panel manages:** the catalogue (categories, products with pack sizes, images and stock), orders and their way to the customer (processing, dispatch with tracking, delivery, corrections, cancellations), returns, payments (invoices and credit notes, refunds), customers, notifications to customers, announcements, settings, legal texts, admin users and roles.

**How the shop sells:** a customer puts products in the cart and pays at checkout through Stripe (card or PayPal). The payment confirms the order: the stock is taken, the money is captured, the invoice is issued and the customer gets the confirmation with the PDF. The admin then prepares, dispatches and delivers the order. Nothing is reserved before the payment, no order is confirmed by hand, and every refund is a decision of the admin.

## Contents

0. Conventions (base URL, responses, errors, auth, cookies, permissions, pagination, formats)
1. Admin authentication (login with two-factor)
2. Admin users
3. Roles and permissions (RBAC)
4. Customers
5. Settings
6. Legal texts
7. Categories
8. Products, stock and images (8.2: CSV import and Excel export of the catalogue)
9. Orders
10. Returns
11. Payments and refunds
12. Invoices and credit notes
13. Notifications
14. Announcements ("Notify customers")
15. Attention overview (start page)
16. Jobs endpoint and Stripe webhook (server-side, not for the panel UI)
17. Reference: enums, state machines, permission matrix, error codes
18. Prepared but not yet active
19. Answers to the requests of the panel (2026-10-14)

---

## 0. Conventions

### 0.1 Base URL and versioning

- Admin routes are under `/v1/admin/...`. Health: `/health` (no version). Interactive OpenAPI docs: `<API>/docs` (development only), JSON at `<API>/docs/openapi.json`.
- Local development: `http://localhost:3000`; production: the API domain (for example `https://api.radhefoods.de`).

### 0.2 Requests and responses

- JSON bodies (`Content-Type: application/json`), except image uploads (`multipart/form-data`).
- Validation is strict: **unknown fields are rejected** (`400 VALIDATION_FAILED`, "property X should not exist"). Strings are trimmed; an empty optional string counts as not provided. `null` is only accepted where documented (it clears the field: `description` of a role, `note` of a legal text, `parentId` of a category, `salePrice`, `discountPercent`, `lowStockThreshold`, `variantOf`, `gtin`, `brand` and `maxOrderQuantity` of a product, `trackingNumber` of an order).
- No response envelope: each endpoint returns the documented object (`{ product }`, `{ items, page, … }`, …). `204` = empty body.
- Optional header `X-Request-Id` (8–64 chars `[A-Za-z0-9_-]`); every response carries `x-request-id`. Show it on unexpected errors.
- `POST` answers `201` when something was created, `200` otherwise (documented per endpoint).

### 0.3 Error format

```json
{
  "error": {
    "code": "ADMIN_PERMISSION_DENIED",
    "message": "You do not have permission to do this.",
    "details": { "required": ["orders.manage"] }
  },
  "requestId": "3f0c1a2e-8b1d-4c2e-9f3a-1b2c3d4e5f60"
}
```

- `code` is stable; `message` is English for developers. `details` only for some codes (documented per endpoint). For `VALIDATION_FAILED`: `[{ "field": "tiers.0.fee", "problems": ["fee must not be less than 0"] }]`.
- Common codes on every admin route: `401 AUTH_TOKEN_INVALID` (no or expired access token), `401 AUTH_SESSION_REVOKED` (session ended: signed out elsewhere, role changed, password reset…), `403 ADMIN_ACCOUNT_DISABLED`, `403 ADMIN_PASSWORD_CHANGE_REQUIRED` (see 1.9), `403 ADMIN_PERMISSION_DENIED` (`details.required`), `403 ORIGIN_NOT_ALLOWED` (mutation from an unknown origin), `400 VALIDATION_FAILED` (also for a malformed `:id`: "The id in the URL is not valid."), `429 RATE_LIMITED`, `404 NOT_FOUND` (unknown route), `500 INTERNAL_ERROR`.
- Guards run before validation: an auth/permission error comes before a validation error.

### 0.4 Authentication and cookies

Cookie based, like the shop, with separate admin cookies:

| Cookie | Purpose | Path | Lifetime |
| ------ | ------- | ---- | -------- |
| `rf_admin_access` | Access token (JWT), sent with every request | `/` | 15 minutes |
| `rf_admin_refresh` | Refresh token, sent **only** to `/v1/admin/auth/*` | `/v1/admin/auth` | 12 hours, extended on every refresh, at most 72 hours in total |

Attributes: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Domain` = the configured cookie domain. Tokens are never returned in a body. The guards also accept `Authorization: Bearer <access token>` (useful when a Next.js server component forwards the cookie value).

**What the Next.js admin app must do**

1. `fetch(url, { credentials: 'include' })` on every call; host the panel on an origin in the API's `CORS_ORIGINS` (dev: `http://localhost:3002`).
2. On `401 AUTH_TOKEN_INVALID`: `POST /v1/admin/auth/refresh` once, retry; on `401 AUTH_REFRESH_INVALID` show login. On `401 AUTH_SESSION_REVOKED` show login (no refresh will help).
3. Unlike the customer guard, the admin guard checks the session in the database on **every** request, so sign-out, role changes and account changes take effect immediately.
4. After login, read `admin.permissions` (section 1) and hide what the admin may not do; the API enforces it anyway.
5. Rate limits: 120 requests per minute per IP overall; 10 per minute on login/MFA/change-password, 30 on refresh.

### 0.5 Permissions (RBAC)

Every admin route requires a permission string (listed per endpoint). An admin's role grants a list of permissions; `*` grants everything, `orders.*` grants every `orders.` permission. `read` and `manage` are independent: `orders.manage` does **not** imply `orders.read` — give both. The system role `super_admin` (`["*"]`) always exists and cannot be edited. The full list: `GET /v1/admin/roles/permissions`.

### 0.6 Locale

Admin endpoints return **both** languages for translated fields (`{ "en": "...", "de": "..." }`, `de` may be absent or `null`) so they can be edited; labels such as pack-size labels are English. There is no `locale` parameter on admin routes.

### 0.7 Data formats

| Kind | Representation |
| ---- | -------------- |
| IDs | 24-hex ObjectId strings. |
| Human numbers | Orders `RF-1084`, returns `RF-1084-R1`, refunds `RF-1084-RF1`, invoices `INV-2026-000123`, credit notes `CN-2026-000007`, SKUs `RF-00042`. |
| Money | Integer **cents**, EUR, VAT included. `vatRate` in hundredths of a percent (`700` = 7 %). |
| Date-times | ISO 8601 UTC strings. Inputs accept ISO strings. |
| Images | Absolute `https` WebP URLs in three sizes (section 8.1). |

### 0.8 Pagination

- **Page/limit** (products): `?page=1&limit=24` → `{ items, page, limit, total, totalPages }` (`page` 1–500, `limit` 1–100).
- **Cursor** (customers, orders, returns, refunds, invoices, notifications, announcements, stock movements): `?limit=25&cursor=<nextCursor>` → `{ items, nextCursor }`, newest first, `nextCursor: null` on the last page (`limit` 1–100, default 25). The cursor is an opaque string: pass it back unchanged, with the same filters and the same `sort`; a cursor of another sort answers `400 VALIDATION_FAILED`.
- **Sorting** (customers, orders, returns, refunds, notifications; stock movements by `createdAt` only): `?sort=<field>:<asc|desc>`, default `createdAt:desc`. The fields are listed per endpoint; an unknown field answers `400 VALIDATION_FAILED` with the allowed names in `details`.
- **Counting** (customers, orders, returns, refunds, notifications): `GET …/count` with the same filters as the list answers `{ "total": 42 }`. `limit`, `cursor` and `sort` are ignored. A list answer carries no `total`: call `/count` once when the number is shown.
- Small lists (admin users, roles, categories, legal texts) are returned whole.

### 0.9 Names next to ids

Wherever a record carries the id of an admin or a customer, the answer carries the person as well, looked up when the answer is built:

- next to `adminId`: `"admin": { "id", "name" } | null` (histories of orders, returns and refunds; adjustments and cancellations of orders; stock movements);
- next to `createdBy` / `cancelledBy` of an announcement and `createdBy` of a refund: the same object under `createdByAdmin`, `cancelledByAdmin`;
- next to `customerId` of a return, a refund or a notification: `"customer": { "id", "name": "Priya Shah" | null, "email" } | null`; the `customer` of an order summary carries `name` as well.

`null` when there is no id, or no person with that id any more. The names come without a permission of their own: an admin who may read orders sees who handled them.

---

## 1. Admin authentication

Email + password, then a 6-digit code from an authenticator app (TOTP, RFC 6238). Two-factor is **required** for every admin (`ADMIN_MFA_REQUIRED=true`): an admin without an authenticator is asked to enrol at first login.

### 1.1 The admin object (`admin` in login/me answers)

```json
{
  "id": "66f1a2b3c4d5e6f7a8b9c0f3",
  "email": "admin@radhefoods.de",
  "name": "Owner",
  "status": "active",
  "roleId": "66f1a2b3c4d5e6f7a8b9c0a1",
  "role": { "key": "super_admin", "name": "Super Admin", "permissions": ["*"] },
  "mfaEnabled": true,
  "mustChangePassword": false,
  "lastLoginAt": "2026-09-20T08:00:00.000Z",
  "createdAt": "2026-09-01T10:00:00.000Z",
  "updatedAt": "2026-09-20T08:00:00.000Z"
}
```

`role` is included by login, MFA verify, refresh, `me`, and the admin-user list/detail; it is **absent** in the answers of create/update admin user.

### `POST /v1/admin/auth/login`

**Purpose:** Step 1 of the login.

**Authentication:** none. Rate limit 10 per minute.

**Request Body:**

```json
{ "email": "admin@radhefoods.de", "password": "…" }
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `email` | string | yes | email, ≤254 |
| `password` | string | yes | 1–128 |

**Success Response (200)**, one of three:

```json
{ "status": "mfa_required", "mfaToken": "<jwt, 10 minutes>" }
```

```json
{ "status": "mfa_setup_required", "mfaToken": "<jwt, 10 minutes>" }
```

```json
{ "status": "authenticated", "admin": { "…admin object…": "" }, "accessTokenExpiresInSeconds": 900 }
```

`authenticated` directly (cookies set) only happens when two-factor is switched off on the server; with the required setting the answer is always one of the first two.

**Possible Errors:**

- `401 ADMIN_CREDENTIALS_INVALID` – unknown email or wrong password (5 wrong attempts lock the account for 15 minutes).
- `429 ADMIN_ACCOUNT_LOCKED` – `details: { retryAfterSeconds }`.
- `403 ADMIN_ACCOUNT_DISABLED`.
- `400 VALIDATION_FAILED`, `429 RATE_LIMITED`.

### `POST /v1/admin/auth/mfa/setup`

**Purpose:** Enrolment: get the secret for the authenticator app (after `mfa_setup_required`). Show `otpauthUrl` as a QR code and `secret` as text.

**Authentication:** none (the `mfaToken` is the key). Rate limit 10 per minute.

**Request Body:** `{ "mfaToken": "…" }`

**Success Response (200):**

```json
{
  "secret": "JBSWY3DPEHPK3PXP…",
  "otpauthUrl": "otpauth://totp/Radhe%20Foods%20Admin:admin%40radhefoods.de?secret=…&issuer=Radhe+Foods+Admin&algorithm=SHA1&digits=6&period=30"
}
```

**Possible Errors:** `401 ADMIN_MFA_TOKEN_INVALID` (expired/invalid token, or two-factor already set up).

### `POST /v1/admin/auth/mfa/verify`

**Purpose:** Step 2: the authenticator code. Completes the login (and, after `mfa/setup`, activates the authenticator).

**Authentication:** none (`mfaToken`). Rate limit 10 per minute.

**Request Body:**

```json
{ "mfaToken": "…", "code": "123456" }
```

`code`: exactly 6 digits (current code; the previous/next 30-second step is accepted, a code cannot be reused).

**Success Response (200)** + cookies set:

```json
{ "status": "authenticated", "admin": { "…admin object…": "" }, "accessTokenExpiresInSeconds": 900 }
```

**Possible Errors:**

- `401 ADMIN_MFA_TOKEN_INVALID` – token expired (10 minutes) or invalid: start again at login.
- `401 ADMIN_MFA_CODE_INVALID` – wrong or reused code (counts towards the lockout).
- `400 ADMIN_MFA_SETUP_REQUIRED` – no secret pending/active for this token: call `mfa/setup` first.
- `429 ADMIN_ACCOUNT_LOCKED`, `403 ADMIN_ACCOUNT_DISABLED`.

### `POST /v1/admin/auth/refresh`

**Purpose:** New access cookie with the refresh cookie (rotated).

**Authentication:** `rf_admin_refresh` cookie. No body. Rate limit 30 per minute.

**Success Response (200):** `{ "admin": { …admin object… }, "accessTokenExpiresInSeconds": 900 }` (no `status` field).

**Possible Errors (cookies cleared):** `401 AUTH_REFRESH_INVALID`, `403 ADMIN_ACCOUNT_DISABLED`.

### `POST /v1/admin/auth/logout`

**Purpose:** Sign out on this device; cookies cleared. **Authentication:** none required. **Success Response:** `204`.

### `POST /v1/admin/auth/logout-all`

**Purpose:** Sign out everywhere. **Authentication:** any signed-in admin (allowed while a password change is pending). **Success Response:** `204`.

### `GET /v1/admin/auth/me`

**Purpose:** The signed-in admin with role and permissions. Call on app start.

**Authentication:** any signed-in admin (allowed while a password change is pending).

**Success Response (200):** `{ "admin": { …admin object with role… } }`

### `POST /v1/admin/auth/change-password`

**Purpose:** Change own password. Signs out all **other** devices. Clears `mustChangePassword`.

**Authentication:** any signed-in admin (allowed while a password change is pending). Rate limit 10 per minute.

**Request Body:**

```json
{ "currentPassword": "…", "newPassword": "…" }
```

`newPassword`: 12–128 characters, must differ from the current one.

**Success Response:** `204`.

**Possible Errors:** `401 ADMIN_CREDENTIALS_INVALID` (wrong current password; counts towards the lockout), `400 VALIDATION_FAILED`.

### 1.9 Forced password change

New admins and admins whose password was reset get a temporary password and `mustChangePassword: true`. Login works, but every admin route except `GET /v1/admin/auth/me`, `POST /v1/admin/auth/change-password` and `POST /v1/admin/auth/logout-all` answers `403 ADMIN_PASSWORD_CHANGE_REQUIRED`. The panel should route such an admin straight to the change-password screen.

### 1.10 Login flow for the panel

1. `login` → on `mfa_required` ask for the code → `mfa/verify`. On `mfa_setup_required` → `mfa/setup` → show QR → ask for the first code → `mfa/verify`.
2. Store `admin` (permissions) in app state; if `mustChangePassword`, go to the change-password screen.
3. On app load `GET /v1/admin/auth/me`; `401` = signed out.

---

## 2. Admin users

Accounts of the people who use the panel. Creating one sets a temporary password that must be changed at first login.

### `GET /v1/admin/admin-users`

**Purpose:** All admin users, newest first (max 200, no pagination).

**Permission:** `admin_users.read`.

**Success Response (200):** `{ "items": [ { …admin object with role… } ] }`

### `POST /v1/admin/admin-users`

**Purpose:** Create an admin user with a temporary password.

**Permission:** `admin_users.manage`.

**Request Body:**

```json
{ "email": "colleague@radhefoods.de", "name": "Colleague", "temporaryPassword": "temporary-pass-123", "roleId": "66f1a2b3c4d5e6f7a8b9c0a1" }
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `email` | string | yes | email, ≤254 |
| `name` | string | yes | 1–120 |
| `temporaryPassword` | string | yes | 12–128; must be changed at first login |
| `roleId` | ObjectId | yes | |
| `sendInvitation` | boolean | no | default `true`: the new admin is emailed the temporary password and the link to the panel (`ADMIN_URL` of the server); `false` when the inviting admin hands it over in person |

**Success Response (201):** `{ "admin": { …admin object without role, "mustChangePassword": true… }, "invitationSent": true | false }`. `invitationSent` is `false` when `sendInvitation` was `false` or the email could not be sent; the account exists either way.

**Possible Errors:** `404 ROLE_NOT_FOUND`, `409 ADMIN_EMAIL_TAKEN`, `400 VALIDATION_FAILED`.

### `GET /v1/admin/admin-users/{id}`

**Permission:** `admin_users.read`. **Success Response (200):** `{ "admin": { …with role… } }`. **Possible Errors:** `404 ADMIN_NOT_FOUND`.

### `PATCH /v1/admin/admin-users/{id}`

**Purpose:** Change name, role or status. A changed role or status signs the admin out everywhere.

**Permission:** `admin_users.manage`.

**Request Body:** `{ "name"?: string (1–120), "roleId"?: ObjectId, "status"?: "active" | "disabled" }`

**Success Response (200):** `{ "admin": { …without role… } }`

**Possible Errors:**

- `403 ADMIN_SELF_MODIFICATION` – changing one's own role or status.
- `409 ADMIN_SELF_MODIFICATION` – would leave no active super admin.
- `404 ADMIN_NOT_FOUND`, `404 ROLE_NOT_FOUND`.

### `POST /v1/admin/admin-users/{id}/reset-password`

**Purpose:** Set a temporary password (12–128), force a change at next login, unlock the account and sign the admin out everywhere.

**Permission:** `admin_users.manage`. **Request Body:** `{ "temporaryPassword": "…" }`. **Success Response:** `204`. **Possible Errors:** `404 ADMIN_NOT_FOUND`.

### `POST /v1/admin/admin-users/{id}/reset-mfa`

**Purpose:** Remove the authenticator of an admin who lost it (they enrol again at next login); signs them out everywhere.

**Permission:** `admin_users.manage`. **Success Response:** `204`. **Possible Errors:** `404 ADMIN_NOT_FOUND`.

**A sole owner who lost the authenticator** has nobody left to call this route. On the server: `npm run reset:mfa -- owner@radhefoods.de` removes the authenticator of that admin and ends every session; the owner signs in with the password and enrols again. The panel shows this as the way out when the only admin with `admin_users.manage` is locked out.

---

## 3. Roles and permissions (RBAC)

**Role object:**

```json
{
  "id": "66f1a2b3c4d5e6f7a8b9c0a1",
  "key": "order_manager",
  "name": "Order manager",
  "description": null,
  "permissions": ["orders.read", "orders.manage"],
  "isSystem": false,
  "createdAt": "2026-09-01T10:00:00.000Z",
  "updatedAt": "2026-09-01T10:00:00.000Z"
}
```

### `GET /v1/admin/roles`

**Permission:** `roles.read`. **Success Response (200):** `{ "items": [ …roles sorted by key… ] }`

### `GET /v1/admin/roles/permissions`

**Purpose:** Every permission a role can contain (for the role editor).

**Permission:** `roles.read`.

**Success Response (200):**

```json
{ "items": ["admin_users.read", "admin_users.manage", "roles.read", "roles.manage", "customers.read", "customers.manage", "catalog.read", "catalog.manage", "orders.read", "orders.manage", "settings.read", "settings.manage", "legal.read", "legal.manage", "payments.read", "payments.manage", "notifications.read", "notifications.manage"] }
```

A role may also contain `*` or `<resource>.*` (e.g. `orders.*`); these are accepted by create/update although not listed here.

### `POST /v1/admin/roles`

**Permission:** `roles.manage`.

**Request Body:**

```json
{ "key": "order_manager", "name": "Order manager", "description": "Handles orders and returns", "permissions": ["orders.read", "orders.manage"] }
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `key` | string | yes | `^[a-z][a-z0-9_]{2,40}$`, unique |
| `name` | string | yes | 1–80 |
| `description` | string | no | ≤300 |
| `permissions` | string[] | yes | ≤200 entries; known permissions, `*`, or `<resource>.*` |

**Success Response (201):** `{ "role": { … } }`

**Possible Errors:** `400 ROLE_PERMISSION_UNKNOWN` (`details: { unknown: [...] }`), `409 ROLE_KEY_TAKEN`.

### `PATCH /v1/admin/roles/{id}`

**Permission:** `roles.manage`. **Request Body:** `{ "name"?, "description"?: string | null, "permissions"? }`. `description: null` removes the description. **Success Response (200):** `{ "role": { … } }`.

A change of `permissions` applies to the very next request of every admin with the role: the guard reads the session and the role on each request, nobody is signed out and nobody has to sign in again. (Giving an admin another role, or disabling the account, does end their sessions: `PATCH /v1/admin/admin-users/{id}`.)

**Possible Errors:** `404 ROLE_NOT_FOUND`, `403 ROLE_IS_SYSTEM` (`super_admin` cannot be edited), `400 ROLE_PERMISSION_UNKNOWN`.

### `DELETE /v1/admin/roles/{id}`

**Permission:** `roles.manage`. **Success Response:** `204`. **Possible Errors:** `404 ROLE_NOT_FOUND`, `403 ROLE_IS_SYSTEM`, `409 ROLE_IN_USE` (still assigned to an admin).

---

## 4. Customers

Read customer accounts and block or unblock them. A blocked customer cannot sign in and cannot check out (`403 CUSTOMER_BLOCKED`).

### 4.1 The admin customer object

```json
{
  "id": "66f1a2b3c4d5e6f7a8b9c0d1",
  "email": "anna@example.com",
  "firstName": "Anna",
  "lastName": "Schmidt",
  "phone": "+4915112345678",
  "locale": "de",
  "hasGoogleLogin": false,
  "communication": {
    "whatsappNumber": "+4915112345678",
    "whatsappOptIn": true,
    "whatsappOptInAt": "2026-09-30T12:00:00.000Z",
    "marketingOptIn": false,
    "marketingOptInAt": null,
    "marketingOptOutAt": null
  },
  "createdAt": "2026-09-01T10:00:00.000Z",
  "status": "active",
  "blockedReason": null,
  "blockedAt": null,
  "signupMethod": "email_otp",
  "emailVerifiedAt": "2026-09-01T10:00:00.000Z",
  "lastLoginAt": "2026-09-20T08:00:00.000Z",
  "updatedAt": "2026-09-20T08:00:00.000Z",
  "addresses": [
    { "id": "66f1…", "firstName": "Anna", "lastName": "Schmidt", "company": null, "street": "Hauptstraße", "houseNumber": "12a", "additionalLine": null, "postalCode": "60311", "city": "Frankfurt am Main", "countryCode": "DE", "phone": null, "isDefault": true }
  ]
}
```

`status` ∈ `active`, `blocked`; `signupMethod` ∈ `email_otp`, `google`. `communication.whatsappNumber` falls back to `phone` when no separate number was given; `whatsappOptIn` allows messages about own orders by WhatsApp, `marketingOptIn` the news of section 14.

### `GET /v1/admin/customers`

**Purpose:** Customers, newest first.

**Permission:** `customers.read`.

**Parameters (query):**

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `status` | `active` \| `blocked` | no | |
| `email` | string, 2–254 | no | Beginning of the email address. |
| `q` | string 1–100 | no | Words of the name, the email or the phone; every word must begin a word of the customer (`schmi`, `anna@`, `4915`). |
| `sort` | `createdAt` \| `email` \| `status`, with `:asc` or `:desc` | no | Default `createdAt:desc`. |
| `limit` | int 1–100 | no | Default 25. |
| `cursor` | string | no | `nextCursor` of the previous page. |

**Success Response (200):** `{ "items": [ …admin customer objects… ], "nextCursor": "66f0…" }`

### `GET /v1/admin/customers/count`

**Permission:** `customers.read`. **Parameters:** `status`, `email`, `q` as above. **Success Response (200):** `{ "total": 148 }`.

### `GET /v1/admin/customers/{id}`

**Permission:** `customers.read`. **Success Response (200):** `{ "customer": { … } }`. **Possible Errors:** `404 CUSTOMER_NOT_FOUND`.

### `PATCH /v1/admin/customers/{id}/status`

**Purpose:** Block or unblock the account. Blocking signs the customer out everywhere and refuses sign-in and checkout.

**Permission:** `customers.manage`.

**Request Body:** `{ "status": "active" | "blocked", "reason"?: string (≤500, stored when blocking) }`

**Success Response (200):** `{ "customer": { … } }`. **Possible Errors:** `404 CUSTOMER_NOT_FOUND`.

---

## 5. Settings

The business rules the admin can change. `GET` returns all of them; each `PUT` replaces one group and answers with that group.

### `GET /v1/admin/settings`

**Permission:** `settings.read`.

**Success Response (200):** the settings below plus `"integrations": { "stripeConnected": boolean, "whatsappConfigured": boolean }` (whether the server has both Stripe keys and the WhatsApp credentials; `payments.stripeConnected` repeats the Stripe flag). The shop cannot sell while `stripeConnected` is `false` (checkout answers `503 PAYMENTS_NOT_CONFIGURED`) or while `company.missingForInvoices` is not empty (checkout answers `409 COMPANY_DETAILS_MISSING`): show both as warnings on the settings page and the start page.

```json
{
  "deliveryFee": { "tiers": [ { "minOrderValue": 0, "fee": 499 }, { "minOrderValue": 5000, "fee": 0 } ] },
  "orderPolicy": { "customerCancellation": "until_dispatched" },
  "delivery": { "defaultMethod": "radhe_delivery", "estimate": { "en": "2 to 4 working days", "de": "2 bis 4 Werktage" } },
  "returnPolicy": { "windowDays": 14 },
  "company": {
    "name": "Radhe Foods GmbH",
    "addressLines": ["Hauptstraße 1", "60311 Frankfurt am Main"],
    "email": "billing@radhefoods.de",
    "phone": "+49 69 1234567",
    "website": "https://www.radhefoods.de",
    "vatId": "DE123456789",
    "registration": "Amtsgericht Frankfurt am Main, HRB 12345",
    "logoUrl": "https://www.radhefoods.de/brand/logo-600.png",
    "invoiceFooter": "Thank you for shopping with Radhe Foods.",
    "missingForInvoices": []
  },
  "payments": { "checkoutMinutes": 60, "stripeConnected": true },
  "integrations": { "stripeConnected": true, "whatsappConfigured": false }
}
```

- `company`: optional keys (`phone`, `website`, `vatId`, `taxNumber`, `registration`, `logoUrl`, `invoiceFooter`) are **absent** when unset. `missingForInvoices` lists what still blocks invoicing (`name`, `addressLines`, `email`, `vatId or taxNumber`); show a warning while it is not empty.
- Defaults on a fresh installation: fee `[{0, 0}]` (free), `until_dispatched`, `radhe_delivery` with the estimate "2 to 4 working days" / "2 bis 4 Werktage", `14` days, company `{ name: "Radhe Foods", addressLines: [], email: "" }`, `checkoutMinutes` 60.
- The shop reads the tiers, `freeFrom`, `delivery.estimate` and `returns.windowDays` from `GET /v1/store/settings` (customer API).

### `PUT /v1/admin/settings/delivery-fee`

**Purpose:** Delivery fee tiers by value of the goods (cents, VAT included). The highest tier an order reaches applies. Placed orders keep their fee.

**Permission:** `settings.manage`.

**Request Body:** `{ "tiers": [ { "minOrderValue": 0, "fee": 499 }, { "minOrderValue": 5000, "fee": 0 } ] }` — 1–10 tiers, `minOrderValue` 0–10 000 000, `fee` 0–10 000 000; one tier must start at 0; no two tiers at the same value.

**Success Response (200):** `{ "deliveryFee": { "tiers": [ …sorted ascending… ] } }`

### `PUT /v1/admin/settings/order-policy`

**Purpose:** Until when a customer can cancel an order (section 9.1). **Permission:** `settings.manage`. **Request Body:** `{ "customerCancellation": "while_confirmed" | "until_dispatched" | "never" }`. **Success Response (200):** `{ "orderPolicy": { … } }`.

### `PUT /v1/admin/settings/delivery`

**Purpose:** The delivery method every new order gets (customers never choose; the admin changes it per order), and the delivery estimate shown at checkout and in the emails about an order.

**Permission:** `settings.manage`.

**Request Body:** `{ "defaultMethod": "radhe_delivery" | "dhl" | "hermes", "estimate": { "en": "2 to 4 working days", "de": "2 bis 4 Werktage" } }` (`estimate.en` and `estimate.de` both required, 1–120 characters).

**Success Response (200):** `{ "delivery": { "defaultMethod", "estimate": { "en", "de" } } }`.

### `PUT /v1/admin/settings/return-policy`

**Permission:** `settings.manage`. **Request Body:** `{ "windowDays": 14 }` (0–365; 0 switches return requests off). **Success Response (200):** `{ "returnPolicy": { … } }`.

### `PUT /v1/admin/settings/company`

**Purpose:** The seller printed on every invoice and shown in every email. Invoices cannot be issued — and therefore nothing can be sold — until name, address, email and a VAT id or tax number are set.

**Permission:** `settings.manage`.

**Request Body:**

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `name` | string | yes | 1–120 |
| `addressLines` | string[] | yes | 1–5 lines, ≤120 each (street; postcode and city) |
| `email` | string | yes | email |
| `phone` | string | no | ≤40 |
| `website` | string | no | URL with protocol |
| `vatId` | string | no | `^[A-Z]{2}[A-Z0-9]{2,13}$` (USt-IdNr.) |
| `taxNumber` | string | no | ≤40 (Steuernummer) |
| `registration` | string | no | ≤160 |
| `logoUrl` | string | no | absolute URL of the logo (emails, invoices) |
| `invoiceFooter` | string | no | ≤1000 |

**Success Response (200):** `{ "company": { …, "missingForInvoices": [] } }`

### `PUT /v1/admin/settings/payments`

**Purpose:** How long a Stripe payment page stays open. **Permission:** `settings.manage`. **Request Body:** `{ "checkoutMinutes": 60 }` (30–1440). **Success Response (200):** `{ "payments": { "checkoutMinutes": 60 } }`.

---

## 6. Legal texts

Terms and privacy policy, in versions. Customers accept the current published versions at checkout (the order records the versions); a published version can never change (a new version is created instead). **Orders are refused until `terms` and `privacy` are published.**

**Document object:**

```json
{
  "id": "66f1a2b3c4d5e6f7a8b9c0b4",
  "type": "terms",
  "version": 3,
  "status": "draft",
  "title": { "en": "Terms and Conditions", "de": "AGB" },
  "content": { "en": "…markdown…", "de": "…" },
  "note": "Clarified delivery times",
  "publishedAt": null,
  "createdAt": "2026-09-01T10:00:00.000Z",
  "updatedAt": "2026-09-01T10:00:00.000Z"
}
```

`type` ∈ `terms`, `privacy`; `status` ∈ `draft`, `published`.

### `GET /v1/admin/legal-documents`

**Purpose:** All versions, newest first per type, **without** `content`.

**Permission:** `legal.read`. **Parameters:** `type` (query, optional).

**Success Response (200):**

```json
{
  "items": [ { "…document without content…": "", "isCurrent": true } ],
  "requiredTypes": ["terms", "privacy"]
}
```

`isCurrent` marks the published version customers accept now.

### `POST /v1/admin/legal-documents`

**Purpose:** Create the next version of a type as a draft.

**Permission:** `legal.manage`.

**Request Body:**

```json
{ "type": "terms", "title": { "en": "Terms and Conditions", "de": "AGB" }, "content": { "en": "…", "de": "…" }, "note": "What changed" }
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `type` | `terms` \| `privacy` | yes | |
| `title` | `{ en (1–160), de? (≤160) }` | yes | |
| `content` | `{ en? (≤300000), de? (≤300000) }` | yes | English is required to publish |
| `note` | string | no | ≤1000, internal |

**Success Response (201):** `{ "document": { … } }`

### `GET /v1/admin/legal-documents/{id}`

**Permission:** `legal.read`. **Success Response (200):** `{ "document": { …with content… } }`. **Possible Errors:** `404 LEGAL_DOCUMENT_NOT_FOUND`.

### `PATCH /v1/admin/legal-documents/{id}`

**Purpose:** Change a draft. **Permission:** `legal.manage`. **Request Body:** `{ "title"?, "content"?, "note"?: string | null }`; `note: null` removes the note. **Success Response (200):** `{ "document": { … } }`. **Possible Errors:** `404 LEGAL_DOCUMENT_NOT_FOUND`, `409 LEGAL_DOCUMENT_PUBLISHED`.

### `POST /v1/admin/legal-documents/{id}/publish`

**Purpose:** Publish the version; customers accept it from now on. Idempotent. **Permission:** `legal.manage`. **Success Response (200):** `{ "document": { …status published… } }`. **Possible Errors:** `404 LEGAL_DOCUMENT_NOT_FOUND`, `400 VALIDATION_FAILED` ("A legal text needs its English content before it is published.").

### `DELETE /v1/admin/legal-documents/{id}`

**Purpose:** Delete a draft. **Permission:** `legal.manage`. **Success Response:** `204`. **Possible Errors:** `404 LEGAL_DOCUMENT_NOT_FOUND`, `409 LEGAL_DOCUMENT_PUBLISHED`.

---

## 7. Categories

A tree of at most three levels. Products belong to one category; store listings include sub-categories.

### 7.1 The admin category object

```json
{
  "id": "66f0…",
  "name": { "en": "Rice", "de": "Reis" },
  "slug": { "en": "rice", "de": "reis" },
  "tagline": { "en": "Long grain and more" },
  "description": null,
  "parentId": null,
  "ancestorIds": [],
  "level": 1,
  "sortOrder": 0,
  "isVisible": true,
  "image": {
    "id": "66f2…", "alt": { "en": "Rice", "de": null }, "isPrimary": true,
    "url": "https://cdn…/large.webp",
    "sizes": { "small": { "url": "…", "width": 320, "height": 240 }, "medium": { "url": "…", "width": 800, "height": 600 }, "large": { "url": "…", "width": 1600, "height": 1200 } },
    "bytes": 184320, "uploadedAt": "2026-09-01T10:00:00.000Z"
  },
  "productCount": 15,
  "seo": { "title": { "en": "…" }, "description": null },
  "createdAt": "…", "updatedAt": "…"
}
```

`productCount` counts every product (all statuses and pack sizes) in the category and below. `tagline`, `description`, `seo`, `image` are `null` when unset.

### `GET /v1/admin/categories`

**Purpose:** All categories in display order as a flat list (each parent followed by its children; `level` and `parentId` give the tree).

**Permission:** `catalog.read`. **Success Response (200):** `{ "items": [ … ] }`

### `POST /v1/admin/categories`

**Permission:** `catalog.manage`.

**Request Body:**

```json
{
  "name": { "en": "Basmati Rice", "de": "Basmati Reis" },
  "slug": { "en": "basmati-rice", "de": "basmati-reis" },
  "tagline": { "en": "…", "de": "…" },
  "description": { "en": "…", "de": "…" },
  "parentId": "66f0…",
  "sortOrder": 3,
  "isVisible": true,
  "seo": { "title": { "en": "…", "de": "…" }, "description": { "en": "…", "de": "…" } }
}
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `name` | `{ en (1–160), de? }` | yes | |
| `slug` | `{ en?, de? }` | no | lower-case letters, digits, single hyphens, ≤120; generated from the name when left out |
| `tagline` | `{ en?, de? }` (≤300) | no | |
| `description` | `{ en?, de? }` (≤20000) | no | |
| `parentId` | ObjectId or `null` | no | `null`/absent = main category |
| `sortOrder` | int 0–100000 | no | defaults to the last position |
| `isVisible` | boolean | no | hidden categories (and their products) disappear from the shop |
| `seo.title`, `seo.description` | `{ en?, de? }` (≤300) | no | |

**Success Response (201):** `{ "category": { … } }`

**Possible Errors:** `400 CATEGORY_PARENT_INVALID`, `400 CATEGORY_TOO_DEEP` (max 3 levels), `409 CATEGORY_SLUG_TAKEN`, `400 VALIDATION_FAILED`.

### `GET /v1/admin/categories/{id}`

**Permission:** `catalog.read`. **Success Response (200):** `{ "category": { … } }`. **Possible Errors:** `404 CATEGORY_NOT_FOUND`.

### `PATCH /v1/admin/categories/{id}`

**Purpose:** Change a category; send only what changes. Translated objects are replaced as a whole. `parentId` moves the category with everything below it (it goes to the last position there).

**Permission:** `catalog.manage`. **Request Body:** same fields as create, all optional. **Success Response (200):** `{ "category": { … } }`.

**Possible Errors:** `404 CATEGORY_NOT_FOUND`, `400 CATEGORY_PARENT_INVALID` (parent missing, or moving into itself/a descendant), `400 CATEGORY_TOO_DEEP`, `409 CATEGORY_SLUG_TAKEN`.

### `PUT /v1/admin/categories/order`

**Purpose:** Set the order of the categories of one parent (drag and drop). The order is kept per parent: the list must contain exactly the children of `parentId`, and nothing moves between parents here. To put a category under another parent, `PATCH /v1/admin/categories/{id}` with `parentId`, then order the new siblings.

**Permission:** `catalog.manage`.

**Request Body:** `{ "parentId": null | ObjectId, "orderedIds": [ …every category of that parent, in the new order… ] }` (1–500 ids, unique).

**Success Response:** `204`. **Possible Errors:** `400 CATEGORY_ORDER_INVALID` (`details: { expected: [ids] }` – the list must contain exactly the children of that parent).

### `DELETE /v1/admin/categories/{id}`

**Purpose:** Delete an empty category (use `isVisible: false` to take one out of the shop). **Permission:** `catalog.manage`. **Success Response:** `204`. **Possible Errors:** `404 CATEGORY_NOT_FOUND`, `409 CATEGORY_HAS_CHILDREN`, `409 CATEGORY_HAS_PRODUCTS`.

### `PUT /v1/admin/categories/{id}/image`

**Purpose:** Upload or replace the category image. **Permission:** `catalog.manage`.

**Request:** `multipart/form-data` with one field `file` (JPEG, PNG or WebP; ≤10 MB; at least 200 px on each side; the image is converted to WebP in three sizes).

**Success Response (200):** `{ "category": { … } }`. **Possible Errors:** `400 IMAGE_REQUIRED`, `400 IMAGE_FORMAT_NOT_ALLOWED` (`details: { accepted: ["jpeg","png","webp"] }`), `400 IMAGE_DIMENSIONS_INVALID` (`details: { width, height, minimum: 200 }`), `400 IMAGE_INVALID`, `413 FILE_TOO_LARGE`, `503 STORAGE_UNAVAILABLE`, `404 CATEGORY_NOT_FOUND`.

### `PATCH /v1/admin/categories/{id}/image`

**Purpose:** Change the image description. **Permission:** `catalog.manage`. **Request Body:** `{ "alt": { "en"?: string, "de"?: string } }` (≤300). **Success Response (200):** `{ "category": { … } }`. **Possible Errors:** `404 IMAGE_NOT_FOUND` ("The category has no image.").

### `DELETE /v1/admin/categories/{id}/image`

**Permission:** `catalog.manage`. **Success Response (200):** `{ "category": { …, "image": null } }`. **Possible Errors:** `404 CATEGORY_NOT_FOUND`, `404 IMAGE_NOT_FOUND`.

---

## 8. Products, stock and images

One product document = one article in **one pack size**. Several pack sizes of the same article are separate products linked by a `variantGroupId`; one of them is the default (shown in listings). Prices are cents including VAT.

Every product has a stock: `stock.quantity` is the number of units on the shelf, `stock.lowStockThreshold` the count at or below which the admin is warned. A product with quantity 0 is sold out in the shop. The stock changes through its own endpoint (8.1, `POST …/stock`), through paid orders, cancellations, returns and corrections, and through the CSV import; every change is kept in the stock history. Nothing is reserved before a payment; the units are taken the moment the payment is approved. Customers never see the stock.

### 8.1 Objects

**PriceView** (as `pricing`):

```json
{ "currency": "EUR", "price": 1999, "regularPrice": 2499, "salePrice": 1999, "onSale": true, "discountPercent": 20, "discountAmount": 500, "vatIncluded": true, "vatRate": 700, "vatPercent": 7, "vatAmount": 131, "basePrice": { "amount": 400, "per": "kg" } }
```

**Admin image:**

```json
{
  "id": "66f2…", "alt": { "en": "Basmati Rice", "de": null }, "isPrimary": true,
  "url": "https://cdn…/large.webp",
  "sizes": { "small": { "url": "…", "width": 320, "height": 240 }, "medium": { "url": "…", "width": 800, "height": 600 }, "large": { "url": "…", "width": 1600, "height": 1200 } },
  "bytes": 184320, "uploadedAt": "2026-09-01T10:00:00.000Z"
}
```

Images are stored as WebP in three sizes (320 / 800 / 1600 px longest side, never enlarged) under immutable URLs. The original file is not kept.

**Product summary** (list entries):

```json
{
  "id": "66f3…",
  "sku": "RF-00042",
  "name": { "en": "Basmati Rice", "de": "Basmati Reis" },
  "slug": { "en": "basmati-rice-5-kg", "de": "basmati-reis-5-kg" },
  "brand": "India Gate",
  "category": { "id": "66f0…", "name": { "en": "Rice", "de": "Reis" } },
  "packSize": { "value": 5, "unit": "kg", "label": "5 kg" },
  "pricing": { "…PriceView…": "" },
  "status": "active",
  "isAvailable": true,
  "isFeatured": false,
  "sortOrder": 0,
  "stock": { "quantity": 120, "lowStockThreshold": 10, "isLow": false },
  "variantGroupId": "66f4…",
  "isDefaultVariant": true,
  "packSizeCount": 2,
  "imageCount": 3,
  "image": { "id": "…", "alt": "Basmati Rice", "isPrimary": true, "url": "…", "sizes": { "…": "" } },
  "createdAt": "…", "updatedAt": "…"
}
```

(`image` in the summary is the store-style image with a plain `alt` string; `variantGroupId` is `null` for a product without other pack sizes. `stock.isLow` is true when a threshold is set and the quantity is at or below it; `lowStockThreshold` is `null` when none is set, and a product without a threshold is never low. The entries of `packSizes` in the detail carry `stock` too.)

**Product detail** = summary plus:

```json
{
  "gtin": "8901234567890",
  "subtitle": null,
  "shortDescription": { "en": "…" },
  "description": { "en": "…", "de": "…" },
  "highlights": { "en": ["Aged 2 years"], "de": [] },
  "uses": { "en": [], "de": [] },
  "categoryId": "66f0…",
  "minOrderQuantity": 1,
  "maxOrderQuantity": null,
  "storageType": "ambient",
  "food": { "ingredients": { "en": "Basmati rice" }, "allergens": null, "nutrition": null, "storageInstructions": null, "origin": "India", "manufacturer": null },
  "tags": ["new"],
  "searchKeywords": ["Reis"],
  "seo": null,
  "images": [ { "…admin image…": "", "isPrimary": true } ],
  "packSizes": [
    { "id": "66f2…", "sku": "RF-00041", "packSize": { "value": 1, "unit": "kg", "label": "1 kg" }, "pricing": { "…": "" }, "status": "active", "isAvailable": true, "stock": { "quantity": 40, "lowStockThreshold": null, "isLow": false }, "isDefault": false },
    { "id": "66f3…", "sku": "RF-00042", "packSize": { "value": 5, "unit": "kg", "label": "5 kg" }, "pricing": { "…": "" }, "status": "active", "isAvailable": true, "stock": { "quantity": 120, "lowStockThreshold": 10, "isLow": false }, "isDefault": true }
  ],
  "publishedAt": "2026-09-01T08:00:00.000Z"
}
```

`packSizes` lists all members of the variant group (any status), smallest first; it is `[]` for a product without a group. `images` are in the admin's order.

**Stock movement** (the stock history):

```json
{ "id": "66f9…", "reason": "adjustment", "delta": -4, "quantityAfter": 116, "orderId": null, "orderNumber": null, "adminId": "66f1…", "admin": { "id": "66f1…", "name": "Priya" }, "note": "Broken bags", "createdAt": "…" }
```

`reason` ∈ `restock` (units added by the admin, or the opening stock of a new product), `adjustment` (count corrected by the admin), `import` (CSV import), `order` (taken by a paid order; `orderId`/`orderNumber` set, `admin` null), `cancel` (given back by a cancellation), `return` (given back by a completed return with `restock: true`), `release` (given back when a payment could not be completed after the units were taken, or when a correction lowered the delivered quantity). `delta` is positive for units that came in, negative for units that went out.

### `GET /v1/admin/products`

**Purpose:** Products with filters, search and pages (every pack size is its own row).

**Permission:** `catalog.read`.

**Parameters (query, all optional):**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `status` | `draft` \| `active` \| `archived` | |
| `categoryId` | ObjectId | Sub-categories included. |
| `q` | string 2–80 | Search words (name, subtitle, SKU, brand, keywords, tags; prefix match per word) or the beginning of an article number. |
| `isAvailable` | boolean | |
| `onSale` | boolean | |
| `variantGroupId` | ObjectId | The pack sizes of one product. |
| `lowStock` | boolean | `true`: only products at or below their low-stock threshold. |
| `sort` | `newest` (default) \| `updated` \| `name` \| `sku` \| `price_asc` \| `price_desc` | |
| `page`, `limit` | int | 1–500 / 1–100 (default 24) |

**Success Response (200):** `{ "items": [ …summaries… ], "page": 1, "limit": 24, "total": 57, "totalPages": 3 }`

### `POST /v1/admin/products`

**Purpose:** Create a product (a draft unless `status` says otherwise). Images are uploaded afterwards. For a further pack size of an existing product, set `variantOf` or use the duplicate endpoint.

**Permission:** `catalog.manage`.

**Request Body:**

```json
{
  "sku": "RF-00042",
  "gtin": "8901234567890",
  "name": { "en": "Basmati Rice", "de": "Basmati Reis" },
  "slug": { "en": "basmati-rice-5-kg", "de": "basmati-reis-5-kg" },
  "subtitle": { "en": "Aged", "de": "Gereift" },
  "shortDescription": { "en": "…", "de": "…" },
  "description": { "en": "…", "de": "…" },
  "highlights": { "en": ["Aged 2 years"], "de": ["2 Jahre gereift"] },
  "uses": { "en": ["Biryani"], "de": ["Biryani"] },
  "brand": "India Gate",
  "categoryId": "66f0…",
  "packSize": { "value": 5, "unit": "kg" },
  "stockQuantity": 120,
  "lowStockThreshold": 10,
  "variantOf": "66f2…",
  "regularPrice": 2499,
  "salePrice": 1999,
  "discountPercent": null,
  "vatRate": 700,
  "status": "active",
  "isAvailable": true,
  "isFeatured": false,
  "sortOrder": 0,
  "minOrderQuantity": 1,
  "maxOrderQuantity": 10,
  "storageType": "ambient",
  "food": {
    "ingredients": { "en": "Basmati rice" },
    "allergens": { "en": "NA" },
    "nutrition": { "en": "Fat (0.6g), …" },
    "storageInstructions": { "en": "Store cool and dry" },
    "origin": "India",
    "manufacturer": "…name and address…"
  },
  "tags": ["vegan", "new"],
  "searchKeywords": ["Reis"],
  "seo": { "title": { "en": "…" }, "description": { "en": "…" } }
}
```

| Field | Type | Required | Validation / meaning |
| ----- | ---- | -------- | -------------------- |
| `sku` | string | no | `^[A-Z0-9][A-Z0-9._-]{1,39}$` (upper-cased); generated `RF-00001…` when left out |
| `gtin` | string or `null` | no | 8, 12, 13 or 14 digits |
| `name` | `{ en (1–160), de? }` | yes | |
| `slug` | `{ en?, de? }` | no | ≤120, slug pattern; generated from name + pack size |
| `subtitle`, `shortDescription` | `{ en?, de? }` ≤300 | no | |
| `description` | `{ en?, de? }` ≤20000 | no | |
| `highlights`, `uses` | `{ en?: string[], de?: string[] }` ≤20 each | no | |
| `brand` | string or `null` | no | ≤80 |
| `categoryId` | ObjectId | yes | |
| `packSize` | `{ value: 0.001–1000000 (≤3 decimals), unit: g\|kg\|ml\|l\|pcs }` | yes | |
| `stockQuantity` | int 0–1 000 000 | no | the opening stock (default 0); recorded as a `restock` movement. **Only on create**: `PATCH` rejects it (`400 VALIDATION_FAILED`); later changes go through `POST …/stock` |
| `lowStockThreshold` | int 0–1 000 000 or `null` | no | the admin is warned at or below this count; `null` removes it |
| `variantOf` | ObjectId or `null` | no | id of **any** pack size of the product to join; `null` separates |
| `regularPrice` | int cents | yes | 1–10 000 000 |
| `salePrice` | int cents or `null` | no | 1–10 000 000, must be below `regularPrice`; `null` ends a sale |
| `discountPercent` | int or `null` | no | 1–99; alternative to `salePrice` (not both) |
| `vatRate` | int | yes | 0–10000 (700 = 7 %, 1900 = 19 %) |
| `status` | `draft` \| `active` \| `archived` | no | default `draft`; `active` sets `publishedAt` once |
| `isAvailable`, `isFeatured` | boolean | no | `isAvailable: false` keeps an active product in the shop but marks it as not orderable (shown as "sold out"; it cannot be put in a cart). A product with `stock.quantity` 0 is sold out as well. `isFeatured` marks the product for the featured block of the shop (`GET /v1/store/products?featured=true`); it changes nothing else. |
| `sortOrder` | int 0–1 000 000 | no | |
| `minOrderQuantity`, `maxOrderQuantity` | int 1–10000 (`max` nullable) | no | max ≥ min |
| `storageType` | `ambient` \| `chilled` \| `frozen` | no | |
| `food` | object | no | free-text fields per language (≤20000); `origin` ≤120; `manufacturer` ≤500 |
| `tags` | string[] | no | ≤20, each `^[a-z0-9]+(?:-[a-z0-9]+)*$` ≤40, unique |
| `searchKeywords` | string[] | no | ≤30, 2–60 chars each |
| `seo` | `{ title?: {en?,de?}, description?: {en?,de?} }` ≤300 | no | |

**Success Response (201):** `{ "product": { …detail… } }`

**Possible Errors:** `404 CATEGORY_NOT_FOUND`, `400 PRODUCT_PRICE_INVALID` (`details: { regularPrice, salePrice }`; both `salePrice` and `discountPercent` sent, or sale price not below regular), `400 PRODUCT_QUANTITY_INVALID`, `400 PRODUCT_VARIANT_INVALID`, `409 PRODUCT_SKU_TAKEN`, `409 PRODUCT_SLUG_TAKEN`, `400 VALIDATION_FAILED`.

### `GET /v1/admin/products/{id}`

**Permission:** `catalog.read`. **Success Response (200):** `{ "product": { …detail…, "deletable": boolean, "notDeletableReason": null | { "code": "PRODUCT_IS_ACTIVE" | "PRODUCT_IN_USE", "message" } } }`. `deletable` says whether `DELETE` would succeed now; show the delete button accordingly. **Possible Errors:** `404 PRODUCT_NOT_FOUND`.

### `PATCH /v1/admin/products/{id}`

**Purpose:** Change a product; send only what changes. Translated fields, lists and `food` are replaced as a whole. `salePrice: null` ends a sale; sending neither `salePrice` nor `discountPercent` keeps the current sale. `lowStockThreshold` can be set or removed (`null`) here; the stock itself cannot (`stockQuantity` is refused).

**Permission:** `catalog.manage`. **Request Body:** same fields as create except `stockQuantity`, all optional. **Success Response (200):** `{ "product": { … } }`.

**Possible Errors:** `404 PRODUCT_NOT_FOUND`, `404 CATEGORY_NOT_FOUND`, `400 PRODUCT_PRICE_INVALID`, `400 PRODUCT_QUANTITY_INVALID`, `400 PRODUCT_VARIANT_INVALID` (`variantOf` is the product itself or unknown), `409 PRODUCT_SKU_TAKEN`, `409 PRODUCT_SLUG_TAKEN`, `400 VALIDATION_FAILED`.

### `DELETE /v1/admin/products/{id}`

**Purpose:** Delete a product and its images for good. Only for drafts/archived products that are not part of an order (cancelled orders do not count). **Permission:** `catalog.manage`. **Success Response:** `204`.

**Possible Errors:** `404 PRODUCT_NOT_FOUND`, `409 PRODUCT_IS_ACTIVE` ("Archive the product before deleting it."), `409 PRODUCT_IN_USE` ("The product cannot be deleted. It is part of 3 order(s). Archive it instead.").

### `POST /v1/admin/products/{id}/duplicate`

**Purpose:** Copy a product as another pack size: a draft with the same texts, category, food information, low-stock threshold and (by default) images. The copy starts with a stock of 0 and an empty history.

**Permission:** `catalog.manage`.

**Request Body:** `{ "sku"?: string, "packSize": { "value", "unit" }, "regularPrice": int, "salePrice"?: int|null, "discountPercent"?: int|null, "asVariant"?: boolean (default true), "copyImages"?: boolean (default true) }`

**Success Response (201):** `{ "product": { …the new draft… } }`. **Possible Errors:** as for create, plus `404 PRODUCT_NOT_FOUND`, `503 STORAGE_UNAVAILABLE`.

### `POST /v1/admin/products/{id}/make-default`

**Purpose:** Make this pack size the one shown in listings. **Permission:** `catalog.manage`. **Success Response (200):** `{ "product": { … } }`. **Possible Errors:** `404 PRODUCT_NOT_FOUND`, `400 PRODUCT_VARIANT_INVALID` ("The product has no other pack sizes.").

### `GET /v1/admin/products/{id}/price-history`

**Permission:** `catalog.read`.

**Success Response (200):**

```json
{ "items": [ { "regularPrice": 2499, "salePrice": 1999, "price": 1999, "vatRate": 700, "changedBy": "66f1…", "changedAt": "2026-09-20T09:30:00.000Z" } ] }
```

Newest first, max 200. **Possible Errors:** `404 PRODUCT_NOT_FOUND`.

### `POST /v1/admin/products/{id}/stock`

**Purpose:** Set or adjust the stock. `quantity` sets the exact count (after counting the shelf); `delta` adds (positive) or removes (negative) units. Send one of the two.

**Permission:** `catalog.manage`.

**Request Body:** `{ "delta": -4, "note": "Broken bags" }` or `{ "quantity": 120, "note": "Counted" }`. `quantity` 0–1 000 000, `delta` −1 000 000 to 1 000 000, `note` ≤500 characters (optional).

**Success Response (200):**

```json
{
  "product": { "…product detail…": "" },
  "movement": { "id": "66f9…", "reason": "adjustment", "delta": -4, "quantityAfter": 116, "orderId": null, "orderNumber": null, "adminId": "66f1…", "admin": { "id": "66f1…", "name": "Priya" }, "note": "Broken bags", "createdAt": "…" }
}
```

`movement` is `null` when nothing changed (the same count again). A positive `delta` is recorded as `restock`, a negative `delta` and every `quantity` as `adjustment`.

**Possible Errors:** `400 STOCK_CHANGE_INVALID` (both or neither of `quantity` and `delta`), `409 STOCK_INSUFFICIENT` (removing more than there is; `details: { productId, sku, available, wanted }`), `404 PRODUCT_NOT_FOUND`, `400 VALIDATION_FAILED`.

### `GET /v1/admin/products/{id}/stock/movements`

**Purpose:** The stock history, newest first.

**Permission:** `catalog.read`.

**Parameters (query):** `limit` 1–100 (default 25), `cursor`, `sort` (`createdAt:asc|desc`; default newest first).

**Success Response (200):** `{ "items": [ { "…stock movement (8.1)…": "" } ], "nextCursor": "…" | null }`. **Possible Errors:** `404 PRODUCT_NOT_FOUND`.

### `POST /v1/admin/products/{id}/images`

**Purpose:** Upload one or more images (JPEG, PNG, WebP). The first image of a product becomes its main image. All-or-nothing: if one file is refused, nothing is stored, and the error names every refused file.

**Permission:** `catalog.manage`.

**Request:** `multipart/form-data`, field `files` (1–10 files, ≤10 MB each, ≥200 px each side, ≤40 megapixels). At most 12 images per product.

**Success Response (201):** `{ "product": { … } }`

**Possible Errors:** `400 IMAGE_REQUIRED`, `400 IMAGE_LIMIT_REACHED` (`details: { maximum: 12, remaining }`), `400 IMAGE_FORMAT_NOT_ALLOWED`, `400 IMAGE_DIMENSIONS_INVALID`, `400 IMAGE_INVALID` — on these three the code and `details` are those of the first refused file, and `details.files` lists every refused file: `[ { "name": "photo-2.gif", "code": "IMAGE_FORMAT_NOT_ALLOWED", "bytes": 48213 }, { "name": "photo-3.jpg", "code": "IMAGE_DIMENSIONS_INVALID", "bytes": 9120, "width": 150, "height": 900 } ]` (`name` as the browser sent it) — `413 FILE_TOO_LARGE`, `400 BAD_REQUEST` (more than 10 files or wrong field name), `503 STORAGE_UNAVAILABLE`, `404 PRODUCT_NOT_FOUND`.

### `PUT /v1/admin/products/{id}/images/order`

**Purpose:** Set the order of the images. **Permission:** `catalog.manage`. **Request Body:** `{ "orderedIds": [ …every image id, new order… ] }`. **Success Response (200):** `{ "product": { … } }`.

**Possible Errors:** `400 IMAGE_ORDER_INVALID` (`details: { expected: [ids] }`), `409 IMAGE_ORDER_INVALID` ("The images changed in the meantime. Load the product again."), `404 PRODUCT_NOT_FOUND`.

### `PUT /v1/admin/products/{id}/images/{imageId}`

**Purpose:** Replace the file of an image (position, description and main-image setting are kept). **Permission:** `catalog.manage`. **Request:** multipart field `file`. **Success Response (200):** `{ "product": { … } }`. **Possible Errors:** as upload, plus `404 IMAGE_NOT_FOUND`.

### `PATCH /v1/admin/products/{id}/images/{imageId}`

**Purpose:** Change the description or make it the main image. **Permission:** `catalog.manage`. **Request Body:** `{ "alt"?: { "en"?, "de"? }, "isPrimary"?: true }` (`isPrimary` may only be `true`). **Success Response (200):** `{ "product": { … } }`. **Possible Errors:** `404 PRODUCT_NOT_FOUND`, `404 IMAGE_NOT_FOUND`, `400 VALIDATION_FAILED`.

### `DELETE /v1/admin/products/{id}/images/{imageId}`

**Purpose:** Delete an image (the first remaining one becomes main). **Permission:** `catalog.manage`. **Success Response (200):** `{ "product": { … } }`. **Possible Errors:** `404 PRODUCT_NOT_FOUND`, `404 IMAGE_NOT_FOUND`.

### 8.2 Import and export of the catalogue (CSV, Excel)

The panel reads a spreadsheet and sends its rows; the API checks them, previews what would happen, and writes them once the admin confirms. The export gives the same columns back, so a file can be edited and imported again. The columns, the rules and the flow for the panel are in `doc/CSV_IMPORT_EXPORT.md`; `doc/examples/categories-example.csv` and `doc/examples/products-example.csv` hold every column with sample rows.

The product columns include the stock: `stock_quantity` (the exact count) and `low_stock_threshold` (empty or `0` removes the threshold). A changed count is recorded as an `import` movement with the note "CSV import"; a new product with a count starts its history with a `restock` movement.

### `POST /v1/admin/catalog/import/preview`

**Purpose:** What an import would do, row by row. Nothing is written.

**Permission:** `catalog.manage`.

**Request Body:** `{ "categories"?: Row[], "products"?: Row[], "existing"?: "skip" | "update" }`. A `Row` is one object per row of the file, the column names as keys, the cells as text (numbers and booleans are accepted too). At most 2,000 rows per type. `existing` says what happens to a row that matches a record: `skip` (default) leaves it alone, `update` changes the fields the row provides. Categories are matched by `slug_en` (or the slug the name would get), products by `sku` (or `slug_en`, or the slug name and pack size would get).

**Success Response (200):**

```json
{
  "categories": {
    "summary": { "total": 3, "create": 2, "update": 0, "skip": 1, "unchanged": 0, "error": 0 },
    "rows": [
      { "row": 1, "key": "basmati", "name": "Basmati", "action": "create", "id": null, "changes": [], "problems": [] },
      { "row": 2, "key": "rice-and-grains", "name": "Rice & Grains", "action": "skip", "id": "66f0…", "changes": [], "problems": [] },
      { "row": 3, "key": "snacks", "name": "Snacks", "action": "error", "id": null, "changes": [], "problems": ["parent_slug: \"nowhere\" is neither an existing category nor a row of this file"] }
    ],
    "unknownColumns": []
  },
  "products": { "summary": { "…": "" }, "rows": [ { "row": 1, "key": "RF-00042", "name": "Basmati Rice", "action": "update", "id": "66f3…", "changes": ["stock", "lowStockThreshold"], "problems": [] } ], "unknownColumns": ["colour"] },
  "applied": false,
  "stoppedAt": null
}
```

`row` counts from 1 for the first data row. `action` ∈ `create`, `update` (`changes` names the fields), `skip`, `unchanged`, `error` (`problems` says what; the row is never written). `unknownColumns` lists headers the import ignores. Images, SKUs of existing products and the price history are never changed by an import.

**Possible Errors:** `400 VALIDATION_FAILED` (more than 2,000 rows, or a body that is not rows).

### `POST /v1/admin/catalog/import`

**Purpose:** Write the rows of the same body. Categories first, parents before children; then products, a main pack size before its other sizes, whatever the order of the file. A row may refer to a category or product another row creates.

**Permission:** `catalog.manage`.

**Success Response (200):** the preview shape with `"applied": true`, the ids of created records in `id`, and `"stoppedAt": null` or `{ "type": "categories" | "products", "row": 7 }`: the import stops at the first row that fails while writing; that row is `error` with the reason, the rows before it are written, the rows after it are `skip` with "Not written: the import stopped earlier." Importing the same file again is safe: what exists is matched and skipped or updated.

### `GET /v1/admin/catalog/export?type=categories|products`

**Purpose:** Every category or product as flat rows in the columns of the import.

**Permission:** `catalog.read`.

**Success Response (200):** `{ "type": "products", "columns": ["sku", "gtin", …, "stock_quantity", "low_stock_threshold", …], "rows": [ { "sku": "RF-00001", "regular_price": "19.99", "vat_rate": "7", "is_available": "yes", "stock_quantity": "40", "low_stock_threshold": "", "tags": "vegan|new", … } ] }`. Every cell is a string in the writing of the import; categories in display order, products by SKU. The panel writes the `.xlsx` or `.csv` file. The rows import again as `unchanged`.

---

## 9. Orders

An order is created by the customer at checkout and confirmed by the payment. The admin moves it through processing, dispatch and delivery, sets the delivery method and the tracking number, corrects delivered quantities, or cancels it. Everything the customer saw when paying is copied into the order (names, prices, VAT, the fee, the address): what changes in the catalogue afterwards does not change the order.

**How an order comes about.** `POST /v1/store/checkout` prices the cart again, checks that every line is in stock (without reserving anything), creates the order as `pending_payment` and opens a Stripe payment page on which the bank approves the amount. When Stripe reports the approval (webhook, or the customer's return to the shop), the API takes the stock of every item, captures the money, issues the invoice, sets the order to `confirmed` with the payment `paid`, empties the cart and sends the confirmation with the invoice PDF. If an item sold out in the meantime, nothing is charged: the approval is let go of and the order is cancelled with the reason `sold_out`. An order whose payment page expired is cancelled by the cleanup job with the reason `payment_not_completed` (section 16); the customer can open a new page for a pending order whose page expired or whose payment failed, and can give up a pending order at any time.

### 9.1 Statuses and transitions

`status`: `pending_payment`, `confirmed`, `processing`, `dispatched`, `delivered`, `cancelled`, `returned`.

```
pending_payment → confirmed (by the payment, never by hand), cancelled
confirmed       → processing, dispatched
processing      → confirmed, dispatched
dispatched      → processing, delivered
delivered       → dispatched
returned, cancelled → (none)
```

Forward steps are `processing`, `dispatched`, `delivered`; one step back corrects a mistake and tells the customer nothing. `allowedStatuses` in the order detail is authoritative (`[]` for a pending order: the payment confirms it). `cancelled` has its own endpoint: the admin can cancel in `pending_payment`, `confirmed`, `processing` and `dispatched` (`canCancel`); after delivery the way back is a return. `returned` is set when a completed return brought everything of a delivered order back. Delivery method/tracking and quantity corrections are possible in `confirmed`, `processing`, `dispatched` and `delivered`.

Customers can cancel by the rule in `settings.orderPolicy.customerCancellation`: `never` = only while `pending_payment`, `while_confirmed` = also while `confirmed`, `until_dispatched` (default) = also while `processing`.

`paymentStatus`: `pending` (the customer has not paid yet), `authorized` (the bank approved the amount; the stock is being taken and the money captured), `paid` (captured), `failed` (the last attempt did not go through, or the page expired; the customer can pay again), `refunded` (everything that was paid went back). Section 11 has the details.

### 9.2 Order objects

**Summary** (lists, attention):

```json
{
  "id": "66f0…",
  "orderNumber": "RF-1084",
  "status": "dispatched",
  "paymentStatus": "paid",
  "placedAt": "2026-09-28T10:15:00.000Z",
  "customer": { "id": "66e1…", "email": "priya@example.com", "firstName": "Priya", "lastName": "Shah", "phone": "+49…", "name": "Priya Shah" },
  "total": 3097,
  "finalTotal": 3097,
  "paidAmount": 3097,
  "currency": "EUR",
  "lineCount": 2,
  "itemCount": 3,
  "city": "Frankfurt am Main",
  "postalCode": "60311",
  "delivery": {
    "method": "dhl", "trackingNumber": "00340434161094015902",
    "trackingUrl": "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161094015902&lang=en",
    "dispatchedAt": "2026-10-21T08:00:00.000Z", "deliveredAt": null
  }
}
```

`customer.firstName/lastName/phone` may be absent; `name` is `null` when both names are missing. `total` = agreed bill, `finalTotal` = after corrections and returns (the invoiced amount minus credit notes), `paidAmount` = what was captured. `trackingUrl` is the carrier's page for DHL and Hermes, `null` for delivery by Radhe Foods and while there is no tracking number.

**Detail** = summary plus:

```json
{
  "language": "de",
  "items": [
    {
      "productId": "66e9…", "sku": "ATTA-5KG",
      "name": { "en": "Chakki Atta", "de": "Chakki Atta" },
      "packSize": { "value": 5, "unit": "kg", "label": "5 kg" },
      "imageUrl": "https://cdn…/small.webp",
      "quantity": 2, "unitPrice": 1299, "regularUnitPrice": 1499, "lineTotal": 2598,
      "vatRate": 700, "vatPercent": 7, "vatAmount": 170,
      "deliveredQuantity": 2, "returnedQuantity": 0, "finalLineTotal": 2598
    }
  ],
  "totals": { "currency": "EUR", "subtotal": 2598, "deliveryFee": 499, "total": 3097, "netTotal": 2894, "vatTotal": 203, "vat": [ { "vatRate": 700, "gross": 3097, "net": 2894, "vat": 203 } ] },
  "finalTotals": { "…same shape…": "" },
  "adjustments": [ { "productId": "66e9…", "sku": "ATTA-5KG", "from": 2, "to": 1, "reason": "damaged", "note": "box crushed", "adminId": "66d0…", "admin": { "id": "66d0…", "name": "Vrushabh" }, "at": "…" } ],
  "deliveryAddress": { "firstName": "Priya", "lastName": "Shah", "street": "Hauptstraße", "houseNumber": "12", "postalCode": "60311", "city": "Frankfurt am Main", "countryCode": "DE" },
  "note": null,
  "payment": { "…admin payment block (11.1)…": "" },
  "canCancel": true,
  "allowedStatuses": ["processing", "delivered"],
  "cancellation": null,
  "consent": { "acceptedAt": "…", "documents": [ { "type": "terms", "version": 3, "documentId": "66c0…" }, { "type": "privacy", "version": 2, "documentId": "66c1…" } ], "ip": "203.0.113.5", "userAgent": "Mozilla/5.0 …" },
  "statusHistory": [
    { "field": "order", "from": null, "to": "pending_payment", "at": "…", "by": "customer", "adminId": null, "admin": null, "note": null },
    { "field": "payment", "from": "pending", "to": "authorized", "at": "…", "by": "system", "adminId": null, "admin": null, "note": "Stripe pi_…" },
    { "field": "order", "from": "pending_payment", "to": "confirmed", "at": "…", "by": "system", "adminId": null, "admin": null, "note": "Payment received" },
    { "field": "payment", "from": "authorized", "to": "paid", "at": "…", "by": "system", "adminId": null, "admin": null, "note": "Stripe card pi_…" },
    { "field": "order", "from": "confirmed", "to": "processing", "at": "…", "by": "admin", "adminId": "66d0…", "admin": { "id": "66d0…", "name": "Vrushabh" }, "note": "Packing now" },
    { "field": "delivery", "from": "radhe_delivery", "to": "dhl", "at": "…", "by": "admin", "adminId": "66d0…", "admin": { "id": "66d0…", "name": "Vrushabh" }, "note": null },
    { "field": "order", "from": "processing", "to": "dispatched", "at": "…", "by": "admin", "adminId": "66d0…", "admin": { "id": "66d0…", "name": "Vrushabh" }, "note": null }
  ],
  "updatedAt": "…"
}
```

- `items[].regularUnitPrice` is the crossed-out price when the unit price was a reduced one, else `null`. `finalLineTotal` is the price of the units that were delivered and kept.
- `deliveryAddress` keys `company`, `additionalLine`, `phone` are absent when unset.
- `note` is the customer's note at checkout. `adjustments[].note` is internal; the customer sees the reason only.
- `cancellation`: `null` or `{ reason, text, by: "customer" | "admin" | "system", adminId, admin, at }`. Reasons: section 17.2.
- `statusHistory[].field` ∈ `order`, `payment`, `delivery` (the method changed: `from`/`to` are methods); `by` ∈ `customer`, `admin`, `system`. Payment entries use `to` values `authorized`, `paid`, `failed`, `credited` (a credit note was issued; `note` names it), `refunded` (a refund completed; `note` names it).

### `GET /v1/admin/orders`

**Purpose:** Orders, newest first, with filters.

**Permission:** `orders.read`.

**Parameters (query, all optional):**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `status` | order status | e.g. `confirmed` = paid, waiting to be prepared |
| `paymentStatus` | payment status | e.g. `failed` |
| `customerId` | ObjectId | |
| `email` | email | the customer's email (unknown email → empty list) |
| `orderNumber` | `RF-1084` | exactly one order (any case) |
| `deliveryMethod` | `radhe_delivery` \| `dhl` \| `hermes` | |
| `needsRefund` | boolean | `true`: paid orders whose money waits for the admin: cancelled and not refunded in full, or credited by a correction or a return beyond what was refunded (section 11) |
| `q` | string 1–100 | words of the order number, the customer's name, email or phone; every word must begin a word of the order (`RF-10`, `schmidt`, `anna@exam`, `49151`) |
| `sort` | `createdAt` \| `total` \| `status` \| `paymentStatus`, with `:asc` or `:desc` | default `createdAt:desc`; `total` is the final bill |
| `limit`, `cursor` | | cursor pagination |

**Success Response (200):** `{ "items": [ …summaries… ], "nextCursor": "66f0…" | null }`.

### `GET /v1/admin/orders/count`

**Permission:** `orders.read`. **Parameters:** the filters of the list (`status`, `paymentStatus`, `customerId`, `email`, `orderNumber`, `deliveryMethod`, `needsRefund`, `q`). **Success Response (200):** `{ "total": 312 }` (`0` for an unknown email).

### `POST /v1/admin/orders/bulk/status`

**Purpose:** Chosen orders on to a status, along the normal way only: `processing` from `confirmed`, `dispatched` from `confirmed` or `processing`, `delivered` from `dispatched`. Orders in any other status are left where they are. Each customer whose order was dispatched or delivered is notified. Every order is answered.

**Permission:** `orders.manage`. **Request Body:** `{ "orderIds": ObjectId[] (1–500), "status": "processing" | "dispatched" | "delivered", "note"?: string (≤500) }`.

**Success Response (200):**

```json
{
  "status": "dispatched",
  "changed": 2,
  "results": [
    { "orderId": "66f0…", "orderNumber": "RF-1084", "changed": true, "reason": null },
    { "orderId": "66f1…", "orderNumber": "RF-1085", "changed": false, "reason": "An order that is \"cancelled\" cannot be set to \"dispatched\"." },
    { "orderId": "66f2…", "orderNumber": null, "changed": false, "reason": "Order not found." }
  ]
}
```

`changed` counts the orders that moved; `results` has one entry per id sent (duplicates are answered once), in the order sent. Each changed order gets a `statusHistory` entry with the note. **Possible Errors:** `400 VALIDATION_FAILED` (empty list, a status outside the three, a malformed id).

### `POST /v1/admin/orders/bulk/delivery-method`

**Purpose:** The delivery method of chosen orders that are `confirmed`, `processing`, `dispatched` or `delivered`. Tracking numbers of orders whose method changes are removed. Every order is answered as above; `reason` is "The delivery of an order that is \"cancelled\" cannot be changed." or "The order is delivered by \"dhl\" already.".

**Permission:** `orders.manage`. **Request Body:** `{ "orderIds": ObjectId[] (1–500), "method": "radhe_delivery" | "dhl" | "hermes", "note"?: string (≤500) }`. **Success Response (200):** `{ "method": "dhl", "changed": 3, "results": [ … ] }`.

### `GET /v1/admin/orders/{id}`

**Permission:** `orders.read`. **Success Response (200):** `{ "order": { …detail… } }`. **Possible Errors:** `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/status`

**Purpose:** Give an order another status (see 9.1). Asking for the status the order has changes nothing. Forward steps tell the customer: `dispatched` sends the "on its way" email with the tracking number and link (WhatsApp too, when opted in), `delivered` the delivery email; `processing` and every step back send nothing. `dispatched` sets `delivery.dispatchedAt` (and clears `deliveredAt`), `delivered` sets `deliveredAt`; a step back to `processing` or `confirmed` clears both times.

**Permission:** `orders.manage`.

**Request Body:** `{ "status": "confirmed" | "processing" | "dispatched" | "delivered", "trackingNumber"?: string (`^[A-Za-z0-9-]{4,60}$`), "note"?: string (≤500) }` (`confirmed` only as the step back from `processing`; `trackingNumber` is handy when dispatching).

**Success Response (200):** `{ "order": { …detail… } }`

**Possible Errors:** `409 ORDER_TRANSITION_NOT_ALLOWED` (`details: { from, to, allowed }`; `allowed` is `[]` for a pending order, which only its payment confirms), `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`, `400 VALIDATION_FAILED`.

### `PATCH /v1/admin/orders/{id}/delivery`

**Purpose:** Set the delivery method and/or tracking number. Changing the method removes the tracking number (it belongs to one carrier). A changed method is recorded in `statusHistory` (`field: "delivery"`, with the note); a tracking number alone is not.

**Permission:** `orders.manage`. **Request Body:** `{ "method"?: delivery method, "trackingNumber"?: string | null (`null` removes it), "note"?: string (≤500) }`. **Success Response (200):** `{ "order": { … } }`.

**Possible Errors:** `409 ORDER_CANNOT_BE_CHANGED` (`details: { status, allowedIn }` – e.g. a pending or cancelled order), `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`, `400 VALIDATION_FAILED`.

### `PATCH /v1/admin/orders/{id}/items/{productId}`

**Purpose:** Correct how many units of a product were delivered (missing/damaged). The final bill follows; the agreed bill and the delivery fee stay. A credit note is issued in the same transaction (every confirmed order has an invoice), the units that were not delivered go back to the stock (movement `release`), and the order waits for a refund of the credited amount (`payment.needsRefund`, section 11). The delivered quantity cannot go below what was returned already.

**Permission:** `orders.manage`.

**Request Body:** `{ "deliveredQuantity": 1, "reason": "missing" | "damaged" | "wrong_item" | "customer_complaint" | "other", "note"?: string (≤1000, internal) }`

**Success Response (200):** `{ "order": { … } }` (unchanged when `deliveredQuantity` is the current one).

**Possible Errors:** `404 ORDER_ITEM_NOT_FOUND`, `400 ORDER_QUANTITY_INVALID` (`details: { min: returnedQuantity, max: quantity }`), `409 ORDER_CANNOT_BE_CHANGED` (`details: { status, allowedIn }`), `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/cancel`

**Purpose:** Cancel an order that is not delivered yet. The units go back to the stock (movement `cancel`) when they were taken; an open payment page is expired and an approval that was not captured is let go of; the customer gets the cancellation email. What was paid waits for a refund that the admin decides (`payment.needsRefund`, `GET /v1/admin/orders?needsRefund=true`). Cancelling a cancelled order changes nothing.

**Permission:** `orders.manage`.

**Request Body:** `{ "reason": "customer_request" | "product_unavailable" | "duplicate_order" | "suspected_misuse" | "other", "text"?: string (≤1000) }`

**Success Response (200):** `{ "order": { … } }`. **Possible Errors:** `409 ORDER_CANNOT_BE_CANCELLED` (`details: { status }` – delivered or returned), `404 ORDER_NOT_FOUND`, `400 VALIDATION_FAILED` (a reason of the customer's list).

---

## 10. Returns

Customers ask to send single products back after delivery, within `settings.returnPolicy.windowDays` of the delivery; the admin approves (possibly fewer units), rejects, and completes the return once the goods are back, which lowers the final bill (credit note) and makes the order wait for a refund.

### 10.1 Statuses and reasons

```
requested → approved, rejected, cancelled (by the customer)
approved  → completed, rejected
rejected / completed / cancelled → (none)
```

Reasons: `damaged`, `wrong_item`, `quality`, `not_as_described`, `changed_mind`, `other`.

### 10.2 The return object

```json
{
  "id": "66fa…",
  "returnNumber": "RF-1084-R1",
  "orderId": "66f0…",
  "orderNumber": "RF-1084",
  "customerId": "66e1…",
  "customer": { "id": "66e1…", "name": "Priya Shah", "email": "priya@example.com" },
  "status": "approved",
  "requestedAt": "…", "decidedAt": "…", "completedAt": null,
  "items": [
    { "productId": "…", "sku": "ATTA-5KG", "name": { "en": "Chakki Atta", "de": "Chakki Atta" }, "packSize": { "value": 5, "unit": "kg", "label": "5 kg" }, "quantity": 1, "approvedQuantity": 1, "unitPrice": 1299, "vatRate": 700, "reason": "damaged", "comment": "Bag was torn" }
  ],
  "requestedAmount": 1299,
  "customerComment": "Please pick up on Monday.",
  "decisionNote": "We will collect it with the next delivery.",
  "internalNote": null,
  "creditAmount": null,
  "restockedAt": null,
  "statusHistory": [ { "from": null, "to": "requested", "at": "…", "by": "customer", "adminId": null, "admin": null, "note": null } ],
  "updatedAt": "…"
}
```

`decisionNote` is what the customer reads; `internalNote` is not shown to the customer. `approvedQuantity` is `null` until approved. `creditAmount` is set on completion (the cents the final bill went down by, delivery fee included when everything came back). `restockedAt` is set when the admin completed the return with `restock: true`, else `null`.

### `GET /v1/admin/returns`

**Permission:** `orders.read`. **Parameters (query):** `status`, `orderNumber` (any case), `customerId`, `sort` (`createdAt` | `status`, with `:asc`/`:desc`), `limit`, `cursor`. **Success Response (200):** `{ "items": [ … ], "nextCursor" }` (`status=requested` = waiting for a decision).

### `GET /v1/admin/returns/count`

**Permission:** `orders.read`. **Parameters:** `status`, `orderNumber`, `customerId`. **Success Response (200):** `{ "total": 4 }`.

### `GET /v1/admin/returns/{id}`

**Permission:** `orders.read`. **Success Response (200):** `{ "return": { … } }`. **Possible Errors:** `404 RETURN_NOT_FOUND`.

### `POST /v1/admin/returns/{id}/approve`

**Purpose:** Accept the return, as asked or with other quantities (`0` declines a product). The order does not change yet. The customer is notified (`return_approved`).

**Permission:** `orders.manage`.

**Request Body:** `{ "items"?: [ { "productId": "…", "quantity": 0–10000 } ], "note"?: string (≤1000, to the customer), "internalNote"?: string (≤2000) }` — leave `items` out to accept the requested quantities.

**Success Response (200):** `{ "return": { … } }` (unchanged when approved already)

**Possible Errors:** `409 RETURN_TRANSITION_NOT_ALLOWED` (`details: { from, to }`), `400 RETURN_QUANTITY_INVALID` (more than requested: `details: { productId, max }`; or everything 0: "Nothing is accepted. Reject the return instead."), `400 ORDER_ITEM_NOT_FOUND` (`details: { productIds }`), `409 ORDER_CHANGED_MEANWHILE`, `404 RETURN_NOT_FOUND`.

### `POST /v1/admin/returns/{id}/reject`

**Purpose:** Decline (while requested or approved). The customer is notified (`return_rejected`); the units can be asked for again. **Permission:** `orders.manage`. **Request Body:** `{ "note"?, "internalNote"? }`. **Success Response (200):** `{ "return": { … } }`. **Possible Errors:** `409 RETURN_TRANSITION_NOT_ALLOWED`, `409 ORDER_CHANGED_MEANWHILE`, `404 RETURN_NOT_FOUND`.

### `POST /v1/admin/returns/{id}/complete`

**Purpose:** The goods are back: the accepted units are booked on the order (`returnedQuantity`), its final bill goes down by `creditAmount`, a credit note is issued in the same transaction, and the customer is notified (`return_completed`). When everything of a delivered order came back, the order becomes `returned` and the delivery fee is credited as well. With `restock: true` the accepted units go back on the shelf (stock movement `return`, `restockedAt` set); leave it out for food that cannot be sold again. The refund of the credited amount is a separate decision of the admin (section 11): the order shows `payment.needsRefund` and `refundable.suggested`. Completing a completed return changes nothing.

**Permission:** `orders.manage`. **Request Body:** `{ "note"?: string (≤1000), "internalNote"?: string (≤2000), "restock"?: boolean }`. **Success Response (200):** `{ "return": { …, "status": "completed", "creditAmount": 1299, "restockedAt": "…" | null } }`.

**Possible Errors:** `409 RETURN_TRANSITION_NOT_ALLOWED` (must be `approved`; `details: { from, to }`), `409 RETURN_QUANTITY_INVALID` (`details: { productId, sku }` – more than delivered), `409 ORDER_CHANGED_MEANWHILE`, `404 RETURN_NOT_FOUND`, `404 ORDER_NOT_FOUND`.

---

## 11. Payments and refunds

Every order is paid at checkout, through Stripe (card or PayPal), before anything is taken from the stock: the bank approves the amount on Stripe's page, the webhook brings the approval, the API takes the stock and only then captures the money (section 9). The admin never records a payment. What the admin decides are **refunds**: through Stripe (the money goes back to the card or PayPal account) or by hand (bank transfer, cash, or another way the admin records).

**How a refund comes about.** Money waits for a refund in two cases: a paid order was cancelled (by the customer or the admin; `refundable.suggested` is then everything that was paid), or a correction (`PATCH /v1/admin/orders/{id}/items/{productId}`) or a completed return lowered the final bill and a credit note was issued (`suggested` is what the credit notes took off the bill and has not gone back yet). Both show as `payment.needsRefund: true` on the order, are listed by `GET /v1/admin/orders?needsRefund=true` and counted on the start page (section 15). The admin reads `refundable`, then decides with `POST /v1/admin/orders/{id}/payment/refunds`: `method: "stripe"` is asked of Stripe at once and completes when Stripe confirms; `method: "manual"` waits as `pending` until the admin has sent the money and completes it. When a refund completes, the order's `refundedAmount` rises, `paymentStatus` becomes `refunded` once everything paid went back, and the customer gets the `refund_completed` email.

### 11.1 The admin payment block (`order.payment`)

```json
{
  "status": "paid",
  "amount": 2896,
  "paidAmount": 2896,
  "creditedAmount": 0,
  "refundedAmount": 0,
  "method": "paypal",
  "paidAt": "2026-09-28T10:15:00.000Z",
  "receiptUrl": "https://pay.stripe.com/receipts/…",
  "invoice": { "number": "INV-2026-000123", "issuedAt": "2026-09-28T10:15:00.000Z", "pdfPath": "/v1/store/invoices/INV-2026-000123/pdf" },
  "checkout": null,
  "canPayOnline": false,
  "lastFailure": null,
  "attempts": 1,
  "checkoutSessionId": null,
  "checkoutExpiresAt": null,
  "paymentIntentId": "pi_…",
  "chargeId": "ch_…",
  "authorizedAt": "2026-09-28T10:14:58.000Z",
  "invoiceId": "66f1…",
  "refundableAmount": 2896,
  "needsRefund": false
}
```

- `status` = the payment status (9.1). `amount` is the total agreed at checkout; `paidAmount` what was captured; `creditedAmount` the sum of credit notes issued after the invoice; `refundedAmount` the sum of completed refunds.
- `method` is `card` or `paypal` once paid, else `null`. `invoice` is `null` until the invoice is issued (`issuedAt` = `paidAt`; `pdfPath` is relative to the API and meant for the shop; the panel uses `GET /v1/admin/invoices/{id}/pdf` with `invoiceId`).
- `checkout` is `{ "url", "expiresAt" }` while a payment page is open (pending order, page not expired), else `null`. `canPayOnline` is true while the order is `pending_payment` with the payment `pending` or `failed` and Stripe is configured. `attempts` counts the payment pages opened. `lastFailure` says why the last attempt did not go through.
- `refundableAmount` = `paidAmount − refundedAmount`. `needsRefund` = `refundableAmount > 0` and (the order is cancelled, or `creditedAmount − refundedAmount > 0`). The `refundable` object with the suggested amount is answered by `GET /v1/admin/orders/{id}/payment`.

### `GET /v1/admin/orders/{id}/payment`

**Purpose:** Everything about the payment of an order: the block, the documents, the refunds, and what can be refunded.

**Permission:** `payments.read`.

**Success Response (200):**

```json
{
  "orderNumber": "RF-1084",
  "status": "delivered",
  "payment": { "…admin payment block…": "" },
  "refundable": { "paidAmount": 2896, "refundedAmount": 0, "openAmount": 0, "maximum": 2896, "suggested": 399, "stripePossible": true },
  "documents": [ { "…invoice summary (12.1)…": "" } ],
  "refunds": [ { "…refund (11.2)…": "" } ]
}
```

`status` is the order status. `refundable.openAmount` = refunds that are `pending` or `processing`; `maximum` = paid − refunded − open; `suggested` = what the cancellation (everything paid) or the credit notes (`creditedAmount`) call for, minus what went back or is on its way, at most `maximum`; `stripePossible` = the order was paid through Stripe (a payment intent exists), so Stripe can refund. `documents` are oldest first (the invoice, then its credit notes), `refunds` newest first. **Possible Errors:** `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/payment/refunds`

**Purpose:** Decide a refund. Read `refundable` first.

**Permission:** `payments.manage`.

**Request Body:**

```json
{ "amount": 399, "reason": "adjustment", "method": "manual", "manual": { "way": "bank_transfer", "reference": "DE89…" }, "note": "Damaged bag" }
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `amount` | int cents | yes | 1–10 000 000, ≤ `refundable.maximum` |
| `reason` | `return` \| `adjustment` \| `goodwill` \| `duplicate_payment` \| `other` | yes | |
| `method` | `stripe` \| `manual` | yes | `stripe` only when `refundable.stripePossible` |
| `manual` | `{ way: bank_transfer \| cash \| other, reference?: string (≤200) }` | for `manual` | missing for `manual` → `400 VALIDATION_FAILED` |
| `note` | string | no | ≤1000, internal |

**Success Response (201):** `{ "refund": { … } }`. `status` is `pending` for a manual refund. For a Stripe refund the answer carries what Stripe said: `completed` (confirmed at once, `stripe.stripeStatus: "succeeded"`, `completedAt` set, the order already updated), `processing` (Stripe is still working; the webhook or `POST /v1/admin/refunds/{id}/sync` completes it) or `failed` (`stripe.failureReason`, e.g. `insufficient_funds`; withdraw it with `/cancel` and refund by hand).

**Possible Errors:** `409 REFUND_AMOUNT_INVALID` (nothing was paid), `400 REFUND_AMOUNT_INVALID` (more than `maximum`; `details` = the `refundable` object), `400 REFUND_METHOD_INVALID` (`stripe` for an order not paid through Stripe), `503 PAYMENTS_NOT_CONFIGURED` / `502 PAYMENT_PROVIDER_ERROR` (Stripe), `404 ORDER_NOT_FOUND`, `400 VALIDATION_FAILED`.

### 11.2 The refund object

```json
{
  "id": "66f1…",
  "refundNumber": "RF-1084-RF1",
  "orderId": "66f1…",
  "orderNumber": "RF-1084",
  "customerId": "66e1…",
  "customer": { "id": "66e1…", "name": "Priya Shah", "email": "priya@example.com" },
  "invoiceNumber": "INV-2026-000123",
  "amount": 399,
  "reason": "adjustment",
  "method": "stripe",
  "status": "completed",
  "manual": null,
  "stripe": { "refundId": "re_…", "paymentIntentId": "pi_…", "stripeStatus": "succeeded", "failureReason": null },
  "note": null,
  "createdBy": "66f1…",
  "createdByAdmin": { "id": "66f1…", "name": "Vrushabh" },
  "createdAt": "2026-09-29T09:00:00.000Z",
  "completedAt": "2026-09-29T09:00:01.000Z",
  "statusHistory": [
    { "from": null, "to": "pending", "at": "…", "by": "admin", "adminId": "66f1…", "admin": { "id": "66f1…", "name": "Vrushabh" }, "note": null },
    { "from": "pending", "to": "completed", "at": "…", "by": "stripe", "adminId": null, "admin": null, "note": "Stripe: succeeded" }
  ]
}
```

`status` ∈ `pending` (manual, waiting for the admin), `processing` (Stripe working), `completed`, `failed` (Stripe could not refund), `cancelled` (withdrawn by the admin). `manual`: `{ "way", "reference", "paidAt" }` or `null`. `statusHistory[].by` is `admin` or `stripe`.

### `GET /v1/admin/refunds`

**Permission:** `payments.read`. **Parameters (query):** `status` (`pending` = waiting for the admin), `orderNumber`, `sort` (`createdAt` | `amount` | `status`, with `:asc`/`:desc`), `limit`, `cursor`. **Success Response (200):** `{ "items": [ … ], "nextCursor" }`.

### `GET /v1/admin/refunds/count`

**Permission:** `payments.read`. **Parameters:** `status`, `orderNumber`. **Success Response (200):** `{ "total": 2 }`.

### `GET /v1/admin/refunds/{id}`

**Permission:** `payments.read`. **Success Response (200):** `{ "refund": { … } }`. **Possible Errors:** `404 REFUND_NOT_FOUND`.

### `POST /v1/admin/refunds/{id}/complete`

**Purpose:** The money was sent by hand: complete a `pending` manual refund. The order's `refundedAmount` rises and the customer is notified. Completing a completed refund changes nothing. **Permission:** `payments.manage`. **Request Body:** `{ "paidAt"?: ISO (default now), "reference"?: string (≤200), "note"?: string (≤1000) }`. **Success Response (200):** `{ "refund": { … } }`.

**Possible Errors:** `409 REFUND_TRANSITION_NOT_ALLOWED` (`details: { status, method }` – a Stripe refund is completed by Stripe, or the refund is not `pending`), `409 ORDER_CHANGED_MEANWHILE`, `404 REFUND_NOT_FOUND`.

### `POST /v1/admin/refunds/{id}/cancel`

**Purpose:** Withdraw a `pending` or `failed` refund. **Permission:** `payments.manage`. **Request Body:** `{ "note"?: string (≤1000) }`. **Success Response (200):** `{ "refund": { … } }`. **Possible Errors:** `409 REFUND_TRANSITION_NOT_ALLOWED` (`details: { status }`), `404 REFUND_NOT_FOUND`.

### `POST /v1/admin/refunds/{id}/sync`

**Purpose:** Ask Stripe how a `processing` or `failed` Stripe refund stands (normally the webhook does this); a completed or cancelled refund, or a manual one, is answered unchanged. **Permission:** `payments.manage`. **Success Response (200):** `{ "refund": { … } }`. **Possible Errors:** `503 PAYMENTS_NOT_CONFIGURED`, `502 PAYMENT_PROVIDER_ERROR`, `404 REFUND_NOT_FOUND`.

---

## 12. Invoices and credit notes

The invoice is issued the moment the payment is captured (the order becomes `confirmed`): it is attached to the confirmation email and available to the customer at `GET /v1/store/invoices/{number}/pdf`. A credit note is issued for every correction and every completed return of the order. Numbered without gaps per type and year; never changed. PDFs are rendered on request.

### 12.1 Objects

**Summary:**

```json
{
  "id": "66f1…",
  "number": "INV-2026-000123",
  "type": "invoice",
  "orderNumber": "RF-1084",
  "issuedAt": "2026-09-28T10:15:00.000Z",
  "paidAt": "2026-09-28T10:15:00.000Z",
  "total": 3097,
  "currency": "EUR",
  "language": "de",
  "invoiceNumber": null,
  "creditReason": null
}
```

`type` ∈ `invoice`, `credit_note`. An invoice carries `paidAt` (it is issued paid). A credit note has `paidAt` `null`, `invoiceNumber` = the invoice it corrects, `creditReason` ∈ `return`, `adjustment`, and `total` = what is credited.

**Detail** = summary plus `orderId`, `customerId`, `creditReference` (the return number, or `<sku>: <reason>` of a correction; `null` on an invoice), `seller { name, addressLines[], email, phone, website, vatId, taxNumber, registration }`, `customer { name, company, addressLines[], email }`, `lines[] { description, sku, quantity, unitPrice, vatRate, vatPercent, lineTotal }`, `totals { currency, subtotal, deliveryFee, total, netTotal, vatTotal, vat[] { vatRate, gross, net, vat } }`, `footer`. Unset optional values are `null`.

### `GET /v1/admin/invoices`

**Permission:** `payments.read`. **Parameters (query):** `type` (`invoice` \| `credit_note`), `orderNumber`, `customerId`, `number` (one document exactly, `INV-2026-000123` or `CN-2026-000007`, any case), `q` (the beginning of a number, `INV-2026-0001`; ignored when `number` is given), `limit`, `cursor`. **Success Response (200):** `{ "items": [ …summaries, newest first… ], "nextCursor" }`. **Possible Errors:** `400 VALIDATION_FAILED` (`number` not of that form).

### `GET /v1/admin/invoices/{id}`

**Permission:** `payments.read`. **Success Response (200):** `{ "invoice": { …detail… } }`. **Possible Errors:** `404 INVOICE_NOT_FOUND`.

### `GET /v1/admin/invoices/{id}/pdf`

**Permission:** `payments.read`. **Success Response (200):** binary PDF, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="INV-2026-000123.pdf"`, `Cache-Control: private, no-store`. Open it with `fetch` + `credentials: 'include'` and a Blob URL (or a same-site link). **Possible Errors:** `404 INVOICE_NOT_FOUND`.

---

## 13. Notifications

Every message to a customer (email, and WhatsApp when configured and opted in) is a record: what was sent, to whom, about which order/return/refund/announcement, its status, attempts and errors. Messages are queued by the events (order confirmed, dispatched, delivered, …) and sent by the API itself with retries; the admin sees them all, retries failed ones and cancels queued ones. There is no separate admin channel: what needs attention is in section 15.

### 13.1 Types, channels, statuses

| `type` | Sent when | WhatsApp too? |
| --- | --- | --- |
| `order_confirmed` | the payment was captured: the order is confirmed (invoice PDF attached) | – |
| `order_cancelled` | cancelled by the customer or the admin, or by the shop because an item sold out while the customer was paying (nothing was charged). Not sent for an order that was given up without a payment | – |
| `order_dispatched` | dispatched (single or chosen orders), with the tracking number and link | yes |
| `order_delivered` | delivered | – |
| `return_requested` / `return_approved` / `return_rejected` / `return_completed` | return events | – |
| `payment_failed` | Stripe reported a failed attempt on a pending order; the customer can pay again | – |
| `refund_completed` | refund complete | – |
| `announcement` | admin news (section 14) | yes (marketing consent) |

`channel` ∈ `email`, `whatsapp`. `status` ∈ `queued` (waiting or due for a retry), `sending`, `sent`, `failed` (given up: 4xx from the provider, or 6 attempts), `skipped` (not sent on purpose, e.g. WhatsApp not configured), `cancelled`. Retries after a retryable failure: 1 min, 5 min, 30 min, 2 h, 12 h.

### 13.2 The notification object

```json
{
  "id": "66f1…",
  "type": "order_confirmed",
  "channel": "email",
  "to": "anna@example.com",
  "customerId": "66f1…",
  "customer": { "id": "66f1…", "name": "Anna Schmidt", "email": "anna@example.com" },
  "orderId": "66f1…",
  "orderNumber": "RF-1084",
  "productId": null,
  "returnId": null,
  "refundId": null,
  "announcementId": null,
  "locale": "de",
  "subject": "Ihre Bestellung RF-1084",
  "attachments": [ { "kind": "invoice_pdf", "id": "66f1…" } ],
  "status": "sent",
  "attempts": 1,
  "maxAttempts": 6,
  "nextAttemptAt": null,
  "sentAt": "2026-09-28T10:15:03.000Z",
  "providerMessageId": "0100018…@email.amazonses.com",
  "lastError": null,
  "reason": null,
  "history": [ { "at": "2026-09-28T10:15:03.000Z", "ok": true } ],
  "createdAt": "…", "updatedAt": "…"
}
```

`to` is the email address or the WhatsApp number. `subject` is set for emails only. `attachments[].kind` is `invoice_pdf` (the id of the invoice). `reason` explains a `skipped`/`cancelled` record. `history[]` entries are `{ at, ok, error? }`. The detail adds `data`: the values the message was rendered from (e.g. `orderNumber`, `trackingNumber`, `trackingUrl`).

### `GET /v1/admin/notifications`

**Permission:** `notifications.read`.

**Parameters (query, all optional):** `status`, `type`, `channel`, `customerId`, `orderId`, `orderNumber`, `announcementId`, `sort` (`createdAt` | `status` | `type` | `channel`, with `:asc`/`:desc`), `limit`, `cursor`. `status=failed` is what needs attention.

**Success Response (200):** `{ "items": [ … ], "nextCursor" }`.

### `GET /v1/admin/notifications/count`

**Permission:** `notifications.read`. **Parameters:** the filters of the list. **Success Response (200):** `{ "total": 120 }`.

### `GET /v1/admin/notifications/summary`

**Permission:** `notifications.read`.

**Success Response (200):**

```json
{ "counts": { "queued": 0, "sending": 0, "sent": 120, "failed": 2, "skipped": 5, "cancelled": 1 }, "whatsappEnabled": false }
```

### `GET /v1/admin/notifications/{id}`

**Permission:** `notifications.read`. **Success Response (200):** `{ "notification": { …object plus "data": { … }… } }`. **Possible Errors:** `404 NOTIFICATION_NOT_FOUND`.

### `POST /v1/admin/notifications/{id}/retry`

**Purpose:** Send a `failed`, `skipped` or `cancelled` message again (a full round of attempts). **Permission:** `notifications.manage`. **Success Response (200):** `{ "notification": { … } }`.

**Possible Errors:** `409 NOTIFICATION_TRANSITION_NOT_ALLOWED` (already sent/queued; a WhatsApp message while WhatsApp is not configured; a type that has no WhatsApp template), `404 NOTIFICATION_NOT_FOUND`.

### `POST /v1/admin/notifications/{id}/cancel`

**Purpose:** Withdraw a `queued` message. **Permission:** `notifications.manage`. **Request Body:** `{ "reason"?: string (≤500) }`. **Success Response (200):** `{ "notification": { …, "status": "cancelled" } }`. **Possible Errors:** `409 NOTIFICATION_TRANSITION_NOT_ALLOWED`, `404 NOTIFICATION_NOT_FOUND`.

### `POST /v1/admin/notifications/run`

**Purpose:** Work the queue now (it runs by itself every minute; this is for a look at it). **Permission:** `notifications.manage`. **Success Response (200):** `{ "sent": 3, "retried": 1, "failed": 0, "skipped": 0, "recovered": 0 }`.

---

## 14. Announcements ("Notify customers")

News about a product or an offer, written by the admin, sent to the customers who opted in to news (`marketingOptIn`), by email and — when chosen and configured — by WhatsApp to those who also opted in to WhatsApp. **Never automatic:** creating a product sends nothing. Every message lands in the notifications list with the `announcementId`.

### 14.1 Objects

**Announcement:**

```json
{
  "id": "66f1…",
  "subject": { "en": "Fresh mangoes are in", "de": "Frische Mangos sind da" },
  "message": { "en": "…", "de": "…" },
  "link": "https://radhefoods.de/products/alphonso-mango",
  "linkLabel": null,
  "productId": "66f1…",
  "productName": "Alphonso mango",
  "channels": ["email", "whatsapp"],
  "recipients": 148,
  "queued": 171,
  "createdBy": "66f1…",
  "createdByAdmin": { "id": "66f1…", "name": "Vrushabh" },
  "cancelledAt": null,
  "cancelledBy": null,
  "cancelledByAdmin": null,
  "createdAt": "2026-09-30T09:00:00.000Z"
}
```

`recipients` = customers addressed; `queued` = messages queued by any channel. `productName` is the English name at the time of sending.

**Progress** (counts per channel and status, always all keys):

```json
{ "email": { "queued": 0, "sending": 0, "sent": 148, "failed": 0, "skipped": 0, "cancelled": 0 }, "whatsapp": { "queued": 0, "sending": 0, "sent": 20, "failed": 1, "skipped": 2, "cancelled": 0 } }
```

### 14.2 Request body (preview and send)

```json
{
  "subject": { "en": "Fresh mangoes are in", "de": "Frische Mangos sind da" },
  "message": { "en": "The first Alphonso mangoes of the season are in stock now.", "de": "…" },
  "link": "https://radhefoods.de/products/alphonso-mango",
  "linkLabel": { "en": "See the product", "de": "Zum Produkt" },
  "productId": "66f1…",
  "channels": ["email", "whatsapp"]
}
```

| Field | Type | Required | Validation / meaning |
| ----- | ---- | -------- | -------------------- |
| `subject` | `{ en (1–160), de? }` | yes | |
| `message` | `{ en (1–2000), de? (≤2000) }` | yes | line breaks are kept in the email |
| `link` | absolute URL ≤500 | no | the button; defaults to the product page (`<SHOP_URL>/products/<slug.en>`) or the shop |
| `linkLabel` | `{ en (1–160), de? (≤160) }` | no | button label; default "Visit the shop"/"Zum Shop" |
| `productId` | ObjectId | no | the product the news is about (for the record and the lists) |
| `channels` | `["email"]` and/or `["whatsapp"]` | no | default `["email"]` |

### `POST /v1/admin/announcements/preview`

**Purpose:** Who would get it and how it reads. Nothing is sent. Show `recipients` and the rendered HTML before the admin confirms.

**Permission:** `notifications.manage`.

**Success Response (200):**

```json
{
  "recipients": { "email": 148, "whatsapp": 23 },
  "whatsappEnabled": false,
  "link": "https://radhefoods.de/products/alphonso-mango",
  "channels": ["email", "whatsapp"],
  "email": { "en": { "subject": "…", "html": "<!doctype html>…" }, "de": { "subject": "…", "html": "…" } },
  "whatsapp": { "en": { "name": "radhe_announcement", "languageCode": "en", "bodyParameters": ["Anna", "…", "https://…"] }, "de": { "…": "" } }
}
```

`recipients.whatsapp` is `0` unless `whatsapp` is in `channels`. **Possible Errors:** `404 PRODUCT_NOT_FOUND`, `400 VALIDATION_FAILED`.

### `POST /v1/admin/announcements`

**Purpose:** Send: one message per opted-in customer is queued (in their language). **Permission:** `notifications.manage`. **Success Response (201):** `{ "announcement": { … }, "progress": { … } }`.

**Possible Errors:** `409 ANNOUNCEMENT_NO_RECIPIENTS` ("No customer has asked for news yet."), `404 PRODUCT_NOT_FOUND`, `400 VALIDATION_FAILED`.

### `GET /v1/admin/announcements`

**Permission:** `notifications.read`. **Parameters (query):** `productId`, `limit`, `cursor`. **Success Response (200):** `{ "items": [ { …announcement…, "progress": { "email": { "queued", "sending", "sent", "failed", "skipped", "cancelled" }, "whatsapp": { … } } } ], "nextCursor" }` — the same `progress` object as the detail, counted for the whole page in one query.

### `GET /v1/admin/announcements/{id}`

**Permission:** `notifications.read`. **Success Response (200):** `{ "announcement": { … }, "progress": { … } }`. **Possible Errors:** `404 ANNOUNCEMENT_NOT_FOUND`.

### `POST /v1/admin/announcements/{id}/cancel`

**Purpose:** Withdraw the messages that have not gone out yet. **Permission:** `notifications.manage`. **Success Response (200):** `{ "announcement": { …, "cancelledAt": "…" }, "progress": { … } }`. **Possible Errors:** `404 ANNOUNCEMENT_NOT_FOUND`.

---

## 15. Attention overview (start page)

### `GET /v1/admin/attention`

**Purpose:** What waits for the admin, in one call: paid orders to prepare, refunds to decide, return requests, products that run low, failed messages. Each group has a count and the newest five; the module lists give the rest (`orders?status=confirmed`, `orders?needsRefund=true`, `refunds?status=pending` / `failed`, `returns?status=requested`, `products?lowStock=true`, `notifications?status=failed`).

**Permission:** `orders.read`.

**Success Response (200):**

```json
{
  "orders": { "toProcess": 4, "items": [ { "…order summary (9.2)…": "" } ] },
  "refunds": {
    "needed": 1,
    "orders": [ { "…order summary…": "" } ],
    "pending": 1,
    "failed": 0,
    "items": [ { "…refund (11.2)…": "" } ]
  },
  "returns": { "requested": 3, "items": [ { "…return (10.2)…": "" } ] },
  "stock": { "low": 2, "items": [ { "…product summary (8.1)…": "" } ] },
  "notifications": { "failed": 2, "queued": 0, "items": [ { "…notification (13.2)…": "" } ] }
}
```

- `orders.toProcess` = orders in `confirmed` (paid, not yet in processing); `items` the newest five.
- `refunds.needed` = paid orders whose money waits for the admin, exactly what `GET /v1/admin/orders?needsRefund=true` lists: cancelled and not refunded in full, or credited by a correction or a completed return beyond what was refunded (section 11); `orders` the newest five of them (with `paidAmount`); `pending` / `failed` = refunds in those statuses, `items` the newest five `pending` refunds.
- `stock.low` = products at or below their low-stock threshold, `items` the five most recently updated.
- `notifications.items` are the newest five `failed` messages, in the shape of the notifications list.

---

## 16. Server-side endpoints (not called by the panel UI)

Documented so the whole surface is known.

### `POST /v1/jobs/run`

**Purpose:** Runs every scheduled job in one call, for an external timer (a cron job every few minutes on the hosting, which also keeps a sleeping process awake): first the checkout cleanup, then the notification queue. The API runs both by itself while the process is up: the cleanup 15 seconds after the start and then at every full `PAYMENT_JOB_INTERVAL_MINUTES` on the clock (default 60), the queue every minute. **Authentication:** header `X-Jobs-Token: <JOBS_TOKEN>` (server secret; the endpoint is off when no token is configured). Not rate limited.

The checkout cleanup gives up orders whose payment page expired and whose grace time passed (`cancelled`, reason `payment_not_completed`, no email; an open Stripe page is expired) and finishes orders whose payment was approved but never settled (a crash in between): they are settled late or, when sold out meanwhile, cancelled with `sold_out`.

**Success Response (200):**

```json
{ "startedAt": "…", "finishedAt": "…", "checkout": { "expired": 1, "settled": 0 }, "notifications": { "sent": 5, "retried": 0, "failed": 0, "skipped": 0, "recovered": 0 } }
```

**Possible Errors:** `403 JOBS_TOKEN_INVALID`.

### `POST /v1/webhooks/stripe`

Stripe's webhook (header `stripe-signature`, verified with the webhook secret; the raw body is needed). Handles `checkout.session.completed` and `checkout.session.async_payment_succeeded` (settle the order: stock, capture, invoice, confirmation), `checkout.session.async_payment_failed` and `payment_intent.payment_failed` (payment `failed`, `payment_failed` email), `checkout.session.expired` (the page is forgotten), `refund.created`, `refund.updated`, `charge.refund.updated` and `charge.refunded` (the refund records follow Stripe). Every event is processed once (`paymentEvents`). Answers `{ "received": true, "handled": true | false }` (`false` for an event seen before); `400 WEBHOOK_SIGNATURE_INVALID`, `503 PAYMENTS_NOT_CONFIGURED`. Not for the panel.

### `GET /health`, `GET /health/live`

`{ "status": "ok", "database": "up", "uptimeSeconds": 1234 }` / `{ "status": "ok" }`; `503 SERVICE_UNAVAILABLE` when the database is unreachable.

---

## 17. Reference

### 17.1 Permission matrix

| Area | Read | Manage |
| ---- | ---- | ------ |
| Admin users | `admin_users.read` | `admin_users.manage` |
| Roles | `roles.read` | `roles.manage` |
| Customers | `customers.read` | `customers.manage` |
| Categories, products, stock, images, import/export | `catalog.read` | `catalog.manage` |
| Orders, bulk actions, returns, attention overview | `orders.read` | `orders.manage` |
| Settings | `settings.read` | `settings.manage` |
| Legal texts | `legal.read` | `legal.manage` |
| Payment of an order, refunds, invoices | `payments.read` | `payments.manage` |
| Notifications, announcements | `notifications.read` | `notifications.manage` |

Auth endpoints (`me`, `change-password`, `logout-all`) need any signed-in admin.

### 17.2 Enums

| Enum | Values |
| ---- | ------ |
| Admin status | `active`, `disabled` |
| Customer status | `active`, `blocked`; sign-up method `email_otp`, `google` |
| Product status | `draft`, `active`, `archived` |
| Pack units | `g`, `kg`, `ml`, `l`, `pcs`; `basePrice.per` `kg`, `l`, `pcs` |
| Storage type | `ambient`, `chilled`, `frozen` |
| Product sort (admin) | `newest`, `updated`, `name`, `sku`, `price_asc`, `price_desc` |
| Image sizes | `small` (320 px), `medium` (800 px), `large` (1600 px) |
| Stock movement reason | `restock`, `adjustment`, `import`, `order`, `cancel`, `return`, `release` |
| Order status | `pending_payment`, `confirmed`, `processing`, `dispatched`, `delivered`, `cancelled`, `returned` |
| Status an admin can set | `confirmed`, `processing`, `dispatched`, `delivered`; in bulk `processing`, `dispatched`, `delivered` |
| Payment status | `pending`, `authorized`, `paid`, `failed`, `refunded`; Stripe payment type `card`, `paypal` |
| Delivery method | `radhe_delivery`, `dhl`, `hermes` |
| Cancellation reason | admin: `customer_request`, `product_unavailable`, `duplicate_order`, `suspected_misuse`, `other`; customer: `changed_mind`, `ordered_by_mistake`, `wrong_items`, `delivery_too_late`, `other`; system: `payment_not_completed`, `sold_out` |
| Adjustment reason | `missing`, `damaged`, `wrong_item`, `customer_complaint`, `other` |
| Customer cancellation rule | `while_confirmed`, `until_dispatched`, `never` |
| Order history | `field` `order`, `payment`, `delivery`; `by` `customer`, `admin`, `system` |
| Return status | `requested`, `approved`, `rejected`, `completed`, `cancelled`; reasons `damaged`, `wrong_item`, `quality`, `not_as_described`, `changed_mind`, `other` |
| Refund status | `pending`, `processing`, `completed`, `failed`, `cancelled`; reason `return`, `adjustment`, `goodwill`, `duplicate_payment`, `other`; method `stripe`, `manual`; manual way `bank_transfer`, `cash`, `other` |
| Invoice type | `invoice`, `credit_note`; credit reason `return`, `adjustment` |
| Legal type | `terms`, `privacy`; status `draft`, `published` |
| Notification type / channel / status | see 13.1 |
| Locale | `en`, `de` |

### 17.3 Error codes by HTTP status (all modules)

- **400**: `VALIDATION_FAILED`, `BAD_REQUEST`, `IDEMPOTENCY_KEY_REQUIRED`, `ADMIN_MFA_SETUP_REQUIRED`, `ROLE_PERMISSION_UNKNOWN`, `ADDRESS_LIMIT_REACHED`, `CATEGORY_PARENT_INVALID`, `CATEGORY_TOO_DEEP`, `CATEGORY_ORDER_INVALID`, `PRODUCT_PRICE_INVALID`, `PRODUCT_QUANTITY_INVALID`, `PRODUCT_VARIANT_INVALID`, `STOCK_CHANGE_INVALID`, `CART_FULL`, `ORDER_QUANTITY_INVALID`, `ORDER_ITEM_NOT_FOUND` (returns), `RETURN_QUANTITY_INVALID` (approve), `REFUND_AMOUNT_INVALID` (more than can be refunded), `REFUND_METHOD_INVALID`, `IMAGE_REQUIRED`, `IMAGE_INVALID`, `IMAGE_FORMAT_NOT_ALLOWED`, `IMAGE_DIMENSIONS_INVALID`, `IMAGE_LIMIT_REACHED`, `IMAGE_ORDER_INVALID`, `WEBHOOK_SIGNATURE_INVALID`.
- **401**: `UNAUTHENTICATED` (generic), `AUTH_TOKEN_INVALID`, `AUTH_REFRESH_INVALID`, `AUTH_SESSION_REVOKED`, `ADMIN_CREDENTIALS_INVALID`, `ADMIN_MFA_TOKEN_INVALID`, `ADMIN_MFA_CODE_INVALID`, `OTP_INVALID`, `GOOGLE_TOKEN_INVALID`, `GOOGLE_EMAIL_NOT_VERIFIED`.
- **403**: `FORBIDDEN` (generic), `ADMIN_PERMISSION_DENIED`, `ADMIN_PASSWORD_CHANGE_REQUIRED`, `ADMIN_ACCOUNT_DISABLED`, `ADMIN_SELF_MODIFICATION`, `ROLE_IS_SYSTEM`, `ORIGIN_NOT_ALLOWED`, `CUSTOMER_BLOCKED`, `JOBS_TOKEN_INVALID`.
- **404**: `NOT_FOUND`, `ADMIN_NOT_FOUND`, `ROLE_NOT_FOUND`, `CUSTOMER_NOT_FOUND`, `ADDRESS_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `IMAGE_NOT_FOUND`, `CART_PRODUCT_NOT_FOUND`, `ORDER_NOT_FOUND`, `ORDER_ITEM_NOT_FOUND` (orders), `RETURN_NOT_FOUND`, `INVOICE_NOT_FOUND`, `REFUND_NOT_FOUND`, `LEGAL_DOCUMENT_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `ANNOUNCEMENT_NOT_FOUND`.
- **409**: `CONFLICT`, `ADMIN_EMAIL_TAKEN`, `ADMIN_SELF_MODIFICATION` (last super admin), `ROLE_KEY_TAKEN`, `ROLE_IN_USE`, `CATEGORY_SLUG_TAKEN`, `CATEGORY_HAS_CHILDREN`, `CATEGORY_HAS_PRODUCTS`, `PRODUCT_SKU_TAKEN`, `PRODUCT_SLUG_TAKEN`, `PRODUCT_IS_ACTIVE`, `PRODUCT_IN_USE`, `STOCK_INSUFFICIENT`, `IMAGE_ORDER_INVALID` (changed meanwhile), `CART_EMPTY`, `ORDER_ITEMS_NOT_ORDERABLE`, `ORDER_TOTAL_CHANGED`, `ORDER_NOT_PAYABLE`, `ORDER_CANNOT_BE_CANCELLED`, `ORDER_TRANSITION_NOT_ALLOWED`, `ORDER_CANNOT_BE_CHANGED`, `ORDER_CHANGED_MEANWHILE`, `RETURN_NOT_POSSIBLE`, `RETURN_WINDOW_CLOSED`, `RETURN_QUANTITY_INVALID` (request/complete), `RETURN_TRANSITION_NOT_ALLOWED`, `LEGAL_DOCUMENT_PUBLISHED`, `LEGAL_DOCUMENTS_MISSING`, `LEGAL_VERSION_CHANGED`, `COMPANY_DETAILS_MISSING`, `REFUND_AMOUNT_INVALID` (nothing paid), `REFUND_TRANSITION_NOT_ALLOWED`, `NOTIFICATION_TRANSITION_NOT_ALLOWED`, `ANNOUNCEMENT_NO_RECIPIENTS`.
- **413**: `FILE_TOO_LARGE`. **429**: `RATE_LIMITED`, `ADMIN_ACCOUNT_LOCKED`, `OTP_COOLDOWN`, `OTP_LIMIT_REACHED`. **502**: `PAYMENT_PROVIDER_ERROR`. **503**: `SERVICE_UNAVAILABLE`, `PAYMENTS_NOT_CONFIGURED`, `GOOGLE_NOT_CONFIGURED`, `MAIL_DELIVERY_FAILED`, `STORAGE_UNAVAILABLE`. **500**: `INTERNAL_ERROR`.

---

## 18. Prepared but not yet active

| Feature | State | What the panel should show |
| ------- | ----- | -------------------------- |
| Stripe (online payment, Stripe refunds, webhook) | Built; works as soon as `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set on the server. Until then `integrations.stripeConnected` is `false`, checkout answers `503 PAYMENTS_NOT_CONFIGURED` (the shop cannot sell), Stripe refunds and `sync` answer `503 PAYMENTS_NOT_CONFIGURED`. Manual refunds work. | Warn on the settings page and the start page while `stripeConnected` is false; hide "refund through Stripe" when `refundable.stripePossible` is false. |
| Amazon SES (email delivery) | Built; the AWS account is not set up. In development emails go to the API log. | Failed emails appear as `failed` notifications with the provider's answer in `lastError`. |
| WhatsApp (Cloud API of Meta) | Built behind an interface; off until credentials are configured. `whatsappEnabled: false` in the notification summary and the announcement preview. WhatsApp records for opted-in customers are stored as `skipped` ("WhatsApp is not configured.") and can be retried once it is on. | Show the `whatsappEnabled` flag; explain `skipped` WhatsApp records; disable the WhatsApp channel choice in announcements while it is off (the API accepts it and skips). |
| Image storage on S3/CloudFront | Built; in development images are served by the API from a local folder (`/media/...` URLs). | Nothing: always use the URLs the API returns. |
| Reports, account deletion/export, housekeeping | Not built (proposed for the next phase). | – |

---

## 19. Answers to the requests of the panel (2026-10-14)

What the panel asked the backend for, and where it landed. Every item is implemented and tested unless marked otherwise.

| # | Request | Answer |
| --- | --- | --- |
| 1 | MFA recovery for a sole super admin | `npm run reset:mfa -- <email>` on the server (section 2). No recovery codes. |
| 2 | Free-text search over orders and customers | `q` on `GET /orders` and `GET /customers` (sections 9, 4). |
| 3 | Sorting and totals on cursor lists | `sort=<field>:<asc|desc>` on orders, customers, returns, refunds, notifications, fields listed per endpoint; `GET …/count` with the same filters (section 0.8). No `total` in the page. |
| 4 | Find an invoice or credit note by number | `number` (exact) and `q` (prefix) on `GET /invoices` (section 12). |
| 5 | Names on records | `admin` / `customer` objects next to every id (section 0.9). Item 14 is therefore not needed. |
| 6 | Bulk actions on a free selection | `POST /orders/bulk/status` and `/orders/bulk/delivery-method` with `orderIds[]`, per-order results (section 9). |
| 7 | Announcement progress in the list | `progress` in every item of `GET /announcements` (section 14). |
| 9 | Clearing optional texts | `description: null` on `PATCH /roles/{id}`, `note: null` on `PATCH /legal-documents/{id}` (sections 3, 6). |
| 10 | Whether Stripe is connected | `integrations.stripeConnected` and `integrations.whatsappConfigured` in `GET /settings`, plus `payments.stripeConnected` (section 5). |
| 11 | Whether a product can be deleted | `deletable` and `notDeletableReason` on `GET /products/{id}` (section 8). |
| 12 | All refused files of an upload | `details.files[]` on the image errors (section 8). |
| 13 | Stored discount percent | Existed already: `discountPercent` is stored and returned (section 8). |
| 15 | `isAvailable` and `isFeatured` | Section 8, field table. |
| 16 | Limit of an announcement's button label | 160 characters per language (section 14). |
| 17 | Role permission changes and sessions | Apply on the next request, nobody is signed out (section 3). |
| 18 | Category order across parents | Within one parent only, by design; move with `PATCH /categories/{id}` first (section 7). |
| 22 | Invitation email for a new admin | `sendInvitation` and `invitationSent` on `POST /admin-users`; needs `ADMIN_URL` on the server for the link (section 2). |
| 19, 20 | Reports; audit log | Not built. After launch. |
| — | CSV import and Excel export of categories and products (asked on 2026-10-14) | Section 8.2 and `doc/CSV_IMPORT_EXPORT.md`. |

**Cursors are opaque strings** (still the ObjectId for the default sort). The panel must not parse it.

**Search words of old records.** Orders and customers created before the search words existed are found by `q` once `npm run db:indexes` has run on the server (it fills the search words in, once).
