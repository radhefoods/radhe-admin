# Radhe Foods – Admin API Documentation

For the Next.js Admin Panel. Generated from the implemented NestJS backend (`radhe-api`) on 2026-09-30 and brought up to date on 2026-10-14 (search, sorting and counts on the lists, names next to ids, bulk actions on chosen orders, and the answers of section 20); every route, field, status and error below exists in the code as of this date. Customer-facing APIs are documented separately in `CUSTOMER_WEB_API_DOCUMENTATION.md`.

**What the admin panel manages:** the catalogue (categories, products with pack sizes and images), cargos (the pre-order cycles: order window, delivery days, products and limits per cargo), orders and their way to the customer, returns, payments after delivery (invoices, Stripe, cash, reminders, refunds, credit notes), customers, notifications to customers, announcements, settings, legal texts, admin users and roles.

## Contents

0. Conventions (base URL, responses, errors, auth, cookies, permissions, pagination, formats)
1. Admin authentication (login with two-factor)
2. Admin users
3. Roles and permissions (RBAC)
4. Customers
5. Settings
6. Legal texts
7. Categories
8. Products and images
9. Cargos, their products, bulk order actions, cargo payments
10. Orders
11. Returns
12. Payments and refunds
13. Invoices and credit notes
14. Notifications
15. Announcements ("Notify customers")
16. Attention overview (start page)
17. Jobs endpoint and Stripe webhook (server-side, not for the panel UI)
18. Reference: enums, state machines, permission matrix
19. Prepared but not yet active

---

## 0. Conventions

### 0.1 Base URL and versioning

- Admin routes are under `/v1/admin/...`. Health: `/health` (no version). Interactive OpenAPI docs: `<API>/docs` (development only), JSON at `<API>/docs/openapi.json`.
- Local development: `http://localhost:3000`; production: the API domain (for example `https://api.radhefoods.de`).

### 0.2 Requests and responses

- JSON bodies (`Content-Type: application/json`), except image uploads (`multipart/form-data`).
- Validation is strict: **unknown fields are rejected** (`400 VALIDATION_FAILED`, "property X should not exist"). Strings are trimmed; an empty optional string counts as not provided. `null` is only accepted where documented (it clears the field: `description` of a role, `note` of a legal text, `internalNotes` of a cargo, `salePrice` of a product, `trackingNumber` of an order).
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
| Human numbers | Orders `RF-1084`, returns `RF-1084-R1`, refunds `RF-1084-RF1`, invoices `INV-2026-000123`, credit notes `CN-2026-000007`, cargos `RF-C027`, SKUs `RF-00042`. |
| Money | Integer **cents**, EUR, VAT included. `vatRate` in hundredths of a percent (`700` = 7 %). |
| Date-times | ISO 8601 UTC strings. Inputs accept ISO strings; cargo moments must carry a time zone (`2026-09-26T23:59:00+02:00`). |
| Calendar days | `YYYY-MM-DD` in the business time zone `Europe/Berlin` (delivery windows, invoice `deliveredOn`). |
| Images | Absolute `https` WebP URLs in three sizes (section 8.1). |

### 0.8 Pagination

- **Page/limit** (products, cargos, cargo products): `?page=1&limit=24` → `{ items, page, limit, total, totalPages }` (`page` 1–500, `limit` 1–100).
- **Cursor** (customers, orders, returns, refunds, invoices, notifications, announcements): `?limit=25&cursor=<nextCursor>` → `{ items, nextCursor }`, newest first, `nextCursor: null` on the last page (`limit` 1–100, default 25). The cursor is an opaque string: pass it back unchanged, with the same filters and the same `sort`; a cursor of another sort answers `400 VALIDATION_FAILED`.
- **Sorting** (customers, orders, returns, refunds, notifications): `?sort=<field>:<asc|desc>`, default `createdAt:desc`. The fields are listed per endpoint; an unknown field answers `400 VALIDATION_FAILED` with the allowed names in `details`.
- **Counting** (the same five lists): `GET …/count` with the same filters as the list answers `{ "total": 42 }`. `limit`, `cursor` and `sort` are ignored. A list answer carries no `total`: call `/count` once when the number is shown.
- Small lists (admin users, roles, categories, legal texts) are returned whole.

### 0.9 Names next to ids

Wherever a record carries the id of an admin or a customer, the answer carries the person as well, looked up when the answer is built:

- next to `adminId`: `"admin": { "id", "name" } | null` (histories of orders, returns, refunds, cargos; adjustments and cancellations of orders; ordering decisions of customers);
- next to `by` of a cargo history entry, `createdBy` / `updatedBy` of a cargo, `createdBy` / `cancelledBy` of an announcement, `createdBy` of a refund, `activatedBy` / `cash.recordedBy` of a payment: the same object under `admin`, `createdByAdmin`, `updatedByAdmin`, `cancelledByAdmin`, `activatedByAdmin`, `recordedByAdmin`;
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
{ "items": ["admin_users.read", "admin_users.manage", "roles.read", "roles.manage", "customers.read", "customers.manage", "catalog.read", "catalog.manage", "cargos.read", "cargos.manage", "orders.read", "orders.manage", "settings.read", "settings.manage", "legal.read", "legal.manage", "payments.read", "payments.manage", "notifications.read", "notifications.manage"] }
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

Read customer accounts, block/unblock, and decide whether a customer may place orders.

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
  ],
  "orderingOverride": null,
  "orderingHistory": []
}
```

`status` ∈ `active`, `blocked`; `signupMethod` ∈ `email_otp`, `google`. `orderingOverride` is `null` or `{ "mode": "blocked" | "allowed", "reason", "adminId", "admin": { id, name } | null, "at", "until": ISO | null }`; `orderingHistory[]` entries are `{ "action": "block" | "allow" | "clear", "reason", "adminId", "admin", "at", "until" }`.

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

**Purpose:** Block or unblock the account. Blocking signs the customer out everywhere and refuses sign-in and ordering.

**Permission:** `customers.manage`.

**Request Body:** `{ "status": "active" | "blocked", "reason"?: string (≤500, stored when blocking) }`

**Success Response (200):** `{ "customer": { … } }`. **Possible Errors:** `404 CUSTOMER_NOT_FOUND`.

### `GET /v1/admin/customers/{id}/ordering`

**Purpose:** Whether the customer may place a new order, why not, the overdue payments, and every decision made.

**Permission:** `customers.read`.

**Success Response (200):**

```json
{
  "ordering": {
    "canOrder": false,
    "reason": "payment_overdue",
    "override": null,
    "overdue": [
      { "orderId": "66f0…", "orderNumber": "RF-1084", "invoiceId": "66f2…", "invoiceNumber": "INV-2026-000123", "amountDue": 3193, "deadlineAt": "2026-09-20T21:59:59.000Z" }
    ]
  },
  "history": [
    { "action": "allow", "reason": "Promised to pay Friday", "adminId": "66f1…", "admin": { "id": "66f1…", "name": "Vrushabh" }, "at": "2026-09-30T09:00:00.000Z", "until": "2026-10-07T09:00:00.000Z" }
  ]
}
```

`reason` ∈ `null`, `account_blocked`, `ordering_blocked`, `payment_overdue`. `override` is shown only while it applies: `{ "mode": "blocked", "until": null }` or `{ "mode": "allowed", "until": ISO }`.

### `POST /v1/admin/customers/{id}/ordering`

**Purpose:** Block ordering, allow it for a while although a payment is overdue, or clear the decision. The account stays usable (browsing, cart, paying). Every decision is recorded with the reason and the admin.

**Permission:** `customers.manage`.

**Request Body:**

```json
{ "action": "allow", "reason": "Promised to pay Friday", "allowDays": 7 }
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `action` | `block` \| `allow` \| `clear` | yes | |
| `reason` | string | yes | 1–1000 |
| `allowDays` | int | for `allow` | 1–365 |

**Success Response (200):** same shape as the GET. **Possible Errors:** `404 CUSTOMER_NOT_FOUND`, `400 VALIDATION_FAILED`.

---

## 5. Settings

The business rules the admin can change. `GET` returns all of them; each `PUT` replaces one group and answers with that group.

### `GET /v1/admin/settings`

**Permission:** `settings.read`.

**Success Response (200):** the settings below plus `"integrations": { "stripeConnected": boolean, "whatsappConfigured": boolean }` (whether the server has Stripe keys and WhatsApp credentials; `payments.stripeConnected` repeats the Stripe flag). Say "online payment is not set up" and disable the WhatsApp channel before an admin tries, instead of waiting for `503 PAYMENTS_NOT_CONFIGURED`.

```json
{
  "deliveryFee": { "tiers": [ { "minOrderValue": 0, "fee": 499 }, { "minOrderValue": 5000, "fee": 0 } ] },
  "orderPolicy": { "customerCancellation": "until_dispatched" },
  "delivery": { "defaultMethod": "radhe_delivery" },
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
  "payments": { "reminderHour": 9, "defaultDeadlineDays": 5, "checkoutMinutes": 60 }
}
```

- `company`: optional keys (`phone`, `website`, `vatId`, `taxNumber`, `registration`, `logoUrl`, `invoiceFooter`) are **absent** when unset. `missingForInvoices` lists what still blocks invoicing (`name`, `addressLines`, `email`, `vatId or taxNumber`); show a warning while it is not empty.
- Defaults on a fresh installation: fee `[{0, 0}]` (free), `until_dispatched`, `radhe_delivery`, `14` days, company `{ name: "Radhe Foods", addressLines: [], email: "" }`, payments `9 / 5 / 60`.

### `PUT /v1/admin/settings/delivery-fee`

**Purpose:** Delivery fee tiers by value of the goods (cents, VAT included). The highest tier an order reaches applies. Placed orders keep their fee.

**Permission:** `settings.manage`.

**Request Body:** `{ "tiers": [ { "minOrderValue": 0, "fee": 499 }, { "minOrderValue": 5000, "fee": 0 } ] }` — 1–10 tiers, `minOrderValue` 0–10 000 000, `fee` 0–10 000 000; one tier must start at 0; no two tiers at the same value.

**Success Response (200):** `{ "deliveryFee": { "tiers": [ …sorted ascending… ] } }`

### `PUT /v1/admin/settings/order-policy`

**Permission:** `settings.manage`. **Request Body:** `{ "customerCancellation": "while_confirmed" | "until_dispatched" | "never" }`. **Success Response (200):** `{ "orderPolicy": { … } }`.

### `PUT /v1/admin/settings/delivery`

**Purpose:** The delivery method every new order gets (customers never choose). **Permission:** `settings.manage`. **Request Body:** `{ "defaultMethod": "radhe_delivery" | "dhl" | "hermes" }`. **Success Response (200):** `{ "delivery": { … } }`.

