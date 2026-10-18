# Radhe Foods Admin

The back office of the Radhe Foods shop: the web application the shop team uses to run stock, orders, refunds, the catalogue, customers and communication. The shop sells from stock and is paid at checkout; the panel talks to the admin API of `radhe-api`.

| Document                                                         | Content                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [CONTRIBUTING.md](CONTRIBUTING.md)                               | How the panel is built: structure, conventions, checks                                         |
| [DECISIONS.md](DECISIONS.md)                                     | Design and technical decisions with their reasons; what the API cannot do; open items          |
| [doc/ADMIN_API_DOCUMENTATION.md](doc/ADMIN_API_DOCUMENTATION.md) | The admin API. **The authority** for every endpoint, field, status and error                   |
| [doc/PROMPT_ADMIN_PANEL.md](doc/PROMPT_ADMIN_PANEL.md)           | The brief of the move to the shop that sells from stock and is paid at checkout                |
| [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md)                       | The platform behind the panel: modules, data model, status models, key flows                   |
| [doc/CSV_IMPORT_EXPORT.md](doc/CSV_IMPORT_EXPORT.md)             | The catalogue sheets: columns, rules, the import and export endpoints                          |
| [doc/BANNERS.md](doc/BANNERS.md)                                 | The homepage banners: the model, the picture rules, the admin endpoints and the panel workflow |

## Requirements

- Node.js 24 (the current LTS line; `.nvmrc` names it for nvm, fnm and the like). Older lines are not supported: the mock API runs TypeScript directly, and the test tools want 24.
- npm

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev:mock      # the mock admin API on http://localhost:3000
npm run dev           # the panel on http://localhost:3002
```

Sign in with `owner@radhefoods.de` / `radhe-owner-2026` and the code `000000`.

The mock keeps demo data in memory: products with their stock, orders in every status from the open payment page to the delivered parcel, returns, refunds waiting for a decision, failed messages. A restart brings it back. More sign-ins:

| Email                  | Password             | What it shows                                                                    |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `owner@radhefoods.de`  | `radhe-owner-2026`   | Super admin: everything                                                          |
| `orders@radhefoods.de` | `radhe-orders-2026`  | Order manager: manages orders, reads the rest; no settings, team or roles        |
| `viewer@radhefoods.de` | `radhe-viewer-2026`  | Reads everything, changes nothing: every action is disabled with a hint          |
| `new@radhefoods.de`    | `temporary-pass-123` | First sign-in: authenticator setup with QR code, then the forced password change |

Every demo admin accepts the code `000000`; a real authenticator code works as well (scan the QR code of the newcomer).

Switches of the mock: `MOCK_API_PORT` (default 3000), `MOCK_DELAY_MS` (default 150, to see loading states), `MOCK_STRIPE=on` (Stripe counts as connected: refunds can go through Stripe), `MOCK_WHATSAPP=on`.

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

| Kind                                   | Where                        | What they cover                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                   | `src/lib/**/*.test.ts`       | Money (euros typed, integer cents sent), German time across the clock change, permissions, the documented status transitions, the session (refresh once and retry, sign-out codes), every error code has a sentence, the stock dialog's reading of what was typed                                                                                                                                                                      |
| Component, against the mock in-process | `src/features/**/*.test.tsx` | The flows that lose money or data when wrong: the order steps with the tracking number, cancellation with the refund waiting, refunds by hand and through Stripe, quantity corrections, returns with the restock switch, stock changes per pack size, the pack-size table saved in a sequence of requests that stops at the first refusal, announcements, legal publishing, roles and team, product form and prices, permission gating |
| Browser (Playwright)                   | `e2e/`                       | Sign-in with authenticator, first-time setup, lockout, a session that ends while a form is open, the way of a paid order to the door, the refund decision, picture upload, the catalogue sheets, the homepage banners, the phone jobs, and axe (WCAG 2.1 A and AA) on every page in both themes                                                                                                                                        |

`npm run test:e2e` builds the panel and starts it with the mock API when they are not running. The tests reset the mock's data before each test, so do not run them against a mock you are working in.

## What is in the panel

| Area          | Pages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-in       | Email and password, authenticator code, first-time setup with QR code, forced password change, re-sign-in over the page when a session ends                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Today         | What needs a person now: paid orders to process, refunds to decide, pending and failed refunds, return requests, products running low, failed messages; a warning while the shop cannot sell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Orders        | List with the API's filters, the orders waiting for a refund, search by words of the number, name, email or phone, sorting and the count; actions on chosen orders at once; detail with items, corrections of delivered quantities, status steps from what the API allows, dispatch with the tracking number, delivery, cancel, the payment block with the refund decision, documents, returns, messages, history                                                                                                                                                                                                                                                              |
| Returns       | List; approve (also fewer units), decline, complete with the restock switch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Payments      | Orders by payment status plus the ones waiting for a refund; the refund decision on the order (Stripe or by hand); refund list and lifecycle; invoices and credit notes with PDF                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Customers     | List with search by name, email or phone, sorting and the count; detail with orders, preferences, block and unblock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Catalogue     | Products with bilingual content and all their pack sizes in one form, each pack size with its article number, prices, enabled switch, threshold and stock; one dialog to set or adjust the count and the movement ledger per pack size; the price history per pack size; image manager; categories as a tree, each with its picture and the picture description inside its form; import of categories and products from CSV or Excel (one row per pack size) with a preview, and export as Excel or CSV; the homepage banners in their display order, each created from its picture and then given its name, link, period, description and switch, with drag-and-drop ordering |
| Communication | The log of every message with retry and cancel; announcements with preview and recipient counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Settings      | Company, delivery fee, the delivery method and estimate, order and return rules, the payment page and the connected services; legal texts in versions; team with invitation emails; roles as permission matrices; the admin's own profile                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Navigation and buttons follow the permissions of the signed-in admin; the API enforces them anyway.

Keys: `/` or `Ctrl K` opens the search (orders and customers by words of the number, name, email or phone; a product; or a page), `Esc` closes what is open. `/styleguide` shows the parts every page is made of.

## Deployment

A standard Next.js application; no platform-specific services.

1. Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SHOP_URL` for the environment.
2. `npm ci && npm run build`, then `npm run start` (Node.js server on port 3002; set `PORT` or pass `--port` to change it). On Vercel the build and the start are automatic.
3. In `radhe-api`: add the panel's address to `CORS_ORIGINS`, and set `COOKIE_DOMAIN` to the parent domain shared by the panel and the API.
4. Serve the panel over https only. It sends `Strict-Transport-Security`, a content security policy with a nonce per request, `X-Frame-Options: DENY` and `X-Robots-Tag: noindex`.

Every page is rendered per request (the content security policy needs a fresh nonce), so the panel needs a Node.js host, not a static export. Hostinger's Node.js web apps and Vercel both work.

Before the first real use, read the open items in `DECISIONS.md`: above all, create a second super admin account, because an admin who loses the authenticator can only be helped by another admin.
