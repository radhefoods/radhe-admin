# Prompt for the admin panel agent: discount codes

Copy everything below the line into the agent that works on the admin panel (`radhe-admin`).

---

You are working on the Radhe Foods admin panel (`radhe-admin`, Next.js). The API now manages discount codes for the retail shop: percentage or fixed-amount codes with a period, a usage limit and a once-per-customer option, applied by customers on the checkout page. Build the admin pages for them.

**Read first:** `doc/DISCOUNT_CODES.md` in the `radhe-api` repository (sections 2, 6, 7, 8 and 9 are yours), and section 26 of `doc/ADMIN_API_DOCUMENTATION.md` for the summary. All calls use the existing admin session (cookies) and the existing API client of the panel. Amounts are cents; percentages are whole numbers.

**Do not change the theme, colours, fonts, typography or any unrelated functionality.** Reuse the panel's existing tables, forms, badges, dialogs and money/date formatting.

## What to build

1. **Discount codes page** (sidebar entry next to the shop's catalogue or marketing pages, visible with permission `discounts.read`):
   - **List**: `GET /v1/admin/discounts?q=&status=&page=&limit=`. Columns: code (monospace, with a copy button), kind and value ("10 %" or "€5.00"), state badge (`active` green, `scheduled` blue, `expired` and `exhausted` grey, `inactive` muted), uses ("12 of 100 · 1 pending" from `usedCount`, `maxUses`, `reservedCount`; "12 · unlimited" when `maxUses` is null), period (`startsAt`–`expiresAt`), once per customer, an on/off switch calling `PATCH …/{id}` with `{ isActive }`. Filters: a search box (`q`) and a state select (`status`). Newest first, paginated.
   - **Create / edit form** (permission `discounts.manage`): `POST /v1/admin/discounts`, `PATCH /v1/admin/discounts/{id}`. Fields: code (text, upper-cased as typed, 4–20 letters, digits, hyphens; a "Generate" option leaves it empty so the API makes one), note, kind (`percent` / `fixed`), value (percent 1–100, or euros converted to cents), "Applies to products on sale" (`appliesToSaleItems`, default on), minimum goods value in euros (`minOrderValue`, optional), start and end (`startsAt`, `expiresAt`, ISO instants, optional; send `null` to clear on edit), maximum uses (`maxUses`, optional; `null` clears), once per customer (`oncePerCustomer`), active (`isActive`). Disable the code field when `usedCount + reservedCount > 0` (the API answers `409 DISCOUNT_IN_USE`). Show `400 DISCOUNT_VALUE_INVALID`, `400 DISCOUNT_SCHEDULE_INVALID` and `409 DISCOUNT_CODE_TAKEN` as field errors.
   - **Detail**: the code with all fields and counts, `remainingUses`, `state`, created by and when, and a **Uses** table from `GET /v1/admin/discounts/{id}/uses?page=&limit=`: order number (link to the order), customer email, amount, state badge (`reserved` = waiting for payment, `used` = paid, `released` = given up unpaid), date, settled at.
   - **Delete**: `DELETE /v1/admin/discounts/{id}` with a confirmation, only offered while `usedCount + reservedCount === 0`; otherwise offer "Switch off" instead and explain that used codes stay for the order history.

2. **Orders**: in the order list show `discountCode` when present (a small badge next to the number); in the order detail show the `discount` block (code, kind and value, amount, state) and a "Discount" row in the totals (`totals.discount`, and `finalTotals.discount` after returns). Each line has `discountAmount`.

3. **Roles form**: add `discounts.read` and `discounts.manage` to the permission list.

## Details

- `state` is derived by the API; do not compute it in the panel. The order of precedence is `inactive`, `scheduled`, `expired`, `exhausted`, `active`.
- A code that orders used cannot be deleted or renamed; everything else can change, including lowering `maxUses` below the uses so far (the code then shows `exhausted`).
- Dates: the API takes and answers ISO 8601 instants; show them in the panel's usual format.

## How to work

Write your plan first (pages, components, API calls, states) and wait for my go before coding. Then implement, run the panel's lint and type checks, and report what you built and what you left out.
