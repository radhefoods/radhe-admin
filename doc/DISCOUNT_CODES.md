# Discount codes (retail shop)

Promotional codes for the retail shop (`shop.radhefoods.de`): the admin creates them in the panel, a customer enters one on the checkout page, and the bill, the order, the invoice and any credit note carry the discount. The wholesale site and its quotations are not involved.

## Contents

1. How it works
2. The rules of a code
3. The arithmetic: VAT, lines, returns
4. Data model
5. Store API (checkout page)
6. Admin API
7. Validation and errors
8. Permissions
9. Workflows for the admin panel and the shop

---

## 1. How it works

```text
Shop (checkout page)                   API                                   Admin panel
────────────────────                   ───                                   ───────────
                                                                             POST /v1/admin/discounts   DIWALI10, 10 %, max 100 uses
PUT /v1/store/checkout/discount ─────► the code is checked against the cart
  { code: "diwali10" }                 and kept with the cart; the bill
                                       answers with the discount taken off
GET /v1/store/cart ───────────────────► the same bill, until the code is removed or the order paid
POST /v1/store/checkout ─────────────► the order is made with the discount;
                                       one use of the code is RESERVED (reservedCount + 1)
   payment succeeds (Stripe webhook) ► the use is COUNTED (usedCount + 1, reservedCount − 1)
   payment never comes, order given up► the use is RELEASED (reservedCount − 1)
```

- **One code per order.** Applying another code replaces the first.
- **The checkout page only.** The cart page shows no code field; the bill of every cart endpoint still carries the discount once applied, so the totals are the same everywhere.
- **Nothing is counted before the payment.** Two orders at the same moment cannot both take the last use: the reservation is one atomic step in the database with the limit in its condition.
- **A paid order keeps its use** even if it is cancelled or refunded later. A use is given back only when the order was never paid.
- **Old orders are untouched.** Orders from before this feature have no `discount` and answer `totals.discount: 0`.

## 2. The rules of a code

| Rule | Field | Meaning |
|---|---|---|
| Kind and size | `type`, `value` | `percent` with a whole percent (1–100), or `fixed` with cents (up to 1,000,000 = 10,000 €). A fixed amount never exceeds the value of the goods it applies to. |
| Products on sale | `appliesToSaleItems` | `true` (default): every product gets the discount, on its sale price where there is one. `false`: lines whose unit price is a reduced one are left out. |
| Minimum | `minOrderValue` | Cents the goods in the cart must be worth **before** the discount (all lines that can be ordered, delivery not counted). |
| Period | `startsAt`, `expiresAt` | Optional instants. Before `startsAt` the code is `scheduled`; from `expiresAt` on it is `expired`. |
| Limit | `maxUses` | How often the code may be used in all; nothing means without limit. `usedCount + reservedCount` counts against it. |
| One per customer | `oncePerCustomer` | The customer may pay one order with it. An order that was given up unpaid does not count. |
| Switch | `isActive` | Off: the code cannot be applied, whatever else. Orders that used it are not affected. |

**State** (derived, in this order): `inactive` → `scheduled` → `expired` → `exhausted` → `active`.

**Code text:** letters, digits and hyphens, 4 to 20 characters, stored upper case. Customers may type it in any case. A generated code has 8 characters from `A–Z 2–9` without `I`, `O`, `0`, `1`.

## 3. The arithmetic: VAT, lines, returns

The discount comes off the **goods**, never off the delivery fee, and is spread over the lines that qualify **in proportion to their value**:

- `amount` = round(eligible goods × percent / 100), or min(fixed value, eligible goods).
- Each eligible line carries its share, rounded down; the cents that rounding leaves over go to the lines with the largest remainders, so the shares add up exactly and no line goes below zero.
- `lineTotal` of a line = units × unit price − its share. **VAT is computed on what is really paid** (the reduced price is the taxable amount, as German VAT law requires), once per rate on the sum of that rate, as before.
- `totals.subtotal` is the goods **before** the discount, `totals.discount` the amount taken off, `totals.total = subtotal − discount + deliveryFee`.
- **Free delivery** is reached with what is paid for the goods after the discount.
- **Returns and corrections:** a returned unit is refunded at what was paid for it: unit price less the proportional part of the line's discount (`round(discountAmount × units / quantity)`). `finalTotals` carries `discount` the same way, so credit notes stay exact.
- **Invoices and credit notes** list the products at their unit prices and then one negative line per VAT rate, `Discount DIWALI10` / `Rabatt DIWALI10`, so the reduction is on the document and the VAT summary matches. The PDF shows a "Discount" row between "Goods" and "Delivery".

Example (10 % on 2 × 3.99 at 7 % and 1 × 9.99 at 19 %, delivery 4.99):