### `PUT /v1/admin/settings/return-policy`

**Permission:** `settings.manage`. **Request Body:** `{ "windowDays": 14 }` (0–365; 0 switches return requests off). **Success Response (200):** `{ "returnPolicy": { … } }`.

### `PUT /v1/admin/settings/company`

**Purpose:** The seller printed on every invoice and shown in every email. Invoices cannot be issued until name, address, email and a VAT id or tax number are set.

**Permission:** `settings.manage`.

**Request Body:**

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `name` | string | yes | 1–120 |
| `addressLines` | string[] | yes | 1–5 lines (street; postcode and city) |
| `email` | string | yes | email |
| `phone` | string | no | ≤40 |
| `website` | string | no | URL |
| `vatId` | string | no | `^[A-Z]{2}[A-Z0-9]{2,13}$` (USt-IdNr.) |
| `taxNumber` | string | no | ≤40 (Steuernummer) |
| `registration` | string | no | ≤160 |
| `logoUrl` | string | no | absolute `https` URL of the logo (emails, invoices) |
| `invoiceFooter` | string | no | ≤1000 |

**Success Response (200):** `{ "company": { …, "missingForInvoices": [] } }`

### `PUT /v1/admin/settings/payments`

**Permission:** `settings.manage`. **Request Body:** `{ "reminderHour": 9, "defaultDeadlineDays": 5, "checkoutMinutes": 60 }` (0–23 / 1–60 / 30–1440). **Success Response (200):** `{ "payments": { … } }`.

---

## 6. Legal texts

Terms, pre-order terms and privacy policy, in versions. Customers accept the current published versions at checkout; a published version can never change (a new version is created instead). **Orders are refused until `terms` and `privacy` are published.**

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

`type` ∈ `terms`, `preorder_terms`, `privacy`; `status` ∈ `draft`, `published`.

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
| `type` | enum | yes | |
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

## 8. Products and images

One product document = one article in **one pack size**. Several pack sizes of the same article are separate products linked by a `variantGroupId`; one of them is the default (shown in listings). Prices are cents including VAT.

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
  "variantGroupId": "66f4…",
  "isDefaultVariant": true,
  "packSizeCount": 2,
  "imageCount": 3,
  "image": { "id": "…", "alt": "Basmati Rice", "isPrimary": true, "url": "…", "sizes": { "…": "" } },
  "createdAt": "…", "updatedAt": "…"
}
```

(`image` in the summary is the store-style image with a plain `alt` string; `variantGroupId` is `null` for a product without other pack sizes.)

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
    { "id": "66f2…", "sku": "RF-00041", "packSize": { "value": 1, "unit": "kg", "label": "1 kg" }, "pricing": { "…": "" }, "status": "active", "isAvailable": true, "isDefault": false },
    { "id": "66f3…", "sku": "RF-00042", "packSize": { "value": 5, "unit": "kg", "label": "5 kg" }, "pricing": { "…": "" }, "status": "active", "isAvailable": true, "isDefault": true }
  ],
  "publishedAt": "2026-09-01T08:00:00.000Z"
}
```

`packSizes` lists all members of the variant group (any status), smallest first; it is `[]` for a product without a group. `images` are in the admin's order.

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
| `variantOf` | ObjectId or `null` | no | id of **any** pack size of the product to join; `null` separates |
| `regularPrice` | int cents | yes | 1–10 000 000 |
| `salePrice` | int cents or `null` | no | 1–10 000 000, must be below `regularPrice`; `null` ends a sale |
| `discountPercent` | int or `null` | no | 1–99; alternative to `salePrice` (not both) |
| `vatRate` | int | yes | 0–10000 (700 = 7 %, 1900 = 19 %) |
| `status` | `draft` \| `active` \| `archived` | no | default `draft`; `active` sets `publishedAt` once |
| `isAvailable`, `isFeatured` | boolean | no | `isAvailable: false` keeps an active product in the shop but marks it as not orderable (shown as "sold out"; it cannot be put in a cart, and it is left out of the orderable products of a cargo). `isFeatured` marks the product for the featured block of the shop (`GET /v1/store/products?featured=true`); it changes nothing else. |
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

**Purpose:** Change a product; send only what changes. Translated fields, lists and `food` are replaced as a whole. `salePrice: null` ends a sale; sending neither `salePrice` nor `discountPercent` keeps the current sale.

**Permission:** `catalog.manage`. **Request Body:** same fields as create, all optional. **Success Response (200):** `{ "product": { … } }`.

**Possible Errors:** `404 PRODUCT_NOT_FOUND`, `404 CATEGORY_NOT_FOUND`, `400 PRODUCT_PRICE_INVALID`, `400 PRODUCT_QUANTITY_INVALID`, `400 PRODUCT_VARIANT_INVALID` (`variantOf` is the product itself or unknown), `409 PRODUCT_SKU_TAKEN`, `409 PRODUCT_SLUG_TAKEN`.

### `DELETE /v1/admin/products/{id}`

**Purpose:** Delete a product and its images for good. Only for drafts/archived products that were never part of a cargo. **Permission:** `catalog.manage`. **Success Response:** `204`.

**Possible Errors:** `404 PRODUCT_NOT_FOUND`, `409 PRODUCT_IS_ACTIVE` ("Archive the product before deleting it."), `409 PRODUCT_IN_USE` (part of a cargo: archive instead).

### `POST /v1/admin/products/{id}/duplicate`

**Purpose:** Copy a product as another pack size: a draft with the same texts, category, food information and (by default) images.

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

---

## 9. Cargos

A cargo is one pre-order cycle: an order window (`orderOpenAt` → `orderCloseAt`), estimated delivery days, and the products (with optional limits) that can be ordered in it. At most one cargo takes orders at a time. An automatic check runs hourly and opens/closes cargos on time; the panel can also do it by hand.

### 9.1 Cargo statuses and transitions

`draft` → `scheduled` → `taking_orders` → `orders_closed` → `in_transit` → `arrived` → `delivering` → `delivered`; `cancelled` from `draft`, `scheduled`, `taking_orders`, `orders_closed`, `in_transit`. One step back is allowed at most stages (`allowedStatuses` in the cargo object is authoritative):

```
draft         → scheduled, taking_orders, cancelled
scheduled     → draft, taking_orders, cancelled
taking_orders → orders_closed, cancelled
orders_closed → taking_orders, in_transit, cancelled
in_transit    → orders_closed, arrived, cancelled
arrived       → in_transit, delivering
delivering    → arrived, delivered
delivered     → delivering
cancelled     → (none)
```

Side effects: `delivering` dispatches the cargo's orders (status `dispatched`) and `delivered` marks them delivered, each with per-order exceptions (`excludeOrderIds`) and a notification to every affected customer. Cancelling a cargo that has orders requires `moveOrdersToCargoId`: the orders move to that cargo with items and quantities intact.

### 9.2 The cargo object

```json
{
  "id": "66f0…",
  "number": 27,
  "code": "RF-C027",
  "internalName": "October, first week",
  "customerName": { "en": "October delivery", "de": "Oktober-Lieferung" },
  "customerMessage": null,
  "internalNotes": null,
  "status": "taking_orders",
  "isAcceptingOrders": true,
  "attention": null,
  "allowedStatuses": ["orders_closed", "cancelled"],
  "orderOpenAt": "2026-09-23T22:00:00.000Z",
  "orderCloseAt": "2026-09-26T21:59:00.000Z",
  "delivery": { "start": "2026-10-05", "end": "2026-10-07" },
  "timezone": "Europe/Berlin",
  "openedAt": "2026-09-23T22:00:03.000Z",
  "closedAt": null,
  "products": { "total": 48, "enabled": 45 },
  "createdAt": "…", "updatedAt": "…"
}
```

- `attention`: `null`, `opening_due` (scheduled, opening time reached), `closing_due` (taking orders, deadline passed), `window_missed` (scheduled, deadline passed). Highlight these.
- **Detail** (`GET /{id}` and every transition) adds `"statusHistory": [ { "from": null, "to": "draft", "at": "…", "source": "admin" | "schedule", "by": "<adminId>" | null, "admin": { id, name } | null, "note": null } ]`, `createdByAdmin` and `updatedByAdmin` (`{ id, name } | null`).
- Transition answers are `{ "changed": true|false, "cargo": { …detail… } }`; `changed: false` when the cargo already had that status.

### `GET /v1/admin/cargos`

**Permission:** `cargos.read`. **Parameters:** `status` (query, optional), `page`, `limit`. **Success Response (200):** `{ "items": [ … ], "page", "limit", "total", "totalPages" }` (newest first).

### `GET /v1/admin/cargos/overview`

**Purpose:** The dashboard of cargos.

**Permission:** `cargos.read`.

**Success Response (200):**

```json
{ "acceptingOrders": true, "current": { "…cargo…": "" }, "next": { "…cargo…": "" }, "inProgress": [ { "…cargo…": "" } ], "serverTime": "2026-09-24T22:01:00.000Z" }
```

`current` = taking orders now (or `null`), `next` = the scheduled cargo that opens first (or `null`), `inProgress` = cargos in `orders_closed`, `in_transit`, `arrived`, `delivering` (max 20).

### `POST /v1/admin/cargos`

**Permission:** `cargos.manage`.

**Request Body:**

