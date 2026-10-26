# How the panel is built

The conventions every page of the Radhe Foods admin panel follows. Read this before adding a page. The reasons behind the larger decisions are in `DECISIONS.md`.

## The authority

`doc/ADMIN_API_DOCUMENTATION.md` is the authority for every endpoint, field, status, transition, permission and error. Do not invent any of them. Where something is missing in the API, say so in `DECISIONS.md` ("What the API cannot do") and work around it.

## Where things live

```text
src/app/(auth)/…            sign-in, forced password change
src/app/(panel)/…           every page behind the sign-in; a page file only sets the title and renders a view
src/features/<area>/        the views, dialogs, queries and tests of one area (orders, catalogue, …)
src/components/ui/          primitives: button, input, dialog, menu, badge, surface (card, alert, empty state), toast, scroll-x
src/components/data/        data-table, filter-bar, pagination (page-based and "load more"), charts (SVG lines, bars, donut, share bars)
src/components/form/        form.tsx (Field, useZodForm, useSubmit, FormError, TextField …), fields.tsx (MoneyField, BilingualField, …), reason-field.tsx
src/components/domain/      status-badge, permission (RequirePermission, ActionButton, Can), values (Money, DateTime, AdminName …), timeline, pdf-viewer (a PDF of the API in a dialog)
src/components/shell/       sidebar, topbar, global search, page header, crash (what a failed page shows)
src/lib/api/                the typed client: types/, endpoints/, errors, error-text, query-keys, session
src/lib/format/             money, dates (German time), names
src/lib/status/             status → label and tone; the documented transitions
src/lib/auth/               who is signed in, permissions
src/lib/routes.ts           every address of the panel
mocks/                      the mock admin API (development and tests)
src/test/                   the test harness: the mock API behind fetch, render helpers, the fake upload (XMLHttpRequest over fetch)
e2e/                        browser tests (Playwright) against the mock API
```

A component two areas share takes what differs as a parameter rather than a copy: the picture manager and the category picture take the record's endpoints (`ImageTarget`, `PictureSubject` in `src/features/catalogue/`), the import dialog takes the catalogue (`SheetCatalogue`); `src/features/wholesale/` uses all three against the wholesale endpoints. The reference feature is `src/features/orders/`: list with URL state and bulk actions (`orders-list.tsx`, `orders-bulk.tsx`), detail (`order-view.tsx`), confirmations with the real numbers (`order-dialogs.tsx`), a card with its own permission and dialog (`order-payment.tsx`), queries (`queries.ts`) and tests (`order-flows.test.tsx`). The small reference for a panel with one dialog and a cursor list is the stock of a product (`src/features/catalogue/stock-panel.tsx`, `stock.ts`, `stock-flows.test.tsx`). The reference for a table inside a form that is saved in a sequence of requests is the pack-size table of the product (`variant-rows.tsx`, `product-schema.ts` with `planOf`, `queries.ts` with `useSaveProduct`, the "pack sizes of a product" tests in `catalogue-flows.test.tsx`).

## Rules

**API calls.** Only through `api` from `@/lib/api/client`. Nothing else builds a URL of the API. Read with `useQuery` and a key from `queryKeys`; write with `useMutation` and name what becomes stale in `meta.invalidates` (see `invalidation` in `query-keys.ts`). A mutation whose error is shown by a form or a dialog sets `meta: { silent: true }`; otherwise a failed mutation is reported as a toast by itself.

**Permissions.** A page wraps its content in `<RequirePermission permission="x.read">`. A button that changes data is an `<ActionButton permission="x.manage">`: without the permission it stays visible, disabled, with a hint. Parts that need another permission than the page (`payments.read` inside an order) check `useCan()` and leave the part out or explain. The API enforces everything anyway; a `403` is still handled.

**Statuses.** Always `<StatusBadge kind="order" value={status} />`. Six tones, one meaning each (see `src/lib/status/index.ts`); never a colour chosen by hand for a status. Buttons for status changes come from what the API allows (`allowedStatuses`, `canCancel`, `needsRefund`, `refundable`, …), never from the panel's own guess. A pending order has no status button: its payment confirms it.