| | before | discount | paid |
|---|---|---|---|
| Atta 2 × 3.99 | 7.98 | 0.80 | 7.18 |
| Ghee 1 × 9.99 | 9.99 | 1.00 | 8.99 |
| Goods | 17.97 | 1.80 | 16.17 |
| Delivery | | | 4.99 |
| **Total** | | | **21.16** |

One bag of atta returned: refund 3.99 − 0.40 = **3.59**; the credit note shows `1 × Atta 3.99` and `Discount DIWALI10 −0.40` at 7 %.

## 4. Data model

**`discountCodes`**

| Field | Type | Notes |
|---|---|---|
| `code` | string | upper case, unique |
| `note` | string? | internal, ≤ 200 |
| `type` | `percent` \| `fixed` | |
| `value` | int | whole percent, or cents |
| `appliesToSaleItems` | boolean | default true |
| `minOrderValue` | int? | cents, goods before the discount |
| `startsAt`, `expiresAt` | Date? | |
| `maxUses` | int? | nothing = unlimited |
| `oncePerCustomer` | boolean | default false |
| `isActive` | boolean | default true |
| `usedCount` | int | orders paid with the code |
| `reservedCount` | int | orders made with the code that wait for their payment |
| `createdBy` | ObjectId | admin |
| `createdAt`, `updatedAt` | Date | |

Indexes: unique `code`; `(isActive, _id)`.

**`discountUses`** — one record per order made with a code.

| Field | Type | Notes |
|---|---|---|
| `codeId`, `code` | | |
| `customerId`, `customerEmail` | | |
| `orderId`, `orderNumber` | | |
| `amount` | int | cents taken off the order |
| `state` | `reserved` \| `used` \| `released` | |
| `counts` | boolean | true while reserved or used |
| `perCustomer` | boolean | copied from the code |
| `settledAt` | Date? | paid, or given up |

Indexes: unique `orderId`; unique `(codeId, customerId)` **partial on `perCustomer: true, counts: true`** (this is what holds a customer to one order, whatever arrives at the same moment); `(codeId, _id)`.

**`carts.discountCode`** (string?): the code of the checkout page, kept until the order is paid (the cart is emptied then) or the customer removes it.

**`orders`**: `discount { codeId, code, type, value, amount, state }` when a code was applied; `items[].discountAmount` (cents taken off the line); `totals.discount` and `finalTotals.discount`.

**`invoices`**: the discount lines (negative, per VAT rate) and `totals.discount`.

Run `npm run db:indexes` after deploying: the two collections and their indexes are new.

## 5. Store API (checkout page)

All with the customer session. The answer of every call below is **the full bill** of section 8.1 of `doc/CUSTOMER_WEB_API_DOCUMENTATION.md`, which now carries:

```json
{
  "lines": [{ "…": "", "unitPrice": 399, "discountAmount": 80, "lineTotal": 718, "vatAmount": 47 }],
  "totals": { "currency": "EUR", "subtotal": 1797, "discount": 180, "deliveryFee": 499, "total": 2116, "netTotal": 1886, "vatTotal": 230, "vat": ["…"] },
  "delivery": { "fee": 499, "freeFrom": 5000, "missingForFree": 3383 },
  "discount": { "code": "DIWALI10", "type": "percent", "value": 10, "amount": 180, "applied": true, "reason": null }
}
```

`discount` is `null` while no code is entered. When a code was applied and later stops applying (the cart shrank below the minimum, the code ran out), it stays on the bill with `applied: false`, `amount: 0` and a `reason`, so the page can say so; the checkout then refuses and removes it (below).

### `PUT /v1/store/checkout/discount`

Body `{ "code": "diwali10" }` (any case, ≤ 40 characters). Checks the code against the current cart and keeps it with the cart. Rate limit 20 per minute.

- `200`: the bill with the discount.
- `400 DISCOUNT_NOT_APPLICABLE` with `details: { code, reason }`; nothing is kept. `reason` is one of `not_found`, `inactive`, `not_started`, `expired`, `exhausted`, `already_used`, `below_minimum`, `nothing_eligible` (every product in the cart is on sale and the code excludes those).

### `DELETE /v1/store/checkout/discount`

Removes the code. `200` with the bill.

### `POST /v1/store/checkout`

Unchanged request. The order is made with the code kept on the cart; `expectedTotal` is the `totals.total` of the bill with the discount. New refusal: `409 DISCOUNT_NOT_APPLICABLE` with `details: { code, reason }` when the code stopped applying; the code is removed from the cart, and the page should load the bill again. The answer's `order` carries `discount { code, type, value, amount, state }` (`state: "reserved"`), `items[].discountAmount` and `totals.discount`.

The order (`GET /v1/store/orders/{orderNumber}`) carries the same `discount` block with `state` `reserved`, `used` or `released`, plus `finalTotals.discount`. Invoices and credit notes (`GET /v1/store/invoices/{number}`) list the discount lines and `totals.discount`.