```json
{
  "internalName": "October, first week",
  "customerName": { "en": "October delivery", "de": "Oktober-Lieferung" },
  "customerMessage": { "en": "Order by Friday", "de": "Bestellen Sie bis Freitag" },
  "internalNotes": "…",
  "orderOpenAt": "2026-09-24T00:00:00+02:00",
  "orderCloseAt": "2026-09-26T23:59:00+02:00",
  "deliveryStart": "2026-10-05",
  "deliveryEnd": "2026-10-07",
  "status": "scheduled",
  "copyProductsFrom": "66ef…"
}
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `internalName` | string | yes | 1–120 |
| `customerName`, `customerMessage` | `{ en?, de? }` | no | shown to customers |
| `internalNotes` | string or `null` | no | ≤5000 |
| `orderOpenAt`, `orderCloseAt` | ISO with time zone | yes | close after open |
| `deliveryStart`, `deliveryEnd` | `YYYY-MM-DD` | yes | end ≥ start; start not before the deadline day |
| `status` | `draft` \| `scheduled` | no | `scheduled` opens by itself at `orderOpenAt` |
| `copyProductsFrom` | ObjectId | no | takes the products and limits of another cargo |

**Success Response (201):** `{ "cargo": { …detail… } }`

**Possible Errors:** `400 CARGO_DATES_INVALID` (`details: [messages]`), `409 CARGO_WINDOW_PASSED` (scheduled cargo whose deadline is past), `409 CARGO_WINDOW_OVERLAP` (`details: { cargo, orderOpenAt, orderCloseAt }` – order windows of scheduled/open cargos may not overlap), `404 CARGO_NOT_FOUND` (`copyProductsFrom`), `400 VALIDATION_FAILED`.

### `GET /v1/admin/cargos/{id}`

**Permission:** `cargos.read`. **Success Response (200):** `{ "cargo": { …detail with statusHistory… } }`. **Possible Errors:** `404 CARGO_NOT_FOUND`.

### `PATCH /v1/admin/cargos/{id}`

**Purpose:** Change names, messages, notes, times and delivery days (send only what changes; `internalNotes: null` clears). The opening time can change until ordering begins, the deadline until ordering ends, the delivery days until the cargo is finished. **New delivery days reach the orders:** every order of the cargo that has not left yet (`confirmed`, `preparing`, `delivery_failed`) gets the new `promisedStart`/`promisedEnd`, a `delivery_window` entry in its `statusHistory`, and its customer is emailed (`delivery_rescheduled`, section 14.1). Orders already dispatched or delivered keep their days. A draft has no orders.

**Permission:** `cargos.manage`. **Request Body:** create fields minus `status`/`copyProductsFrom`, all optional. **Success Response (200):** `{ "cargo": { …detail… } }`.

**Possible Errors:** `404 CARGO_NOT_FOUND`, `409 CARGO_NOT_EDITABLE` (`details: { status }`), `400 CARGO_DATES_INVALID`, `409 CARGO_WINDOW_PASSED`, `409 CARGO_WINDOW_OVERLAP`, `409 CARGO_CHANGED_MEANWHILE` (reload and retry).

### `DELETE /v1/admin/cargos/{id}`

**Purpose:** Delete a draft. **Permission:** `cargos.manage`. **Success Response:** `204`. **Possible Errors:** `404 CARGO_NOT_FOUND`, `409 CARGO_NOT_DELETABLE`.

### `POST /v1/admin/cargos/{id}/open`

**Purpose:** Customers can order from now on. **Permission:** `cargos.manage`. **Request Body:** `{ "note"?: string (≤500) }`. **Success Response (200):** `{ "changed", "cargo" }`.

**Possible Errors:** `409 CARGO_TRANSITION_NOT_ALLOWED` (`details: { from, to, allowed }`), `409 CARGO_ANOTHER_TAKING_ORDERS` (`details: { cargo, id }`), `409 CARGO_WINDOW_PASSED`, `409 CARGO_WINDOW_OVERLAP`, `409 CARGO_CHANGED_MEANWHILE`, `404 CARGO_NOT_FOUND`.

### `POST /v1/admin/cargos/{id}/close`

**Purpose:** Ordering ends now. **Permission:** `cargos.manage`. **Request Body:** `{ "note"? }`. **Success Response (200):** `{ "changed", "cargo" }`. **Possible Errors:** `409 CARGO_TRANSITION_NOT_ALLOWED`, `409 CARGO_CHANGED_MEANWHILE`, `404 CARGO_NOT_FOUND`.

### `PUT /v1/admin/cargos/{id}/status`

**Purpose:** Any allowed transition (see 9.1), including `delivering`/`delivered` with order exceptions and `cancelled` with an order move.

**Permission:** `cargos.manage`.

**Request Body:**

```json
{ "status": "delivering", "excludeOrderIds": ["66f5…"], "moveOrdersToCargoId": null, "note": "Truck left at 6:00" }
```

| Field | Type | Required | Meaning |
| ----- | ---- | -------- | ------- |
| `status` | cargo status | yes | |
| `excludeOrderIds` | ObjectId[] ≤1000 | no | orders that keep their status when the cargo's orders follow (`delivering`, `delivered`) |
| `moveOrdersToCargoId` | ObjectId | for `cancelled` with orders | the cargo that takes the orders over |
| `note` | string ≤500 | no | |

**Success Response (200):** `{ "changed": true, "cargo": { …detail… }, "ordersMoved": 0 }`

**Possible Errors:** as open/close, plus `409 CARGO_HAS_ORDERS` (`details: { orders }` – cancel needs a target cargo, or some orders are already on their way and must be looked at first), `409 CARGO_CANNOT_TAKE_ORDERS` (target cargo in a status that cannot take orders), `404 CARGO_NOT_FOUND`.

### `POST /v1/admin/cargos/rollover`

**Purpose:** Close the current cargo and open the named next one, with the same rules as the automatic check. Idempotent.

**Permission:** `cargos.manage`. **Request Body:** `{ "nextCargoId": "66f0…", "note"?: string }`.

**Success Response (200):** `{ "closed": { "changed": true, "cargo": { … } } | null, "opened": { "changed": true, "cargo": { … } } }`

**Possible Errors:** `404 CARGO_NOT_FOUND`, `409 CARGO_TRANSITION_NOT_ALLOWED`, `409 CARGO_WINDOW_PASSED`, `409 CARGO_WINDOW_OVERLAP`, `409 CARGO_ANOTHER_TAKING_ORDERS`, `409 CARGO_CHANGED_MEANWHILE`.

### `POST /v1/admin/cargos/check`

**Purpose:** Run the automatic check now (closes a cargo whose deadline passed, opens the scheduled cargo whose time has come). **Permission:** `cargos.manage`. **Success Response (200):** `{ "closed": ["RF-C026"], "opened": ["RF-C027"] }` (cargo codes; usually both empty).

### 9.3 Products of a cargo

Which products can be ordered in a cargo, and with what limit. A product without a setting cannot be ordered. Editable until ordering has ended.

**Cargo-product setting:** `{ "isEnabled": true, "maxQuantity": 40, "orderedQuantity": 3, "remaining": 37 }` (`maxQuantity`/`remaining` `null` = no limit; a product without a setting shows `isEnabled: false, maxQuantity: null, orderedQuantity: 0, remaining: null`).

### `GET /v1/admin/cargos/{cargoId}/products`

**Purpose:** Every catalogue product with its setting in this cargo.

**Permission:** `cargos.read`.

**Parameters (query):** `show` (`all` default \| `enabled` \| `not_enabled`), `q` (2–80), `categoryId`, `includeArchived` (boolean), `page`, `limit`.

**Success Response (200):**

```json
{ "items": [ { "product": { "…product summary (8.1)…": "" }, "cargo": { "isEnabled": true, "maxQuantity": 40, "orderedQuantity": 3, "remaining": 37 } } ], "page": 1, "limit": 24, "total": 48, "totalPages": 2 }
```

**Possible Errors:** `404 CARGO_NOT_FOUND`.

### `PUT /v1/admin/cargos/{cargoId}/products`

**Purpose:** Set many products at once. Products not named keep their setting.

**Permission:** `cargos.manage`.

**Request Body:** `{ "items": [ { "productId": "66f3…", "isEnabled": true, "maxQuantity": 40 } ] }` (1–500 unique entries; `isEnabled` default `true`; `maxQuantity` 0–1 000 000 or `null`/absent = no limit).

**Success Response (200):** `{ "products": { "total": 48, "enabled": 45 } }`

**Possible Errors:** `404 CARGO_NOT_FOUND`, `409 CARGO_NOT_EDITABLE` (ordering ended), `400 CARGO_PRODUCT_INVALID` (`details: { missing: [ids], archived: [ids] }`).

### `POST /v1/admin/cargos/{cargoId}/products/copy`

**Purpose:** Take over the products and limits of another cargo (existing settings kept, archived products skipped). **Permission:** `cargos.manage`. **Request Body:** `{ "fromCargoId": "66ef…" }`. **Success Response (200):** `{ "added": 12, "products": { "total": 48, "enabled": 45 } }`. **Possible Errors:** `404 CARGO_NOT_FOUND`, `409 CARGO_NOT_EDITABLE`.

### `PATCH /v1/admin/cargos/{cargoId}/products/{productId}`

**Purpose:** Enable/disable one product or change its limit (`maxQuantity: null` removes it). Creates the setting when missing. **Permission:** `cargos.manage`. **Request Body:** `{ "isEnabled"?: boolean, "maxQuantity"?: int|null }`. **Success Response (200):** `{ "productId": "66f3…", "cargo": { …setting… } }`. **Possible Errors:** `404 CARGO_NOT_FOUND`, `409 CARGO_NOT_EDITABLE`, `400 CARGO_PRODUCT_INVALID`.

### `DELETE /v1/admin/cargos/{cargoId}/products/{productId}`

**Purpose:** Remove the setting (refused once the product was ordered in this cargo: disable it instead). **Permission:** `cargos.manage`. **Success Response:** `204`. **Possible Errors:** `404 CARGO_NOT_FOUND`, `404 CARGO_PRODUCT_NOT_FOUND`, `409 CARGO_NOT_EDITABLE`, `409 CARGO_PRODUCT_HAS_ORDERS`.

### 9.4 All orders of a cargo at once

### `POST /v1/admin/cargos/{cargoId}/orders/status`

**Purpose:** Move all orders of the cargo on: `preparing` (from confirmed), `dispatched` (from confirmed/preparing), `delivered` (from dispatched). Other orders and excluded ones keep their status. Changing the cargo to `delivering`/`delivered` does this by itself; this is for doing it by hand or again. Each affected customer is notified.

**Permission:** `orders.manage`. **Request Body:** `{ "status": "preparing" | "dispatched" | "delivered", "excludeOrderIds"?: ObjectId[] (≤1000), "note"?: string (≤500) }`.

**Success Response (200):** `{ "cargo": "RF-C027", "status": "dispatched", "changed": 12 }`. **Possible Errors:** `404 CARGO_NOT_FOUND`.

### `POST /v1/admin/cargos/{cargoId}/orders/delivery-method`

**Purpose:** Set the delivery method of all orders that are not delivered/cancelled/returned; tracking numbers of changed orders are removed. **Permission:** `orders.manage`. **Request Body:** `{ "method": "radhe_delivery" | "dhl" | "hermes", "excludeOrderIds"?, "note"? }`. **Success Response (200):** `{ "cargo": "RF-C027", "method": "dhl", "changed": 12 }`.

### `POST /v1/admin/cargos/{cargoId}/orders/move`

**Purpose:** Give all movable orders (not yet dispatched, or delivery failed) to another cargo; they keep number, items and bill. **Permission:** `orders.manage`. **Request Body:** `{ "toCargoId": "66f0…", "note"? }`. **Success Response (200):** `{ "from": "RF-C027", "to": "RF-C028", "moved": 5 }`. **Possible Errors:** `404 CARGO_NOT_FOUND`, `409 CARGO_CANNOT_TAKE_ORDERS`.

### 9.5 Payments of a cargo

### `POST /v1/admin/cargos/{cargoId}/payments/activate`

**Purpose:** Issue invoices and payment requests for the delivered orders of the cargo, up to 100 per request. Repeat while `remaining > 0`.

**Permission:** `payments.manage`. **Request Body:** `{ "deadlineDays": 5, "note"?: string, "excludeOrderIds"?: ObjectId[] }` (`deadlineDays` 1–60).

**Success Response (200):**

```json
{
  "cargo": "RF-C027",
  "activated": ["RF-1084", "RF-1085"],
  "failed": [ { "orderNumber": "RF-1086", "code": "PAYMENT_ALREADY_ACTIVATED", "message": "…" } ],
  "remaining": 37
}
```

**Possible Errors:** `409 COMPANY_DETAILS_MISSING` (`details: { missing: [...] }` – complete the company settings first), `404 CARGO_NOT_FOUND`.

### `GET /v1/admin/cargos/{cargoId}/payments/summary`

**Permission:** `payments.read`.

**Success Response (200):**

```json
{
  "cargo": "RF-C027",
  "summary": {
    "byStatus": [ { "status": "due", "orders": 8, "amountDue": 25544, "paid": 0, "refunded": 0 } ],
    "toActivate": { "orders": 10, "amount": 31930 },
    "open": { "orders": 8, "amount": 25544 },
    "overdue": { "orders": 2, "amount": 6386 },
    "collected": 63860,
    "refunded": 499,
    "waived": { "orders": 1 }
  }
}
```

Cancelled orders are excluded; `byStatus` lists only statuses that occur.

---

## 10. Orders

Pre-orders and their way to the customer. An order is placed by the customer from the cart; the admin moves it through the statuses, sets delivery method and tracking, moves it to another cargo, corrects delivered quantities, or cancels it.

### 10.1 Statuses and transitions

`status`: `confirmed`, `preparing`, `dispatched`, `delivered`, `delivery_failed`, `cancelled`, `returned`.

```
confirmed        → preparing, dispatched
preparing        → confirmed, dispatched
dispatched       → preparing, delivered, delivery_failed
delivery_failed  → dispatched, delivered
delivered        → dispatched
returned, cancelled → (none)
```

`allowedStatuses` in the order detail is authoritative. `cancelled` has its own endpoint (allowed from `confirmed`, `preparing`, `dispatched`, `delivery_failed`); `returned` is set automatically when everything was returned. `canMove` (to another cargo) is true in `confirmed`, `preparing`, `delivery_failed`. Delivery method/tracking and quantity corrections are possible in `confirmed`, `preparing`, `dispatched`, `delivery_failed`, `delivered`.

`paymentStatus`: `not_enabled`, `due`, `overdue`, `paid`, `waived`, `refunded` (section 12).

### 10.2 Order objects

**Summary** (lists, attention):

```json
{
  "id": "66f0…",
  "orderNumber": "RF-1084",
  "type": "preorder",
  "status": "dispatched",
  "paymentStatus": "not_enabled",
  "placedAt": "2026-09-28T10:15:00.000Z",
  "customer": { "id": "66e1…", "email": "priya@example.com", "firstName": "Priya", "lastName": "Shah", "phone": "+49…" },
  "cargo": { "id": "66f0a1…", "code": "RF-C027" },
  "total": 3097,
  "finalTotal": 3097,
  "currency": "EUR",
  "lineCount": 2,
  "itemCount": 3,
  "city": "Frankfurt am Main",
  "postalCode": "60311",
  "delivery": {
    "method": "dhl", "trackingNumber": "00340434161094015902",
    "trackingUrl": "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=…&lang=en",
    "dispatchedAt": "2026-10-21T08:00:00.000Z", "deliveredAt": null,
    "promisedStart": "2026-10-20", "promisedEnd": "2026-10-24", "cargo": "RF-C027"
  }
}
```

`customer.firstName/lastName/phone` may be absent. `total` = agreed bill, `finalTotal` = after corrections and returns (the invoiced amount).

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
  "payment": { "…admin payment block (12.1)…": "" },
  "canCancel": true,
  "allowedStatuses": ["preparing", "delivered", "delivery_failed"],
  "canMove": false,
  "cancellation": null,
  "consent": { "acceptedAt": "…", "documents": [ { "type": "terms", "version": 3, "documentId": "66c0…" } ], "ip": "203.0.113.5", "userAgent": "Mozilla/5.0 …" },
  "statusHistory": [
    { "field": "order", "from": null, "to": "confirmed", "at": "…", "by": "customer", "adminId": null, "admin": null, "note": null },
    { "field": "order", "from": "confirmed", "to": "dispatched", "at": "…", "by": "admin", "adminId": "66d0…", "admin": { "id": "66d0…", "name": "Vrushabh" }, "note": null },
    { "field": "payment", "from": "not_enabled", "to": "due", "at": "…", "by": "admin", "adminId": "66d0…", "admin": { "id": "66d0…", "name": "Vrushabh" }, "note": null },
    { "field": "delivery_window", "from": "2026-10-22/2026-10-24", "to": "2026-10-25/2026-10-27", "at": "…", "by": "admin", "adminId": "66d0…", "admin": { "id": "66d0…", "name": "Vrushabh" }, "note": null }
  ],
  "updatedAt": "…"
}
```

