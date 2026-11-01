# Prompt for the admin panel agent: guests, deleted accounts, referrals, reviews, problem reports

Copy everything below the line into the agent that works on the admin panel (`radhe-admin`).

---

You are working on the Radhe Foods admin panel (`radhe-admin`, Next.js). The API gained guest orders, accounts that customers can close, a referral programme, product reviews that the admin approves, and problem reports after a delivery that the admin resolves. Build the panel side.

**Read first:** `doc/CUSTOMER_ACCOUNTS.md` in the `radhe-api` repository (the sibling folder `../radhe-api` of this repository; sections 2, 3, 5, 7, 8, 9 and 10 are yours), and sections 4, 9, 15 and 27 to 29 of `doc/ADMIN_API_DOCUMENTATION.md` there. These two files hold the complete contract: every endpoint, query, body, answer, permission and error code you need. If you cannot read that repository, ask for the two files. All calls use the existing admin session and API client; amounts are cents.

**Do not change the theme, colours, fonts, typography or any unrelated functionality.** Reuse the panel's tables, forms, badges, dialogs, image viewers and money/date formatting.

## What to build

1. **Customers**: a `kind` badge (`guest` / `registered`) and a `kind` filter on the list; `status` now includes `deleted`: show "Deleted account" with `deletedAt`, grey, with no personal fields, and no block/unblock button (`409 CUSTOMER_DELETED`). Everywhere a customer is named next to an order, return, refund, report or notification, the object has `customer.deleted`: render "Deleted account" instead of the name and no email. On the customer detail show `referralCode`, `referredBy` (link to that customer), `emailVerifiedAt`, a "Referrals" tab from `GET /v1/admin/referrals?referrerId={id}` and a "Reviews" tab from `GET /v1/admin/reviews?customerId={id}`.

2. **Orders**: a "Guest" badge on `isGuest` in the list and the detail; the `feedback` block (stars, delivery stars, comment, date) on the detail of delivered orders; a "Problem reports" box on the detail from `GET /v1/admin/issues?orderNumber={orderNumber}` with a link to each report, next to the returns of the order. Unpaid orders that were given up show as `cancelled` with nothing paid until the cleanup deletes them after three days; nothing to build, just do not be surprised when they vanish.

3. **Referrals** page (under Customers, permission `customers.read`): `GET /v1/admin/referrals` with the `status` filter (`registered`, `qualified`, `void`), columns inviter, invited, code, status badge, registered at, qualifying order (link), qualified at, void reason; `GET …/count` for the total.

4. **Reviews** page (sidebar entry, permission `reviews.read`; actions need `reviews.manage`): `GET /v1/admin/reviews` with the `status` filter, `pending` first by default, columns product (name and thumbnail, link), rating stars, title and text (clamped), author name, customer (link), order (link), written at, status badge; detail with Approve, Reject (with the note to the customer, required), Reply (public, editable, removable with `DELETE …/reply`), Delete. The start page's attention overview carries `reviews.pending`: add a card.

5. **Problem reports** page (under Orders, permission `orders.read`; decisions need `orders.manage`): `GET /v1/admin/issues` with the `status` filter (`open` first), columns number, order (link), customer, problems as chips, items, `reportedAmount`, wish (`preferredResolution`), status, reported at. Detail: the description, the photos (full-size viewer), the items with quantities, the history with notes, the internal note. Actions: "Take on" (`POST …/review`, optional internal note), "Resolve" (a dialog: resolution `refund` with the units per item prefilled from the report, `replacement`, or `none`; a note to the customer; an internal note) and "Reject" (note to the customer required). After a refund resolution, link to the order: its delivered quantities were corrected, a credit note was issued and the refund waits in the refund queue, as after a return. The attention overview carries `issues: { open, items }`: add a card with the open count and the newest reports.

6. **Settings**: in the return policy form, a field "Days to report a problem" (`issueWindowDays`, 0 switches reports off) next to the return window.

7. **Roles form**: add `reviews.read` and `reviews.manage` to the permission list.

## Details

- Statuses: reports `open`, `in_review`, `resolved`, `rejected`, `cancelled`; reviews `pending`, `published`, `rejected`; referrals `registered`, `qualified`, `void`. The API decides what is allowed; show the action buttons by status and map `409 …_TRANSITION_NOT_ALLOWED` to a reload.
- Dates and amounts in the panel's usual format; `resolution.amount` of a report is what was credited.

## How to work

Write your plan first (pages, components, API calls, states) and wait for my go before coding. Then implement, run the panel's lint and type checks, and report what you built and what you left out.
