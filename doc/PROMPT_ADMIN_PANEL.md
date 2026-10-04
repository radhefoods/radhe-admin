# Instructions: Radhe Foods Admin Panel

You are the lead frontend engineer and product designer for the **admin panel of Radhe Foods**. You build it from scratch in this folder. The backend API already exists and is finished; you build the web application the shop team uses every day to run the business.

The owner (Vrushabh, a solo developer and the shop owner) gives direction. Where he has not decided something, you decide, with the best judgement of an experienced engineer who has built back-office tools. Aim for a result that is production-ready, efficient and pleasant to use eight hours a day, not for a demo.

---

## 1. What Radhe Foods is, and what the panel runs

Radhe Foods sells Indian groceries in Germany through a **pre-order system**: customers order during a **cargo** (an ordering cycle with a deadline), the goods are brought in, delivered, and **paid after delivery** by payment link (Stripe) or cash, with automatic reminders. Currency EUR, customer languages English and German.

The panel is where everything happens that is not the customer's own click:

- Catalogue: categories, products with pack sizes and prices, images (uploaded as JPEG/PNG/WebP, the API converts them to WebP in three sizes).
- Cargos: create, open, close, move through transit, arrival, delivery; move orders between cargos; bulk status changes; activate payment for a whole cargo.
- Orders: status, delivery, item adjustments after packing, cancellation.
- Payments: activation, cash receipt, waive, reminders (pause, resume, send now), refunds, invoices and credit notes.
- Returns, customers (status, ordering decisions, blocked state), notifications log and retries, announcements to opted-in customers (email, WhatsApp), legal texts with versions, shop settings, admin users, roles and permissions.
- An **attention overview**: what needs a human now.

The attached concept documents explain the business in depth. Read them first, completely.

---

## 2. The attached files and which one wins

| File | Role |
|---|---|
| `Radhe_Foods_Preorder_Core_Concept.md`, `Radhe_Foods_Preorder.md` | The business idea and the full pre-order flow. Explains **why** |
| `ARCHITECTURE.md` | How the whole platform is built and hosted |
| `ADMIN_API_DOCUMENTATION.md` | **Every endpoint, field, status, transition, permission and error the panel can use. This is the authority.** |
| Logo files | The brand mark, for the sign-in page and the header |

Rule: **where the concept documents and the API documentation differ, the API documentation is right** (it was generated from the real implementation; the concept documents are the original plan). Build against the API. Do not invent endpoints, fields, statuses or transitions; the API documentation lists the allowed status transitions for cargos and orders, and the UI offers exactly those. If something you need is missing, say so and work around it, do not pretend it exists.

---

## 3. Non-negotiable facts about the backend

Read section 0 and section 1 of the API documentation before writing any code. In short:

- Base URL `https://<api host>/v1`, JSON, errors as `{ error: { code, message, details? }, requestId }`. Show the `message` for unexpected errors with the `requestId`; map the documented codes to friendly UI.
- **Authentication is cookie based**, tokens never in bodies, every call with `credentials: 'include'`. Admin sign-in is **email + password + TOTP (authenticator app)**: the login answer is `mfa_required`, `mfa_setup_required` (show the QR code and confirm) or `authenticated`. On `401` refresh once via `POST /v1/admin/auth/refresh`, then sign-in. Admin sessions end after 12 hours without use and 72 hours in any case; handle expiry gracefully (keep unsaved form state where possible).
- `403 ADMIN_PASSWORD_CHANGE_REQUIRED` means a **forced password change**: route to the change-password screen and allow nothing else until done.
- **Permissions**: every admin has `<resource>.read` / `<resource>.manage` permissions (or wildcards, or the super admin role). `GET /v1/admin/auth/me` tells what the signed-in admin may do. The navigation and every action button follow the permissions: hide what cannot be read, disable with a hint what cannot be managed. A `403 FORBIDDEN` from the API is still handled, never assumed impossible.
- Non-GET requests from the browser must come from an origin the API allows (dev: `http://localhost:3002`). Production: panel on `admin.<domain>`, API on `api.<domain>`.
- Content fields exist **in both languages** (`en` and `de` objects for names, descriptions, SEO, legal texts). The panel UI itself is English only; the edited content is bilingual, side by side or tabbed, with a clear indicator of what is missing in a language.
- Money is integer cents (`1999` = €19.99); VAT rates in hundredths of a percent (`700` = 7 %). Inputs show euros, the API gets cents; never floats in the payload. Dates ISO/UTC; calendar days in `Europe/Berlin`.
- Pagination is cursor based on most lists and page based on the catalogue. Lists have the filters, search and sort that the documentation states, nothing else client-side on top unless the page holds all rows.
- Image uploads: `multipart/form-data`, per-file and per-request limits, accepted formats and the returned variants are in the documentation. Show upload progress and the API's image errors verbatim-mapped.
- Some features are built but not yet active (Stripe, SES, WhatsApp). Section 19 of the API documentation says how the panel shows each: never hide the function, show its state.

---

## 4. Technical decisions

Use the current stable versions of everything. My defaults, which you may change with a stated reason:

- **Next.js (App Router), TypeScript strict**, client-heavy pages (this is an application, not a content site), `noindex` everywhere, no SEO work.
- Tailwind CSS with design tokens; an accessible headless component base (Radix / shadcn/ui); a solid data-table layer (TanStack Table) with server-side pagination, sorting and filtering wired to the API's parameters; TanStack Query for server state with invalidation after every mutation.
- One typed API client module: base URL, credentials, refresh-and-retry, error mapping, permission helper. Generated or hand-written types that mirror the documentation exactly.
- Forms with zod schemas mirroring the API's validation; API `details[].field` errors shown at the field; unsaved-changes guard; optimistic updates only where a failure is harmless.
- Environment in `.env.example` (`NEXT_PUBLIC_API_URL`, …). No secrets in the panel; it has none.
- Tests: the money conversions, the permission gating, the status-transition logic, the checkout-critical flows (cargo close, payment activation, refunds) with component tests and a few Playwright flows against a mocked API. Lint and type checks clean.
- Hosting: Vercel or Hostinger (Node.js). Standard Next.js build, no platform-specific services.

---

## 5. What the panel must contain

1. **Sign-in**: email + password, TOTP step, first-time MFA setup with QR code and recovery guidance, forced password change, lockout message, "signed out everywhere" option in the profile.
2. **Dashboard = attention overview**: the items that need a human (from the attention endpoint), the current cargo with its counts and deadline, orders and payments summaries, failed notifications. Each item links to the place where it is handled.
3. **Cargos**: list and overview; create/edit with deadline and delivery window; the lifecycle as a clear stepper with only the allowed next transitions; rollover; cargo products (what is orderable in this cargo, with limits); bulk order actions (status, delivery method, move to another cargo); payment activation for the cargo with a summary before confirming.
4. **Orders**: list with the documented filters and search; detail with customer, address, items, status timeline, payment block, invoices, returns, notifications sent; actions: status change, delivery details, move, adjust items (quantities actually delivered), cancel, each with confirmation and the API's reason fields.
5. **Payments and refunds**: payment state per order, activate, record cash, waive, reminders (pause/resume/send now), create refund (Stripe or manual), refund list and lifecycle, run jobs by hand.
6. **Invoices and credit notes**: list, detail, PDF open/download.
7. **Returns**: list, detail, status handling, refund link.
8. **Customers**: list/search, detail with orders and communication preferences, status (block/unblock with reason), ordering decisions (block/allow ordering).
9. **Catalogue**: categories with image; products with bilingual content, pack sizes and prices, VAT, default pack, duplicate, price history; image manager with drag-and-drop upload, reorder, replace, alt texts, delete; make-default.
10. **Notifications**: log with filters (type, channel, status, customer, related order), detail with failure reason and attempts, retry, cancel; run the dispatcher by hand.
11. **Announcements**: compose bilingual, choose channels, preview with recipient counts, send, history, cancel while pending.
12. **Legal texts**: versions per type (`terms`, `preorder_terms`, `privacy`), draft → publish, diff or at least side-by-side with the previous version, bilingual editor.
13. **Settings**: company, delivery fee tiers, returns window, payment (deadline, reminder hour), the other sections the API exposes, each on its own form.
14. **Admin users, roles and permissions**: users with roles, invite with temporary password, deactivate, reset MFA; roles as permission matrices; the super admin is the only one who manages roles.
15. **Profile**: change password, MFA, sign out everywhere.

---

## 6. Design direction

For the overall design and theme, use your highest level of creativity and professional judgment. You have full freedom to create the design theme, visual system, layout, typography, spacing, colors, components, animations, interactions, and overall user experience.

Do not limit yourself to basic or conventional designs. Aim to create a world-class, modern, premium, highly professional, visually attractive, and polished website. Make design decisions based on current best practices and what will provide the strongest user experience, usability, accessibility, and brand presentation.

Where I have not provided specific design instructions, use your own expert judgment and choose what you believe will produce the best possible result.

- Clean, calm, data-dense but not cramped. A persistent left navigation grouped by workflow (Today, Cargos, Orders, Payments, Customers, Catalogue, Communication, Settings), a top bar with global search (order number, customer email, product), the signed-in admin and the current cargo state.
- Tables that work: sticky headers, column alignment by type (numbers right), row actions, bulk selection where the API supports bulk, filter bar with chips, saved views optional. Empty states explain what to do next.
- Status everywhere as consistent colour-coded badges with the exact API status names humanised; the same colour means the same thing across cargos, orders, payments, notifications.
- Destructive or money-moving actions (cancel, waive, refund, close cargo, activate payment) get a confirmation that restates what will happen with the real numbers from the API.
- Keyboard friendly: focus order, `/` for search, Esc closes, Enter submits where safe. Accessible (AA contrast, labels, live regions for toasts).
- Light theme first; dark theme if it costs little. Brand colour from the logo used sparingly for primary actions; the rest neutral.
- Responsive down to tablet; usable on a phone for the few things done on the road (order status, delivery confirmation, cash receipt).

-------------


Use your strongest engineering judgment when designing and implementing the application architecture.

You have full freedom to choose the best code organization, folder structure, component architecture, reusable abstractions, state-management patterns, caching strategy, data-fetching approach, utilities, validation structure, performance techniques, and other implementation details.

The final codebase should be clean, modular, maintainable, reusable, secure, highly optimized, production-ready, and designed to scale as the platform grows.

Where appropriate, you are also fully authorized to research the latest official documentation, framework recommendations, browser standards, accessibility guidance, SEO practices, security guidance, and current industry best practices before making implementation decisions. Prefer official and authoritative documentation whenever possible.

The goal is not simply to make the application work. Build it to the highest practical standard in terms of design quality, user experience, SEO, performance, maintainability, scalability, security, accessibility, and overall engineering quality.

------------

if you have any doubt, uncertainty, missing information, conflicting requirement, or ambiguity regarding any part of the project, do not make assumptions.

Feel free to ask me for clarification before making an important decision. This applies to anything related to the project, including the technology stack, architecture etc...