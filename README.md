# Radhe Foods Admin

The back office of the Radhe Foods pre-order platform: the web application the shop team uses to run cargos, orders, payments, the catalogue, customers and communication. It talks to the admin API of `radhe-api`.

| Document                                                                   | Content                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                         | How the panel is built: structure, conventions, checks                                |
| [DECISIONS.md](DECISIONS.md)                                               | Design and technical decisions with their reasons; what the API cannot do; open items |
| [doc/ADMIN_API_DOCUMENTATION.md](doc/ADMIN_API_DOCUMENTATION.md)           | The admin API. **The authority** for every endpoint, field, status and error          |
| [doc/PROMPT_ADMIN_PANEL.md](doc/PROMPT_ADMIN_PANEL.md)                     | The brief the panel was built from                                                    |
| [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md), `doc/Radhe_Foods_Preorder*.md` | The platform and the business behind it                                               |

## Requirements

- Node.js 22.18 or newer (the mock API runs TypeScript directly)
- npm

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev:mock      # the mock admin API on http://localhost:3000
npm run dev           # the panel on http://localhost:3002
```

Sign in with `owner@radhefoods.de` / `radhe-owner-2026` and the code `000000`.

The mock keeps demo data in memory: cargos in every stage, orders, payments open and overdue, returns, refunds, failed messages. A restart brings it back. More sign-ins:

| Email                  | Password             | What it shows                                                                    |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `owner@radhefoods.de`  | `radhe-owner-2026`   | Super admin: everything                                                          |
| `orders@radhefoods.de` | `radhe-orders-2026`  | Order manager: manages orders, reads the rest; no settings, team or roles        |
| `viewer@radhefoods.de` | `radhe-viewer-2026`  | Reads everything, changes nothing: every action is disabled with a hint          |
| `new@radhefoods.de`    | `temporary-pass-123` | First sign-in: authenticator setup with QR code, then the forced password change |

Every demo admin accepts the code `000000`; a real authenticator code works as well (scan the QR code of the newcomer).

Switches of the mock: `MOCK_API_PORT` (default 3000), `MOCK_DELAY_MS` (default 150, to see loading states), `MOCK_STRIPE=on` (Stripe counts as connected: online payments and Stripe refunds), `MOCK_WHATSAPP=on`.

## Against the real API

Set `NEXT_PUBLIC_API_URL` to the API and make sure the API allows the panel's address: `CORS_ORIGINS` of `radhe-api` must contain `http://localhost:3002` (or the production address). Cookies need both on one site: `localhost` in development, `admin.<domain>` and `api.<domain>` with `COOKIE_DOMAIN=.<domain>` in production.

## Environment

All values are public (`NEXT_PUBLIC_`). The panel has no secrets.

| Variable               | Meaning                                             | Example                     |
| ---------------------- | --------------------------------------------------- | --------------------------- |
| `NEXT_PUBLIC_API_URL`  | The API, without a trailing slash and without `/v1` | `https://api.radhefoods.de` |
| `NEXT_PUBLIC_SHOP_URL` | The customer shop, for "open in the shop" links     | `https://www.radhefoods.de` |

Both are read when the panel is built: change them, then build again.

## Scripts

| Script                                   | What it does                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`                            | The panel in development on port 3002                                                                  |
| `npm run dev:mock`                       | The mock admin API on port 3000                                                                        |
| `npm run build`, `npm run start`         | The production build and its server (port 3002)                                                        |
| `npm run typecheck`                      | Route types and TypeScript. Not while `npm run dev` runs: use `npx tsc --noEmit` then                  |
| `npm run lint`                           | ESLint                                                                                                 |
| `npm run format`, `npm run format:check` | Prettier                                                                                               |
| `npm test`                               | Unit and component tests (Vitest); component tests run the real client against the mock API in-process |
| `npm run test:e2e`                       | Browser tests (Playwright) against the mock API; starts both servers when they are not running         |
| `npm run check`                          | Types, lint, format and tests in one go                                                                |
| `node scripts/shoot.mjs <name> <path>`   | A screenshot of a page of the running panel, for looking at it while building (see the file)           |

## Tests

| Kind                                   | Where                        | What they cover                                                                                                                                                                                                                             |
| -------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                   | `src/lib/**/*.test.ts`       | Money (euros typed, integer cents sent), German time and deadlines across the clock change, permissions, the documented status transitions, the session (refresh once and retry, sign-out codes), every error code has a sentence           |
| Component, against the mock in-process | `src/features/**/*.test.tsx` | The flows that lose money or data when wrong: cargo close and cancel, payment activation, cash, waive, refunds, quantity corrections, returns, announcements, legal publishing, roles and team, product form and prices, permission gating  |
| Browser (Playwright)                   | `e2e/`                       | Sign-in with authenticator, first-time setup, lockout, a session that ends while a form is open, cargo close, payment activation, cash and refund, picture upload, the phone jobs, and axe (WCAG 2.1 A and AA) on every page in both themes |

`npm run test:e2e` builds the panel and starts it with the mock API when they are not running. The tests reset the mock's data before each test, so do not run them against a mock you are working in.

## What is in the panel

| Area          | Pages                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in       | Email and password, authenticator code, first-time setup with QR code, forced password change, re-sign-in over the page when a session ends                                                                   |
| Today         | What needs a person now (returns, overdue payments, failed deliveries, refunds, failed messages), the cargos on their way with their next step, what is still to collect                                      |
| Cargos        | List and overview; create and edit; the lifecycle with exactly the allowed transitions, rollover, cancel with order move; products and limits per cargo; bulk order actions; payment activation for the cargo |
| Orders        | List with the API's filters; detail with items, corrections of delivered quantities, status, delivery, move, cancel, payment, documents, returns, messages, history                                           |
| Returns       | List; approve (also fewer units), decline, complete                                                                                                                                                           |
| Payments      | Orders by payment status; activation, cash, waive, reminders and refunds on the order; refund list and lifecycle; invoices and credit notes with PDF; the payment jobs by hand                                |
| Customers     | List and search by email; detail with orders, preferences, block and unblock, ordering decisions                                                                                                              |
| Catalogue     | Products with bilingual content, pack sizes, prices, VAT, price history; image manager; categories as a tree                                                                                                  |
| Communication | The log of every message with retry and cancel; announcements with preview and recipient counts                                                                                                               |
| Settings      | Company, delivery fee, order and return rules, payment defaults; legal texts in versions; team; roles as permission matrices; the admin's own profile                                                         |

Navigation and buttons follow the permissions of the signed-in admin; the API enforces them anyway.

Keys: `/` or `Ctrl K` opens the search (an order number, a customer's email, a product, a cargo code, or a page), `Esc` closes what is open. `/styleguide` shows the parts every page is made of.

## Deployment

A standard Next.js application; no platform-specific services.

1. Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SHOP_URL` for the environment.
2. `npm ci && npm run build`, then `npm run start` (Node.js server on port 3002; set `PORT` or pass `--port` to change it). On Vercel the build and the start are automatic.
3. In `radhe-api`: add the panel's address to `CORS_ORIGINS`, and set `COOKIE_DOMAIN` to the parent domain shared by the panel and the API.
4. Serve the panel over https only. It sends `Strict-Transport-Security`, a content security policy with a nonce per request, `X-Frame-Options: DENY` and `X-Robots-Tag: noindex`.

Every page is rendered per request (the content security policy needs a fresh nonce), so the panel needs a Node.js host, not a static export. Hostinger's Node.js web apps and Vercel both work.

Before the first real use, read the open items in `DECISIONS.md`: above all, create a second super admin account, because an admin who loses the authenticator can only be helped by another admin.