- `deliveryAddress` keys `company`, `additionalLine`, `phone` are absent when unset.
- `cancellation`: `null` or `{ reason, text, by: "customer" | "admin" | "system", adminId, admin, at }`.
- `payment` (12.1) carries `activatedByAdmin` and `cash.recordedByAdmin` (`{ id, name } | null`) next to the ids.
- `statusHistory[].field` ∈ `order`, `payment`, `cargo`, `delivery`, `delivery_window` (the promised days changed with the cargo: `from`/`to` are `start/end` calendar days); `by` ∈ `customer`, `admin`, `system`. Payment entries use `to` values such as `due`, `overdue`, `paid`, `waived`, `refunded`, `credited`, `reminders_paused`, `reminders_resumed`, `reminder_sent`, `payment_failed`.

### `GET /v1/admin/orders`

**Purpose:** Orders, newest first, with filters.

**Permission:** `orders.read`.

**Parameters (query, all optional):**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `cargoId` | ObjectId | |
| `status` | order status | |
| `paymentStatus` | payment status | e.g. `overdue` |
| `customerId` | ObjectId | |
| `email` | email | the customer's email (unknown email → empty list) |
| `orderNumber` | `RF-1084` | exactly one order |
| `deliveryMethod` | `radhe_delivery` \| `dhl` \| `hermes` | |
| `q` | string 1–100 | words of the order number, the customer's name, email or phone; every word must begin a word of the order (`RF-10`, `schmidt`, `anna@exam`, `49151`) |
| `sort` | `createdAt` \| `total` \| `status` \| `paymentStatus`, with `:asc` or `:desc` | default `createdAt:desc`; `total` is the final bill |
| `limit`, `cursor` | | cursor pagination |

**Success Response (200):** `{ "items": [ …summaries… ], "nextCursor": "66f0…" | null }`. The `customer` of a summary carries `name` (`"Priya Shah"` or `null`) next to the email and the names.

### `GET /v1/admin/orders/count`

**Permission:** `orders.read`. **Parameters:** the filters of the list (`cargoId`, `status`, `paymentStatus`, `customerId`, `email`, `orderNumber`, `deliveryMethod`, `q`). **Success Response (200):** `{ "total": 312 }` (`0` for an unknown email).

### `POST /v1/admin/orders/bulk/status`

**Purpose:** Chosen orders on to a status, with the rules of the cargo-wide request (`preparing` from confirmed, `dispatched` from confirmed/preparing, `delivered` from dispatched). Each affected customer is notified. Every order is answered.

**Permission:** `orders.manage`. **Request Body:** `{ "orderIds": ObjectId[] (1–500), "status": "preparing" | "dispatched" | "delivered", "note"?: string (≤500) }`.

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

### `POST /v1/admin/orders/bulk/delivery-method`

**Purpose:** The delivery method of chosen orders (not delivered, cancelled or returned). Tracking numbers of orders whose method changes are removed. Every order is answered as above (`reason` also "The order is delivered by \"dhl\" already.").

**Permission:** `orders.manage`. **Request Body:** `{ "orderIds": ObjectId[] (1–500), "method": "radhe_delivery" | "dhl" | "hermes", "note"?: string (≤500) }`. **Success Response (200):** `{ "method": "dhl", "changed": 3, "results": [ … ] }`.

### `GET /v1/admin/orders/summary?cargoId=…`

**Purpose:** The numbers of a cargo.

**Permission:** `orders.read`. **Parameters:** `cargoId` (query, required).

**Success Response (200):**

```json
{ "cargoId": "66f0a1…", "summary": { "orders": 40, "cancelledOrders": 3, "customers": 37, "units": 210, "bookedValue": 184500, "byStatus": [ { "status": "confirmed", "orders": 30, "value": 140000 } ] } }
```

### `GET /v1/admin/orders/{id}`

**Permission:** `orders.read`. **Success Response (200):** `{ "order": { …detail… } }`. **Possible Errors:** `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/status`

**Purpose:** Give an order another status (see 10.1). Asking for the status the order has changes nothing. The customer is notified for `dispatched`, `delivered`, `delivery_failed`.

**Permission:** `orders.manage`.

**Request Body:** `{ "status": "confirmed" | "preparing" | "dispatched" | "delivered" | "delivery_failed", "trackingNumber"?: string (`^[A-Za-z0-9-]{4,60}$`), "note"?: string (≤500) }`

**Success Response (200):** `{ "order": { …detail… } }`

**Possible Errors:** `409 ORDER_TRANSITION_NOT_ALLOWED` (`details: { from, to, allowed }`), `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`, `400 VALIDATION_FAILED`.

### `PATCH /v1/admin/orders/{id}/delivery`

**Purpose:** Set the delivery method and/or tracking number. Changing the method removes the tracking number.

**Permission:** `orders.manage`. **Request Body:** `{ "method"?: delivery method, "trackingNumber"?: string | null, "note"? }`. **Success Response (200):** `{ "order": { … } }`.

**Possible Errors:** `409 ORDER_CANNOT_BE_CHANGED` (`details: { status, allowedIn }`), `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/move`

**Purpose:** Give an order to another cargo (keeps number, items and bill; a `delivery_failed` order becomes `confirmed` again in the new cargo). The customer is notified.