**Lists.** Filters, search, sort and page live in the address (`useUrlState` with `param.*`). Only the filters, search and sorts the documentation states; nothing client-side on top unless the page holds all rows. Page-based lists (products) use `<Pagination>`; cursor lists use `useInfiniteQuery` and `<LoadMore>` (they have no total). Every list has an empty state that says what belongs here and what to do next, and shows the API's error with a retry.

**Tables.** `<DataTable>` with `Column<T>[]`. Numbers and money right (`meta.align: "right"`), the first cell holds the real link, `rowHref` makes the row lead there too. Use `meta.from` to drop columns on narrow screens; give lists used on a phone a `card`. A plain `<table>` that can be wider than a phone sits in `<ScrollX label="…">` (`components/ui/scroll-x.tsx`): it scrolls inside its frame, the page never scrolls sideways, and the keyboard can reach it.

**Forms.** `useZodForm(schema)` with a zod schema that mirrors the API's validation, fields from `components/form`, submit through `useSubmit` (it puts the API's `details[].field` errors at the fields) and `<FormError>` for the rest. Money is typed in euros and sent as integer cents (`MoneyField` with `zEuros`); never a float in a payload. Times are typed and shown as German time (`BerlinDateTimeField`, `zBerlinDateTime`, `formatDateTime`). Content in two languages uses `BilingualField`. A long form gets `<UnsavedGuard when={form.formState.isDirty} />`.

**Confirmations.** Anything destructive or money-moving goes through `<ConfirmDialog>`: a title that asks, a description of what will happen, `facts` with the real numbers from the API, a confirm label that says what it does ("Activate and notify 10 customers"). `tone="danger"` for what cannot be undone; `requireText` for the few actions that would be costly by accident. The dialog shows the error of its own action; `errorHelp` adds what helps with it (a link to where it is fixed).

**Errors.** `errorMessage(error)` / `describeError(error)` from `@/lib/api/error-text`. A documented code gets the panel's sentence; an unexpected error also shows the API's message and the request id. Every documented code has a sentence there (a test checks it).

**Colours and type.** Only the tokens of `src/app/globals.css` (`bg-surface`, `text-ink-muted`, `border-line`, `bg-accent`, the tone colours …). The default Tailwind palette is switched off. Both themes must work: never a literal colour. Blue (`accent`) is for the one primary action of a screen; gold is time and deadlines. Page titles use `font-display`; numbers in columns use `tabular`.

**Copy.** English, plain, written from the admin's side. Buttons say what happens. No em dashes. The exact status names of the API, made readable.

**Accessibility.** Every control has a label; dialogs have titles; icons are decorative (`aria-hidden`) or labelled; focus is visible; nothing depends on colour alone. Text on a tinted or coloured background is never dimmed with `opacity-*`: the tokens are chosen to pass AA as they are. `e2e/accessibility.spec.ts` runs axe on every main page in both themes; add a new page to its list.

**The parts on one page.** `/styleguide` (signed in, not in the navigation) shows the tones, every status of the API, buttons, notices, confirmations, values and form fields. After a change to a token or a shared component, look at it there in both themes.

**When a page fails.** `src/app/(panel)/error.tsx` keeps the navigation and offers "Try again"; `src/app/global-error.tsx` is the last resort. Errors of the API are not thrown into these: they are shown where they happen.

## Checks

```bash
npx tsc --noEmit                       # types (while `next dev` runs, do NOT run `next typegen` or `npm run typecheck`)
npx eslint                             # lint
npx vitest run                         # unit and component tests
npm run test:e2e                       # browser tests against the mock API
```

A component test starts with `// @vitest-environment jsdom`, installs the mock API with `installTestApi()` and renders with `renderPanel()` (see `src/features/orders/order-flows.test.tsx`). Test what loses money or data when wrong: the amounts shown before a confirmation, the request that is sent, the permission gating.

## The mock API

`npm run dev:mock` starts it on port 3000 with demo data (products with their stock, orders in every status, returns, refunds, messages). Sign in with `owner@radhefoods.de` / `radhe-owner-2026` and the code `000000`. More sign-ins (a read-only role, an order manager, a newcomer who must set up the authenticator and change the password) are in `mocks/seed.ts`. The mock keeps everything in memory: a restart brings the demo data back.