## 6. Admin API

Base `/v1/admin/discounts`. The code object:

```json
{
  "id": "6720…", "code": "DIWALI10", "note": "Diwali newsletter",
  "type": "percent", "value": 10, "appliesToSaleItems": true,
  "minOrderValue": null, "startsAt": null, "expiresAt": "2026-11-15T23:00:00.000Z",
  "maxUses": 100, "oncePerCustomer": true, "isActive": true,
  "usedCount": 12, "reservedCount": 1, "remainingUses": 87, "state": "active",
  "createdBy": { "id": "…", "name": "Vrushabh" }, "createdAt": "…", "updatedAt": "…"
}
```

| Endpoint | Permission | Body / query | Answer |
|---|---|---|---|
| `GET /v1/admin/discounts?q=&status=&page=&limit=` | `discounts.read` | `q` searches code and note; `status` one of `active`, `inactive`, `scheduled`, `expired`, `exhausted` | page `{ items, page, limit, total, totalPages }`, newest first |
| `POST /v1/admin/discounts` | `discounts.manage` | `{ code?, note?, type, value, appliesToSaleItems?, minOrderValue?, startsAt?, expiresAt?, maxUses?, oncePerCustomer?, isActive? }`; without `code` one is generated | `201 { discount }` |
| `GET /v1/admin/discounts/{id}` | `discounts.read` | | `{ discount }` |
| `PATCH /v1/admin/discounts/{id}` | `discounts.manage` | any field of the create body; `null` removes `minOrderValue`, `startsAt`, `expiresAt`, `maxUses`; `isActive` switches the code on or off | `{ discount }` |
| `DELETE /v1/admin/discounts/{id}` | `discounts.manage` | | `204`; `409 DISCOUNT_IN_USE` once an order used or reserved it (switch it off instead) |
| `GET /v1/admin/discounts/{id}/uses?page=&limit=` | `discounts.read` | | page of `{ id, orderId, orderNumber, customer { id, email }, amount, state, at, settledAt }`, newest first |

Orders (`GET /v1/admin/orders`, `…/{id}`) carry `discountCode` in the summary and `discount { code, type, value, amount, state }`, `items[].discountAmount`, `totals.discount`, `finalTotals.discount` in the detail.

## 7. Validation and errors

| Rule | Error |
|---|---|
| `code` 4–20 characters of `A–Z 0–9 -`, starting and ending with a letter or digit | `400 VALIDATION_FAILED` |
| `value` 1–1,000,000; a `percent` value at most 100 | `400 VALIDATION_FAILED` / `400 DISCOUNT_VALUE_INVALID` |
| `expiresAt` after `startsAt` | `400 DISCOUNT_SCHEDULE_INVALID` |
| the code text exists | `409 DISCOUNT_CODE_TAKEN` |
| the text of a used code, or deleting a used code | `409 DISCOUNT_IN_USE` (details `usedCount`, `reservedCount`) |
| unknown id | `404 DISCOUNT_NOT_FOUND` |
| a code that cannot be applied (store) | `400 DISCOUNT_NOT_APPLICABLE` on apply, `409 DISCOUNT_NOT_APPLICABLE` at checkout; `details { code, reason }` |

## 8. Permissions

`discounts.read` to see codes and their uses, `discounts.manage` to create, change, switch and delete. Super admins have everything. Grant them to the roles that run promotions.

## 9. Workflows for the admin panel and the shop

**Admin panel** (`doc/ADMIN_PANEL_DISCOUNTS_AGENT_PROMPT.md`): a "Discount codes" page under the shop's marketing or catalogue area with the list (code, kind and value, state badge, uses "12 of 100 · 1 pending", period, switch), a form (code with "Generate" button, kind, value, applies to sale items, minimum, period, limit, once per customer, note, active), and a detail with the uses table. Delete only when `usedCount + reservedCount === 0`; otherwise offer "Switch off". Add `discounts.read` / `discounts.manage` to the roles form. On the order detail show the code and the discount row.

**Shop** (`doc/CUSTOMER_WEB_DISCOUNTS_AGENT_PROMPT.md`): on the checkout page a "Discount code" field with Apply, calling `PUT /v1/store/checkout/discount`; on success render the bill it answers (a "Discount DIWALI10 −€1.80" row between goods and delivery, the per-line amounts optional) and a "Remove" link calling `DELETE`; on `400` show a message by `reason`. Send `expectedTotal` from that bill. On `409 DISCOUNT_NOT_APPLICABLE` at checkout, reload the bill and tell the customer the code was removed. The cart page shows no field, but may show the applied code and the discount row since the bill carries them. Order and invoice pages show the discount row.