**Permission:** `orders.manage`. **Request Body:** `{ "cargoId": "66f0…", "note"? }`. **Success Response (200):** `{ "order": { … } }`.

**Possible Errors:** `409 ORDER_CANNOT_BE_MOVED` (`details: { status, allowedIn }`), `404 CARGO_NOT_FOUND`, `409 CARGO_CANNOT_TAKE_ORDERS` (`details: { cargo, status, allowedIn }`), `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`.

### `PATCH /v1/admin/orders/{id}/items/{productId}`

**Purpose:** Correct how many units of a product were delivered (missing/damaged). The final bill follows; the agreed bill and the delivery fee stay. A credit note is issued automatically when an invoice exists already.

**Permission:** `orders.manage`.

**Request Body:** `{ "deliveredQuantity": 1, "reason": "missing" | "damaged" | "wrong_item" | "customer_complaint" | "other", "note"?: string (≤1000, internal) }`

**Success Response (200):** `{ "order": { … } }`

**Possible Errors:** `404 ORDER_ITEM_NOT_FOUND`, `400 ORDER_QUANTITY_INVALID` (`details: { min: returnedQuantity, max: quantity }`), `409 ORDER_CANNOT_BE_CHANGED`, `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/cancel`

**Purpose:** Cancel an order (units go back to the cargo; the customer is notified). Cancelling a cancelled order changes nothing.

**Permission:** `orders.manage`.

**Request Body:** `{ "reason": "customer_request" | "product_unavailable" | "cargo_cancelled" | "duplicate_order" | "suspected_misuse" | "other", "text"?: string (≤1000) }`

**Success Response (200):** `{ "order": { … } }`. **Possible Errors:** `409 ORDER_CANNOT_BE_CANCELLED` (`details: { status }`), `404 ORDER_NOT_FOUND`.

---

## 11. Returns

Customers ask to send single products back after delivery; the admin approves (possibly fewer units), rejects, and completes the return once the goods are back, which lowers the bill (credit note; refund if paid).

### 11.1 Statuses and reasons

```
requested → approved, rejected, (cancelled by the customer)
approved  → completed, rejected
rejected / completed / cancelled → (none)
```

Reasons: `damaged`, `wrong_item`, `quality`, `not_as_described`, `changed_mind`, `other`.

### 11.2 The return object

```json
{
  "id": "66fa…",
  "returnNumber": "RF-1084-R1",
  "orderId": "66f0…",
  "orderNumber": "RF-1084",
  "customerId": "66e1…",
  "cargoId": "66f0a1…",
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
  "statusHistory": [ { "from": null, "to": "requested", "at": "…", "by": "customer", "adminId": null, "admin": null, "note": null } ],
  "updatedAt": "…"
}
```

(plus `"customer": { "id", "name", "email" } | null` after `customerId`.) `decisionNote` is what the customer reads; `internalNote` is not shown to the customer. `creditAmount` is set on completion.

### `GET /v1/admin/returns`

**Permission:** `orders.read`. **Parameters (query):** `status`, `orderNumber`, `customerId`, `sort` (`createdAt` | `status`, with `:asc`/`:desc`), `limit`, `cursor`. **Success Response (200):** `{ "items": [ … ], "nextCursor" }` (`status=requested` = waiting for a decision). Each return carries `customer: { id, name, email } | null` next to `customerId`, and `admin` next to `adminId` in its history.

### `GET /v1/admin/returns/count`

**Permission:** `orders.read`. **Parameters:** `status`, `orderNumber`, `customerId`. **Success Response (200):** `{ "total": 4 }`.

### `GET /v1/admin/returns/{id}`

**Permission:** `orders.read`. **Success Response (200):** `{ "return": { … } }`. **Possible Errors:** `404 RETURN_NOT_FOUND`.

### `POST /v1/admin/returns/{id}/approve`

**Purpose:** Accept the return, as asked or with other quantities (`0` declines a product). The order does not change yet.

**Permission:** `orders.manage`.

**Request Body:** `{ "items"?: [ { "productId": "…", "quantity": 0–10000 } ], "note"?: string (≤1000, to the customer), "internalNote"?: string (≤2000) }` — leave `items` out to accept the requested quantities.

**Success Response (200):** `{ "return": { … } }`

**Possible Errors:** `409 RETURN_TRANSITION_NOT_ALLOWED` (`details: { from, to }`), `400 RETURN_QUANTITY_INVALID` (more than requested, or everything 0: "Reject the return instead."), `400 ORDER_ITEM_NOT_FOUND` (`details: { productIds }`), `409 ORDER_CHANGED_MEANWHILE`, `404 RETURN_NOT_FOUND`.

### `POST /v1/admin/returns/{id}/reject`

**Purpose:** Decline (while requested or approved). **Permission:** `orders.manage`. **Request Body:** `{ "note"?, "internalNote"? }`. **Success Response (200):** `{ "return": { … } }`. **Possible Errors:** `409 RETURN_TRANSITION_NOT_ALLOWED`, `404 RETURN_NOT_FOUND`.

### `POST /v1/admin/returns/{id}/complete`

**Purpose:** The goods are back: the accepted units are booked on the order, its final bill goes down by `creditAmount`, a credit note is issued when an invoice exists, and the customer is notified. Refunding what was paid is a separate decision (section 12).

**Permission:** `orders.manage`. **Request Body:** `{ "note"?, "internalNote"? }`. **Success Response (200):** `{ "return": { …, "status": "completed", "creditAmount": 1299 } }`.

**Possible Errors:** `409 RETURN_TRANSITION_NOT_ALLOWED` (must be `approved`), `409 RETURN_QUANTITY_INVALID` (`details: { productId, sku }` – more than delivered), `409 ORDER_CHANGED_MEANWHILE`, `404 RETURN_NOT_FOUND`, `404 ORDER_NOT_FOUND`.

---

## 12. Payments and refunds

Payment begins after delivery. The admin **activates** payment: the invoice is issued, the customer gets an email with the PDF and a payment link, reminders follow daily until paid. The customer pays online (Stripe Checkout, card/PayPal) or in cash to the driver, which the admin records. Refunds are always decided by the admin, through Stripe or by hand.

### 12.1 The admin payment block (`order.payment`)

Before activation:

```json
{ "status": "not_enabled", "canActivate": true }
```

`canActivate` = the order is `delivered` and its final bill is above 0.

After activation:

```json
{
  "status": "due",
  "canActivate": false,
  "activatedAt": "2026-09-28T10:15:00.000Z",
  "activatedBy": "66f1…",
  "deadlineDays": 5,
  "deadline": "2026-10-03T21:59:59.000Z",
  "isOverdue": false,
  "invoice": { "id": "66f1…", "number": "INV-2026-000123" },
  "invoicedAmount": 3193,
  "creditedAmount": 0,
  "paidAmount": 0,
  "refundedAmount": 0,
  "amountDue": 3193,
  "method": null,
  "paidAt": null,
  "stripe": null,
  "cash": null,
  "reminders": { "nextAt": "2026-09-29T07:00:00.000Z", "sentCount": 0, "lastSentAt": null, "paused": false },
  "waivedReason": null,
  "canPayOnline": true,
  "canRecordCash": true,
  "canWaive": true
}
```

- `stripe` (after a checkout or a Stripe payment): `{ "paymentIntentId", "chargeId", "paymentType": "card" | "paypal" | null, "receiptUrl", "checkoutOpenUntil": ISO | null }`. `cash` (after a cash payment): `{ "collectedAt", "recordedBy", "note" }`.
- `method` ∈ `stripe`, `cash`, `credit` (settled by credit notes), `null`.
- `canRecordCash` / `canWaive` are true while the order is owing (`due`/`overdue`); `canPayOnline` additionally needs Stripe configured on the server. Use these flags for the buttons.

### `GET /v1/admin/orders/{id}/payment`

**Purpose:** Everything about the payment of an order: the block, the documents, the refunds, and what can be refunded.

**Permission:** `payments.read`.

**Success Response (200):**

```json
{
  "orderNumber": "RF-1084",
  "payment": { "…admin payment block…": "" },
  "documents": [ { "…invoice summary (13.1)…": "" } ],
  "refunds": [ { "…refund (12.9)…": "" } ],
  "refundable": { "paidAmount": 3193, "refundedAmount": 0, "openAmount": 0, "maximum": 3193, "suggested": 499, "stripePossible": true }
}
```

`refundable.maximum` = paid − refunded − open refunds; `suggested` = what credit notes left over after the payment; `stripePossible` = paid through Stripe. **Possible Errors:** `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/payment/activate`

**Purpose:** Issue the invoice from the final bill, set the deadline (23:59:59 German time of today + `deadlineDays`), email the customer with the PDF and the payment link, start the daily reminders. Propose `settings.payments.defaultDeadlineDays`.

**Permission:** `payments.manage`. **Request Body:** `{ "deadlineDays": 5, "note"?: string (≤500) }` (1–60).

**Success Response (200):** `{ "order": { …order detail… } }`

**Possible Errors:** `409 PAYMENT_NOT_POSSIBLE` (`details: { status }` – not delivered), `409 PAYMENT_ALREADY_ACTIVATED` (`details: { invoiceNumber }`), `409 PAYMENT_NOTHING_DUE` (final bill is 0), `409 COMPANY_DETAILS_MISSING` (`details: { missing: [...] }` – complete the company settings), `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/payment/cash`

**Purpose:** Record a cash payment of the full amount due. The customer gets a receipt email.

**Permission:** `payments.manage`. **Request Body:** `{ "amount": 3193, "collectedAt"?: ISO (default now), "note"?: string (≤500) }`.

**Success Response (200):** `{ "order": { …detail… } }`

**Possible Errors:** `400 PAYMENT_AMOUNT_MISMATCH` (`details: { amountDue, amount }` – no partial payments), `409 PAYMENT_NOT_ACTIVATED`, `409 PAYMENT_NOT_POSSIBLE`, `409 PAYMENT_NOTHING_DUE`, `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/payment/waive`

**Purpose:** Let the customer off what is owed, with a reason. Stops reminders. **Permission:** `payments.manage`. **Request Body:** `{ "reason": string (1–1000) }`. **Success Response (200):** `{ "order": { … } }`. **Possible Errors:** `409 PAYMENT_NOT_ACTIVATED`, `409 PAYMENT_NOT_POSSIBLE`, `409 PAYMENT_NOTHING_DUE`, `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`.

### `PATCH /v1/admin/orders/{id}/payment/reminders`

**Purpose:** Pause or resume the daily reminders. **Permission:** `payments.manage`. **Request Body:** `{ "paused": true }`. **Success Response (200):** `{ "payment": { …block… } }`. **Possible Errors:** `409 PAYMENT_NOT_ACTIVATED`, `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/payment/remind`

**Purpose:** Send a reminder now (email, and WhatsApp when the customer opted in). **Permission:** `payments.manage`. **Success Response (200):** `{ "payment": { …block… } }`. **Possible Errors:** `409 PAYMENT_NOT_ACTIVATED`, `409 PAYMENT_NOT_POSSIBLE`, `409 PAYMENT_NOTHING_DUE`, `404 ORDER_NOT_FOUND`.

### `POST /v1/admin/orders/{id}/payment/refunds`

**Purpose:** Decide a refund. Through Stripe the money goes back to the card/PayPal account and the refund completes when Stripe confirms; by hand the admin pays and then completes the refund (12.11). Read `refundable` first.

**Permission:** `payments.manage`.

**Request Body:**

```json
{ "amount": 499, "reason": "return", "method": "manual", "manual": { "way": "bank_transfer", "reference": "DE89…" }, "note": "Damaged bag" }
```

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `amount` | int cents | yes | 1–10 000 000, ≤ `refundable.maximum` |
| `reason` | `return` \| `adjustment` \| `goodwill` \| `duplicate_payment` \| `other` | yes | |
| `method` | `stripe` \| `manual` | yes | `stripe` only when `refundable.stripePossible` |
| `manual` | `{ way: bank_transfer \| cash \| other, reference?: string (≤200) }` | for `manual` | |
| `note` | string | no | ≤1000, internal |

**Success Response (201):** `{ "refund": { … } }` (`status` `processing` for Stripe, `pending` for manual).

**Possible Errors:** `400 REFUND_AMOUNT_INVALID` (`details: refundable`), `409 REFUND_AMOUNT_INVALID` (nothing paid), `400 REFUND_METHOD_INVALID`, `503 PAYMENTS_NOT_CONFIGURED` / `502 PAYMENT_PROVIDER_ERROR` (Stripe), `409 ORDER_CHANGED_MEANWHILE`, `404 ORDER_NOT_FOUND`.

### 12.9 The refund object

```json
{
  "id": "66f1…",
  "refundNumber": "RF-1084-RF1",
  "orderId": "66f1…",
  "orderNumber": "RF-1084",
  "invoiceNumber": "INV-2026-000123",
  "amount": 499,
  "reason": "adjustment",
  "method": "stripe",
  "status": "processing",
  "manual": null,
  "stripe": { "refundId": "re_…", "paymentIntentId": "pi_…", "stripeStatus": "pending", "failureReason": null },
  "note": null,
  "customerId": "66e1…",
  "customer": { "id": "66e1…", "name": "Priya Shah", "email": "priya@example.com" },
  "createdBy": "66f1…",
  "createdByAdmin": { "id": "66f1…", "name": "Vrushabh" },
  "createdAt": "2026-09-29T09:00:00.000Z",
  "completedAt": null,
  "statusHistory": [ { "from": null, "to": "pending", "at": "…", "by": "admin", "adminId": "66f1…", "admin": { "id": "66f1…", "name": "Vrushabh" }, "note": null } ]
}
```

`status` ∈ `pending` (manual, waiting for the admin), `processing` (Stripe working), `completed`, `failed`, `cancelled`. `manual`: `{ "way", "reference", "paidAt" }` or `null`. When a refund completes, the order's `refundedAmount` rises; `paymentStatus` becomes `refunded` only when everything paid went back.

### `GET /v1/admin/refunds`

**Permission:** `payments.read`. **Parameters (query):** `status`, `orderNumber`, `sort` (`createdAt` | `amount` | `status`, with `:asc`/`:desc`), `limit`, `cursor`. **Success Response (200):** `{ "items": [ … ], "nextCursor" }`.

### `GET /v1/admin/refunds/count`

**Permission:** `payments.read`. **Parameters:** `status`, `orderNumber`. **Success Response (200):** `{ "total": 2 }`.

### `GET /v1/admin/refunds/{id}`

**Permission:** `payments.read`. **Success Response (200):** `{ "refund": { … } }`. **Possible Errors:** `404 REFUND_NOT_FOUND`.

### `POST /v1/admin/refunds/{id}/complete`

**Purpose:** The money was sent by hand: complete a `pending` manual refund. The customer is notified. **Permission:** `payments.manage`. **Request Body:** `{ "paidAt"?: ISO (default now), "reference"?: string (≤200), "note"?: string (≤1000) }`. **Success Response (200):** `{ "refund": { … } }`.

**Possible Errors:** `409 REFUND_TRANSITION_NOT_ALLOWED` (`details: { status, method }` – Stripe refunds complete through Stripe), `409 ORDER_CHANGED_MEANWHILE`, `404 REFUND_NOT_FOUND`.

### `POST /v1/admin/refunds/{id}/cancel`

**Purpose:** Withdraw a `pending` or `failed` refund. **Permission:** `payments.manage`. **Request Body:** `{ "note"? }`. **Success Response (200):** `{ "refund": { … } }`. **Possible Errors:** `409 REFUND_TRANSITION_NOT_ALLOWED`, `404 REFUND_NOT_FOUND`.

### `POST /v1/admin/refunds/{id}/sync`

**Purpose:** Ask Stripe how a Stripe refund stands (normally the webhook does this). **Permission:** `payments.manage`. **Success Response (200):** `{ "refund": { … } }`. **Possible Errors:** `503 PAYMENTS_NOT_CONFIGURED`, `502 PAYMENT_PROVIDER_ERROR`, `404 REFUND_NOT_FOUND`.

### `POST /v1/admin/payments/run-jobs`

**Purpose:** Run the payment jobs now (payments past their deadline become `overdue`; due reminders go out). They also run every hour by themselves. **Permission:** `payments.manage`. **Success Response (200):** `{ "overdue": 2, "reminders": 5 }`.

---

## 13. Invoices and credit notes

Issued at activation (invoice) and after corrections/returns of an invoiced order (credit note). Numbered without gaps per year; never changed. PDFs are rendered on request.

### 13.1 Objects

**Summary:**

```json
{
  "id": "66f1…",
  "number": "INV-2026-000123",
  "type": "invoice",
  "orderNumber": "RF-1084",
  "issuedAt": "2026-09-28T10:15:00.000Z",
  "dueAt": "2026-10-03T21:59:59.000Z",
  "paidAt": null,
  "total": 3193,
  "currency": "EUR",
  "language": "de",
  "invoiceNumber": null,
  "creditReason": null
}
```

`type` ∈ `invoice`, `credit_note`. Credit notes have `dueAt`/`paidAt` `null`, `invoiceNumber` = the corrected invoice, `creditReason` ∈ `return`, `adjustment`.

**Detail** = summary plus `orderId`, `customerId`, `cargoId`, `deliveredOn` (`YYYY-MM-DD` or `null`), `creditReference`, `seller { name, addressLines[], email, phone, website, vatId, taxNumber, registration }`, `customer { name, company, addressLines[], email }`, `lines[] { description, sku, quantity, unitPrice, vatRate, vatPercent, lineTotal }`, `totals { currency, subtotal, deliveryFee, total, netTotal, vatTotal, vat[] { vatRate, gross, net, vat } }`, `footer`.

### `GET /v1/admin/invoices`

**Permission:** `payments.read`. **Parameters (query):** `type` (`invoice` \| `credit_note`), `orderNumber`, `customerId`, `number` (one document exactly, `INV-2026-000123` or `CN-2026-000007`, any case), `q` (the beginning of a number, `INV-2026-0001`; ignored when `number` is given), `limit`, `cursor`. **Success Response (200):** `{ "items": [ …summaries… ], "nextCursor" }`. **Possible Errors:** `400 VALIDATION_FAILED` (`number` not of that form).

### `GET /v1/admin/invoices/{id}`

**Permission:** `payments.read`. **Success Response (200):** `{ "invoice": { …detail… } }`. **Possible Errors:** `404 INVOICE_NOT_FOUND`.

### `GET /v1/admin/invoices/{id}/pdf`

**Permission:** `payments.read`. **Success Response (200):** binary PDF, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="INV-2026-000123.pdf"`, `Cache-Control: private, no-store`. Open it with `fetch` + `credentials: 'include'` and a Blob URL (or a same-site link). **Possible Errors:** `404 INVOICE_NOT_FOUND`.

---

## 14. Notifications

Every message to a customer (email, and WhatsApp when configured and opted in) is a record: what was sent, to whom, about which order/return/refund/announcement, its status, attempts and errors. Messages are queued by the events (order placed, dispatched, invoice issued, …) and sent by the API itself with retries; the admin sees them all, retries failed ones and cancels queued ones. There is no separate admin channel: what needs attention is in section 16.

### 14.1 Types, channels, statuses

| `type` | Sent when | WhatsApp too? |
| --- | --- | --- |
| `order_confirmed` | order placed | – |
| `order_cancelled` | cancelled by customer or admin | – |
| `order_moved` | moved to another cargo | – |
| `delivery_rescheduled` | the delivery days of the cargo changed while the order waits for it (section 9, `PATCH /cargos/{id}`) | – |
| `order_dispatched` | dispatched (single or with the cargo) | yes |
| `order_delivered` | delivered | – |
| `delivery_failed` | delivery failed | – |
| `return_requested` / `return_approved` / `return_rejected` / `return_completed` | return events | – |
| `payment_request` | payment activated (invoice PDF attached) | yes |
| `payment_reminder` | daily reminder / "remind now" | yes |
| `payment_received` | paid | – |
| `payment_failed` | Stripe reported a failed payment | – |
| `refund_completed` | refund complete | – |
| `announcement` | admin news (section 15) | yes (marketing consent) |

`channel` ∈ `email`, `whatsapp`. `status` ∈ `queued` (waiting or due for a retry), `sending`, `sent`, `failed` (given up: 4xx from the provider, or 6 attempts), `skipped` (not sent on purpose, e.g. WhatsApp not configured), `cancelled`. Retries after a retryable failure: 1 min, 5 min, 30 min, 2 h, 12 h.

### 14.2 The notification object

```json
{
  "id": "66f1…",
  "type": "payment_request",
  "channel": "email",
  "to": "anna@example.com",
  "customerId": "66f1…",
  "orderId": "66f1…",
  "orderNumber": "RF-1084",
  "cargoId": "66f1…",
  "productId": null,
  "returnId": null,
  "refundId": null,
  "announcementId": null,
  "locale": "de",
  "subject": "Ihre Rechnung INV-2026-000123",
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

`to` is the email address or the WhatsApp number. `subject` is set for emails only. `reason` explains a `skipped`/`cancelled` record. `history[]` entries are `{ at, ok, error? }`. The detail adds `data`: the values the message was rendered from (e.g. `orderNumber`, `amountDue`, `deadline`, `payUrl`).

### `GET /v1/admin/notifications`

**Permission:** `notifications.read`.

**Parameters (query, all optional):** `status`, `type`, `channel`, `customerId`, `orderId`, `orderNumber`, `announcementId`, `sort` (`createdAt` | `status` | `type` | `channel`, with `:asc`/`:desc`), `limit`, `cursor`. `status=failed` is what needs attention.

**Success Response (200):** `{ "items": [ … ], "nextCursor" }`. Each message carries `customer: { id, name, email } | null` next to `customerId`.

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

## 15. Announcements ("Notify customers")

News about a product or a cargo, written by the admin, sent to the customers who opted in to news (`marketingOptIn`), by email and — when chosen and configured — by WhatsApp to those who also opted in to WhatsApp. **Never automatic:** creating a product or opening a cargo sends nothing. Every message lands in the notifications list with the `announcementId`.

### 15.1 Objects

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
  "cargoId": null,
  "cargoCode": null,
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

**Progress** (counts per channel and status, always all keys):

```json
{ "email": { "queued": 0, "sending": 0, "sent": 148, "failed": 0, "skipped": 0, "cancelled": 0 }, "whatsapp": { "queued": 0, "sending": 0, "sent": 20, "failed": 1, "skipped": 2, "cancelled": 0 } }
```

### 15.2 Request body (preview and send)

```json
{
  "subject": { "en": "Fresh mangoes are in", "de": "Frische Mangos sind da" },
  "message": { "en": "The first Alphonso mangoes of the season arrive with the next cargo.", "de": "…" },
  "link": "https://radhefoods.de/products/alphonso-mango",
  "linkLabel": { "en": "See the product", "de": "Zum Produkt" },
  "productId": "66f1…",
  "cargoId": "66f0…",
  "channels": ["email", "whatsapp"]
}
```

| Field | Type | Required | Validation / meaning |
| ----- | ---- | -------- | -------------------- |
| `subject` | `{ en (1–160), de? }` | yes | |
| `message` | `{ en (1–2000), de? (≤2000) }` | yes | line breaks are kept in the email |
| `link` | absolute URL ≤500 | no | the button; defaults to the product page (`<SHOP_URL>/products/<slug>`) or the shop |
| `linkLabel` | `{ en (1–160), de? (≤160) }` | no | button label; default "Visit the shop"/"Zum Shop" |
| `productId`, `cargoId` | ObjectId | no | what the news is about (for the record and the lists) |
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

`recipients.whatsapp` is `0` unless `whatsapp` is in `channels`. **Possible Errors:** `404 PRODUCT_NOT_FOUND`, `404 CARGO_NOT_FOUND`, `400 VALIDATION_FAILED`.

### `POST /v1/admin/announcements`

**Purpose:** Send: one message per opted-in customer is queued (in their language). **Permission:** `notifications.manage`. **Success Response (201):** `{ "announcement": { … }, "progress": { … } }`.

**Possible Errors:** `409 ANNOUNCEMENT_NO_RECIPIENTS` ("No customer has asked for news yet."), `404 PRODUCT_NOT_FOUND`, `404 CARGO_NOT_FOUND`.

### `GET /v1/admin/announcements`

**Permission:** `notifications.read`. **Parameters (query):** `productId`, `cargoId`, `limit`, `cursor`. **Success Response (200):** `{ "items": [ { …announcement…, "progress": { "email": { "queued", "sending", "sent", "failed", "skipped", "cancelled" }, "whatsapp": { … } } } ], "nextCursor" }` — the same `progress` object as the detail, counted for the whole page in one query.

### `GET /v1/admin/announcements/{id}`

**Permission:** `notifications.read`. **Success Response (200):** `{ "announcement": { … }, "progress": { … } }`. **Possible Errors:** `404 ANNOUNCEMENT_NOT_FOUND`.

### `POST /v1/admin/announcements/{id}/cancel`

**Purpose:** Withdraw the messages that have not gone out yet. **Permission:** `notifications.manage`. **Success Response (200):** `{ "announcement": { …, "cancelledAt": "…" }, "progress": { … } }`. **Possible Errors:** `404 ANNOUNCEMENT_NOT_FOUND`.

---

## 16. Attention overview (start page)

### `GET /v1/admin/attention`

**Purpose:** What waits for the admin, in one call: return requests, overdue payments, failed deliveries, refunds to do, online payments that failed lately, failed messages. Each group has a count and the newest five; the module lists give the rest (`returns?status=requested`, `orders?paymentStatus=overdue`, `orders?status=delivery_failed`, `refunds?status=pending`, `notifications?status=failed`).

**Permission:** `orders.read`.

**Success Response (200):**

```json
{
  "returns": { "requested": 3, "items": [ { "…return (11.2)…": "" } ] },
  "payments": {
    "overdue": 2,
    "items": [ { "…order summary (10.2)…": "" } ],
    "failedRecently": [ { "…order summary…": "" } ]
  },
  "deliveries": { "failed": 1, "items": [ { "…order summary…": "" } ] },
  "refunds": { "pending": 1, "failed": 0, "items": [ { "…refund (12.9)…": "" } ] },
  "notifications": { "failed": 2, "queued": 0, "items": [ { "…notification (14.2)…": "" } ] }
}
```

`payments.failedRecently` = orders whose online payment failed in the last 7 days (the customer already received a new payment link).

---

## 17. Server-side endpoints (not called by the panel UI)

Documented so the whole surface is known.

### `POST /v1/jobs/run`

**Purpose:** Runs every scheduled job in one call — the cargo check, the payment jobs, the notification queue — for an external timer (a cron job every five minutes on the hosting). **Authentication:** header `X-Jobs-Token: <JOBS_TOKEN>` (server secret; the endpoint is off when no token is configured). Not rate limited.

**Success Response (200):**

```json
{ "startedAt": "…", "finishedAt": "…", "cargos": { "closed": ["RF-C026"], "opened": [] }, "payments": { "overdue": 2, "reminders": 5 }, "notifications": { "sent": 5, "retried": 0, "failed": 0, "skipped": 0, "recovered": 0 } }
```

**Possible Errors:** `403 JOBS_TOKEN_INVALID`.

### `POST /v1/webhooks/stripe`

Stripe's webhook (header `stripe-signature`, verified with the webhook secret). Answers `{ "received": true, "handled": true|false }`; `400 WEBHOOK_SIGNATURE_INVALID`, `503 PAYMENTS_NOT_CONFIGURED`. Not for the panel.

### `GET /health`, `GET /health/live`

`{ "status": "ok", "database": "up", "uptimeSeconds": 1234 }` / `{ "status": "ok" }`; `503 SERVICE_UNAVAILABLE` when the database is unreachable.

---

## 18. Reference

### 18.1 Permission matrix

| Area | Read | Manage |
| ---- | ---- | ------ |
| Admin users | `admin_users.read` | `admin_users.manage` |
| Roles | `roles.read` | `roles.manage` |
| Customers (incl. ordering decision) | `customers.read` | `customers.manage` |
| Categories, products, images | `catalog.read` | `catalog.manage` |
| Cargos, cargo products, rollover, check | `cargos.read` | `cargos.manage` |
| Orders, returns, bulk order actions per cargo, attention overview | `orders.read` | `orders.manage` |
| Settings | `settings.read` | `settings.manage` |
| Legal texts | `legal.read` | `legal.manage` |
| Payments, refunds, invoices, cargo payments, payment jobs | `payments.read` | `payments.manage` |
| Notifications, announcements | `notifications.read` | `notifications.manage` |

Auth endpoints (`me`, `change-password`, `logout-all`) need any signed-in admin.

### 18.2 Enums

| Enum | Values |
| ---- | ------ |
| Admin status | `active`, `disabled` |
| Customer status | `active`, `blocked`; sign-up method `email_otp`, `google` |
| Ordering decision `action` | `block`, `allow`, `clear`; stored `mode` `blocked`, `allowed`; `reason` of `canOrder=false`: `account_blocked`, `ordering_blocked`, `payment_overdue` |
| Product status | `draft`, `active`, `archived` |
| Pack units | `g`, `kg`, `ml`, `l`, `pcs`; `basePrice.per` `kg`, `l`, `pcs` |
| Storage type | `ambient`, `chilled`, `frozen` |
| Product sort (admin) | `newest`, `updated`, `name`, `sku`, `price_asc`, `price_desc` |
| Image sizes | `small` (320 px), `medium` (800 px), `large` (1600 px) |
| Cargo status | `draft`, `scheduled`, `taking_orders`, `orders_closed`, `in_transit`, `arrived`, `delivering`, `delivered`, `cancelled` |
| Cargo attention | `opening_due`, `closing_due`, `window_missed`, `null` |
| Cargo product filter `show` | `all`, `enabled`, `not_enabled` |
| Order status | `confirmed`, `preparing`, `dispatched`, `delivered`, `delivery_failed`, `cancelled`, `returned` |
| Bulk order status | `preparing`, `dispatched`, `delivered` |
| Delivery method | `radhe_delivery`, `dhl`, `hermes` |
| Cancellation reason (admin) | `customer_request`, `product_unavailable`, `cargo_cancelled`, `duplicate_order`, `suspected_misuse`, `other`; (customer) `changed_mind`, `ordered_by_mistake`, `wrong_items`, `delivery_too_late`, `other` |
| Adjustment reason | `missing`, `damaged`, `wrong_item`, `customer_complaint`, `other` |
| Customer cancellation rule | `while_confirmed`, `until_dispatched`, `never` |
| Return status | `requested`, `approved`, `rejected`, `completed`, `cancelled`; reasons `damaged`, `wrong_item`, `quality`, `not_as_described`, `changed_mind`, `other` |
| Payment status | `not_enabled`, `due`, `overdue`, `paid`, `waived`, `refunded`; method `stripe`, `cash`, `credit`; Stripe type `card`, `paypal` |
| Refund status | `pending`, `processing`, `completed`, `failed`, `cancelled`; reason `return`, `adjustment`, `goodwill`, `duplicate_payment`, `other`; method `stripe`, `manual`; manual way `bank_transfer`, `cash`, `other` |
| Invoice type | `invoice`, `credit_note`; credit reason `return`, `adjustment` |
| Legal type | `terms`, `preorder_terms`, `privacy`; status `draft`, `published` |
| Notification type / channel / status | see 14.1 |
| Locale | `en`, `de` |

### 18.3 Error codes by HTTP status (all modules)

- **400**: `VALIDATION_FAILED`, `BAD_REQUEST`, `IDEMPOTENCY_KEY_REQUIRED`, `ADMIN_MFA_SETUP_REQUIRED`, `ROLE_PERMISSION_UNKNOWN`, `ADDRESS_LIMIT_REACHED`, `CATEGORY_PARENT_INVALID`, `CATEGORY_TOO_DEEP`, `CATEGORY_ORDER_INVALID`, `PRODUCT_PRICE_INVALID`, `PRODUCT_QUANTITY_INVALID`, `PRODUCT_VARIANT_INVALID`, `CARGO_DATES_INVALID`, `CARGO_PRODUCT_INVALID`, `CART_FULL`, `ORDER_QUANTITY_INVALID`, `ORDER_ITEM_NOT_FOUND` (returns), `RETURN_QUANTITY_INVALID` (approve), `PAYMENT_AMOUNT_MISMATCH`, `REFUND_AMOUNT_INVALID`, `REFUND_METHOD_INVALID`, `IMAGE_REQUIRED`, `IMAGE_INVALID`, `IMAGE_FORMAT_NOT_ALLOWED`, `IMAGE_DIMENSIONS_INVALID`, `IMAGE_LIMIT_REACHED`, `IMAGE_ORDER_INVALID`, `WEBHOOK_SIGNATURE_INVALID`.
- **401**: `AUTH_TOKEN_INVALID`, `AUTH_REFRESH_INVALID`, `AUTH_SESSION_REVOKED`, `ADMIN_CREDENTIALS_INVALID`, `ADMIN_MFA_TOKEN_INVALID`, `ADMIN_MFA_CODE_INVALID`, `OTP_INVALID`, `GOOGLE_TOKEN_INVALID`, `GOOGLE_EMAIL_NOT_VERIFIED`.
- **403**: `ADMIN_PERMISSION_DENIED`, `ADMIN_PASSWORD_CHANGE_REQUIRED`, `ADMIN_ACCOUNT_DISABLED`, `ADMIN_SELF_MODIFICATION`, `ROLE_IS_SYSTEM`, `ORIGIN_NOT_ALLOWED`, `CUSTOMER_BLOCKED`, `ORDERING_BLOCKED`, `PAYMENT_OVERDUE`, `JOBS_TOKEN_INVALID`, `FORBIDDEN`.
- **404**: `NOT_FOUND`, `ADMIN_NOT_FOUND`, `ROLE_NOT_FOUND`, `CUSTOMER_NOT_FOUND`, `ADDRESS_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `IMAGE_NOT_FOUND`, `CARGO_NOT_FOUND`, `CARGO_PRODUCT_NOT_FOUND`, `CART_PRODUCT_NOT_FOUND`, `ORDER_NOT_FOUND`, `ORDER_ITEM_NOT_FOUND` (orders), `RETURN_NOT_FOUND`, `INVOICE_NOT_FOUND`, `REFUND_NOT_FOUND`, `PAY_LINK_INVALID`, `LEGAL_DOCUMENT_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `ANNOUNCEMENT_NOT_FOUND`.
- **409**: `CONFLICT`, `ADMIN_EMAIL_TAKEN`, `ADMIN_SELF_MODIFICATION` (last super admin), `ROLE_KEY_TAKEN`, `ROLE_IN_USE`, `CATEGORY_SLUG_TAKEN`, `CATEGORY_HAS_CHILDREN`, `CATEGORY_HAS_PRODUCTS`, `PRODUCT_SKU_TAKEN`, `PRODUCT_SLUG_TAKEN`, `PRODUCT_IS_ACTIVE`, `PRODUCT_IN_USE`, `IMAGE_ORDER_INVALID` (changed meanwhile), `CARGO_WINDOW_PASSED`, `CARGO_WINDOW_OVERLAP`, `CARGO_TRANSITION_NOT_ALLOWED`, `CARGO_ANOTHER_TAKING_ORDERS`, `CARGO_CHANGED_MEANWHILE`, `CARGO_NOT_EDITABLE`, `CARGO_NOT_DELETABLE`, `CARGO_PRODUCT_HAS_ORDERS`, `CARGO_HAS_ORDERS`, `CARGO_CANNOT_TAKE_ORDERS`, `CARGO_PRODUCT_NOT_AVAILABLE`, `CARGO_PRODUCT_LIMIT_REACHED`, `ORDERING_CLOSED`, `CART_EMPTY`, `ORDER_ITEMS_NOT_ORDERABLE`, `ORDER_TOTAL_CHANGED`, `ORDER_CANNOT_BE_CANCELLED`, `ORDER_TRANSITION_NOT_ALLOWED`, `ORDER_CANNOT_BE_MOVED`, `ORDER_CANNOT_BE_CHANGED`, `ORDER_CHANGED_MEANWHILE`, `RETURN_NOT_POSSIBLE`, `RETURN_WINDOW_CLOSED`, `RETURN_QUANTITY_INVALID` (request/complete), `RETURN_TRANSITION_NOT_ALLOWED`, `LEGAL_DOCUMENT_PUBLISHED`, `LEGAL_DOCUMENTS_MISSING`, `LEGAL_VERSION_CHANGED`, `COMPANY_DETAILS_MISSING`, `PAYMENT_NOT_ACTIVATED`, `PAYMENT_ALREADY_ACTIVATED`, `PAYMENT_NOT_POSSIBLE`, `PAYMENT_NOTHING_DUE`, `REFUND_AMOUNT_INVALID` (nothing paid), `REFUND_TRANSITION_NOT_ALLOWED`, `NOTIFICATION_TRANSITION_NOT_ALLOWED`, `ANNOUNCEMENT_NO_RECIPIENTS`.
- **413**: `FILE_TOO_LARGE`. **429**: `RATE_LIMITED`, `ADMIN_ACCOUNT_LOCKED`, `OTP_COOLDOWN`, `OTP_LIMIT_REACHED`. **502**: `PAYMENT_PROVIDER_ERROR`. **503**: `SERVICE_UNAVAILABLE`, `PAYMENTS_NOT_CONFIGURED`, `GOOGLE_NOT_CONFIGURED`, `MAIL_DELIVERY_FAILED`, `STORAGE_UNAVAILABLE`. **500**: `INTERNAL_ERROR`.

---

## 19. Prepared but not yet active

| Feature | State | What the panel should show |
| ------- | ----- | -------------------------- |
| Stripe (online payment, Stripe refunds, webhook) | Built; the Stripe account is not connected. `payment.canPayOnline` is `false`, `refundable.stripePossible` is `false`, Stripe refund/sync answer `503 PAYMENTS_NOT_CONFIGURED`. Cash, waiving, reminders and manual refunds work. | Hide "refund through Stripe" when `stripePossible` is false; show "online payment not set up" on 503. |
| Amazon SES (email delivery) | Built; the AWS account is not set up. In development emails go to the API log. | Failed emails appear as `failed` notifications with the provider's answer in `lastError`. |
| WhatsApp (Cloud API of Meta) | Built behind an interface; off until credentials are configured. `whatsappEnabled: false` in the notification summary and the announcement preview. WhatsApp records for opted-in customers are stored as `skipped` ("WhatsApp is not configured.") and can be retried once it is on. | Show the `whatsappEnabled` flag; explain `skipped` WhatsApp records; disable the WhatsApp channel choice in announcements while it is off (the API accepts it and skips). |
| Image storage on S3/CloudFront | Built; in development images are served by the API from a local folder (`/media/...` URLs). | Nothing: always use the URLs the API returns. |
| Reports, account deletion/export, housekeeping | Not built (proposed for the next phase). | – |

---

## 20. Answers to the requests of the panel (2026-10-14)

What the panel asked the backend for, and where it landed. Every item is implemented and tested unless marked otherwise.

| # | Request | Answer |
| --- | --- | --- |
| 1 | MFA recovery for a sole super admin | `npm run reset:mfa -- <email>` on the server (section 2). No recovery codes. |
| 2 | Free-text search over orders and customers | `q` on `GET /orders` and `GET /customers` (sections 10, 4). |
| 3 | Sorting and totals on cursor lists | `sort=<field>:<asc|desc>` on orders, customers, returns, refunds, notifications, fields listed per endpoint; `GET …/count` with the same filters (section 0.8). No `total` in the page. |
| 4 | Find an invoice or credit note by number | `number` (exact) and `q` (prefix) on `GET /invoices` (section 13). |
| 5 | Names on records | `admin` / `customer` objects next to every id (section 0.9). Item 14 is therefore not needed. |
| 6 | Bulk actions on a free selection | `POST /orders/bulk/status` and `/orders/bulk/delivery-method` with `orderIds[]`, per-order results (section 10). |
| 7 | Announcement progress in the list | `progress` in every item of `GET /announcements` (section 15). |
| 8 | Ids in a customer's ordering state | `orderId` and `invoiceId` in `overdue[]` (section 4, also `GET /v1/store/me/ordering`). |
| 9 | Clearing optional texts | `description: null` on `PATCH /roles/{id}`, `note: null` on `PATCH /legal-documents/{id}` (sections 3, 6). |
| 10 | Whether Stripe is connected | `integrations.stripeConnected` and `integrations.whatsappConfigured` in `GET /settings`, plus `payments.stripeConnected` (section 5). |
| 11 | Whether a product can be deleted | `deletable` and `notDeletableReason` on `GET /products/{id}` (section 8). |
| 12 | All refused files of an upload | `details.files[]` on the image errors (section 8). |
| 13 | Stored discount percent | Existed already: `discountPercent` is stored and returned (section 8). |
| 15 | `isAvailable` and `isFeatured` | Section 8, field table. |
| 16 | Limit of an announcement's button label | 160 characters per language (section 15). |
| 17 | Role permission changes and sessions | Apply on the next request, nobody is signed out (section 3). |
| 18 | Category order across parents | Within one parent only, by design; move with `PATCH /categories/{id}` first (section 7). |
| 21 | Customers told when delivery days change | `delivery_rescheduled` email, `delivery_window` history entry (sections 9, 10, 14). |
| 22 | Invitation email for a new admin | `sendInvitation` and `invitationSent` on `POST /admin-users`; needs `ADMIN_URL` on the server for the link (section 2). |
| 19, 20 | Reports; audit log | Not built. After launch. |

**Cursors changed shape.** A cursor is now an opaque string (still the ObjectId for the default sort). The panel must not parse it. Cursors saved from before this date still work for the default sort.

**Search words of old records.** Orders and customers from before 2026-10-14 are found by `q` once `npm run db:indexes` has run on the server (it fills the search words in, once).
