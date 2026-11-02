# Points and rewards (loyalty coins)

The loyalty program of the retail shop (`shop.radhefoods.de`), as of 2026-11-02. Customers collect **coins** for delivered orders, the sign-up, referrals and published reviews, and redeem them on the checkout page for a percentage off the goods. The admin sets every rule in the panel; nothing is hard-coded. For the Admin Panel agent, the Retail Web agent, and whoever maintains the API.

**Strict rule for both frontends:** do not change the theme, colours, fonts or typography. Everything goes into the existing layouts and components.

## Contents

1. [How it works](#1-how-it-works)
2. [The owner's decisions](#2-the-owners-decisions)
3. [The arithmetic](#3-the-arithmetic)
4. [Data model](#4-data-model)
5. [Store API](#5-store-api)
6. [Admin API](#6-admin-api)
7. [Errors](#7-errors)
8. [Shop integration](#8-shop-integration)
9. [Panel integration](#9-panel-integration)
10. [Deployment notes](#10-deployment-notes)

---

## 1. How it works

```text
Shop                                       API                                              Admin panel
────                                       ───                                              ───────────
                                                                                            PUT /v1/admin/rewards/settings   the rules
sign-up verified ─────────────────────────► welcome coins (once per email)
GET /v1/store/me/rewards ─────────────────► balance, totals, the rules, canRedeem
GET /v1/store/cart ───────────────────────► the bill says rewards.maxCoins / maxAmount / earn
PUT /v1/store/checkout/rewards {coins?} ──► the coins are priced into the bill, kept with the cart
POST /v1/store/checkout ──────────────────► the order is made; the coins are RESERVED (balance − coins)
   payment succeeds (Stripe webhook) ─────► the coins are SPENT; the invoice shows "Coins redeemed (59)"
   payment never comes, order given up ───► the coins are RELEASED (balance + coins)
   admin marks the order delivered ───────► the order EARNS coins on the goods paid for
   goods credited later (return, report) ─► coins of those goods come back; earned coins shrink
   referral qualifies / review published ─► coins for the inviter (and invitee) / the reviewer
   expiry on, balance idle for N months ──► the balance EXPIRES (daily job, POST /v1/jobs/run)
```

- **Nothing is counted before the payment, nothing is earned before the delivery.**
- **Every movement is one row of a ledger with a key**, written once. The account document is the sum, changed in the same database transaction. A webhook that arrives twice, an admin who clicks twice, a job that runs twice: the key is taken, nothing happens again.
- **A coin is worth a percentage of the goods it is redeemed on** (the owner's choice, section 2). The same coins take more off a larger order.
- **Guests have no coins.** They earn nothing and cannot redeem; a guest who registers later starts at the welcome coins.
- **Old orders are untouched.** Orders from before the program have no `rewards` and answer `totals.rewards: 0`.
- **Switching the program off** (`enabled: false`) stops earning and redeeming at once; balances stay and are shown.

## 2. The owner's decisions

| Question                  | Decision                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a coin is worth      | A **percentage of the goods** per coin (`percentPerCoin`, e.g. 0.01 %: 100 coins = 1 %, 59 coins = 0.59 %), configurable to fractions such as 0.001 %. Not a fixed cent value.                                      |
| When order coins arrive   | **At delivery**, never at payment.                                                                                                                                                                                  |
| What they are computed on | The goods **after the discount code and after the coins redeemed**, delivery excluded, rounded to the nearest coin (51.78 € → 52 coins at one coin per euro).                                                       |
| Welcome coins             | Spendable **at once** after the verified sign-up, including on the first order. Once per email address, even after the account was closed and made again.                                                           |
| Referral coins            | Inviter: when the invited person's first order is delivered (default 100). Invitee: optional (default 50, switched off). Both configurable and switchable. Once per referral; taken back when the referral is void. |
| Review coins              | When the **admin publishes** the review, once per order review; taken back when the review is rejected or deleted afterwards.                                                                                       |
| Expiry                    | **Off by default.** When on: the whole balance expires after N months without earning or spending.                                                                                                                  |
| Minimums and caps         | Optional minimum coins, minimum reward value, minimum goods value; maximum coins per order, maximum euro discount; whether coins combine with discount codes. All from the panel.                                   |
| Defaults in the code      | Program **off**; one coin per euro; 0.01 % per coin; at most 5 € per order; inviter 100; everything else set by the admin.                                                                                          |

## 3. The arithmetic

All amounts are cents, VAT included; coins are whole numbers. The pure functions live in `src/modules/rewards/reward-rules.ts` and are unit-tested.

**Redeeming.** `discount = round(goods × coins × percentPerCoin / 100)`, computed in exact integer arithmetic (BigInt), where `goods` is the value of the orderable lines after the discount code. 59 coins at 0.01 % on 50.00 € are 29.5 cents, rounded to 30. The customer asks for a number of coins, or for "as many as allowed"; the backend then:

1. refuses when the program or redeeming is off, the customer has no coins, a code is applied and coins do not combine, the goods are below `minOrderValue`, or the balance is below `minCoins`;
2. finds the **most coins** the bill allows: the balance, `maxCoinsPerOrder`, and the largest count whose discount stays within `maxDiscount` and within the goods;
3. takes the requested count, capped at that most; computes the discount; refuses `too_small` when it is 0 cents, `below_min_value` when it is below `minRedeemValue`, `insufficient` when more was asked than the customer has;
4. **lowers the count to the fewest coins that give the same cents**, so a customer never gives a coin that changes nothing (1,000 coins at 0.001 % on 5.00 € are 5 cents; 900 do the same, 900 are taken).

The discount is **spread over the lines in proportion to their value** (same rule as the discount code: the cents that rounding leaves go to the lines with the largest remainders), so the VAT of every line is computed on what is really paid, as German VAT law requires for a reduction granted by the seller. The delivery fee is never reduced. Free delivery counts the goods after the code and the coins.

**Earning.** `coins = round(goodsPaid × rate / 100)`, `goodsPaid = subtotal − discount − rewards` of the order's **final** totals at the moment of delivery, `rate = coinsPerEuro`, times the campaign multiplier while a campaign is active. The rate is stored on the ledger row, so later corrections use the rate that applied.

**Credits after payment** (a return completed, a correction, a resolved problem report): the final totals change and the hook fires inside the same transaction.

- Coins redeemed: the share of the coin discount that belonged to the credited units is not used any more; `coinsBack = round(coins × unusedCents / amount)`, capped at what is still out, comes back as a `redeem_return` row. The credit note shows the coin share as a negative line, so the customer gets back exactly what was paid.
- Coins earned: `target = round(goodsPaidNow × rate)`; when it is below what the order earned so far, a `reversal` row takes the difference. A balance can go below zero this way; it shows as 0 and must be earned off.

**Cancellation.** An unpaid order releases the reserved coins. A paid order that is cancelled returns all coins that were not returned yet.

**Expiry.** `lastActivityAt` is the last earning or spending. When the expiry is on and the balance has not moved for `inactivityMonths`, the daily job clears it with an `expiry` row. Accounts with coins held by an open checkout wait.

## 4. Data model

**`rewardAccounts`** (one per customer, made on first use): `customerId` (unique), `available` (spendable; below zero after reversals), `reserved` (held by unpaid orders), `earned` (lifetime), `redeemed` (lifetime spent), `lastActivityAt`. Indexes: unique `customerId`, `(available, _id)`, `(lastActivityAt, _id)`.

**`rewardTransactions`** (append-only ledger): `customerId`, `type`, signed `coins`, `state`, `key` (unique), `orderId`, `orderNumber`, `reference`, `rate`, `reason`, `note`, `adminId`, `at`.

| `type`                                 | Means                                                                          | Key                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `welcome`                              | the verified sign-up                                                           | `welcome:<keyed hash of the email>`                               |
| `order`                                | a delivered order                                                              | `order:<orderId>`                                                 |
| `referral_inviter`, `referral_invitee` | a referral that qualified                                                      | `referral_inviter:<referralId>`                                   |
| `review`                               | a published review                                                             | `review:<reviewId>`                                               |
| `redeem`                               | coins spent on an order (negative); `state` `reserved` → `spent` or `released` | `redeem:<orderId>`                                                |
| `redeem_return`                        | coins back after a credit or a cancellation                                    | `redeem_return:<orderId>:<reference>`                             |
| `reversal`                             | coins taken back (goods credited after delivery, referral void, review gone)   | `reversal:order:<orderId>:<reference>`, `reversal:review:<id>`, … |
| `adjustment`                           | by hand, by the admin, with `reason` and `note`                                | `adjustment:<new id>`                                             |
| `expiry`                               | an idle balance cleared                                                        | `expiry:<customerId>:<time>`                                      |

**Orders:** `rewards { coins, amount, percentPerCoin, state: reserved | used | released }` when coins were redeemed; `items[].rewardAmount` (cents of the coin discount on the line); `totals.rewards` and `finalTotals.rewards`. **Carts:** `rewardCoins` (a number, or `null` for "as many as allowed") while chosen on the checkout page. **Invoices and credit notes:** one negative line "Coins redeemed (59)" / "Eingelöste Coins (59)" per VAT rate; `totals.rewards`; the PDF shows a "Coins redeemed" row under the discount.

**Settings** (`rewards` in the settings store, `RewardsSettings` in `src/modules/settings/settings.ts`):

```json
{
  "enabled": false,
  "earning": {
    "order": { "enabled": true, "coinsPerEuro": 1 },
    "welcome": { "enabled": false, "coins": 0 },
    "referral": {
      "inviter": { "enabled": true, "coins": 100 },
      "invitee": { "enabled": false, "coins": 50 }
    },
    "review": { "enabled": false, "coins": 0 },
    "campaign": {
      "enabled": false,
      "multiplier": 2,
      "startsAt": null,
      "endsAt": null,
      "name": null
    }
  },
  "redemption": {
    "enabled": true,
    "percentPerCoin": 0.01,
    "minCoins": null,
    "minRedeemValue": null,
    "minOrderValue": null,
    "maxCoinsPerOrder": null,
    "maxDiscount": 500,
    "combinableWithDiscountCodes": true
  },
  "expiry": { "enabled": false, "inactivityMonths": 12 }
}
```

`coinsPerEuro`: up to four decimals, 0 to 1000. `percentPerCoin`: up to six decimals, 0.000001 to 10. `multiplier`: 1 to 10. Cents up to 10,000,000; coins up to 1,000,000. `null` switches a minimum or a cap off.

## 5. Store API

| Endpoint                                             | Auth     | Answer                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/store/rewards/program`                      | none     | `{ program }`: the rules as the shop explains them (section 8). 60 calls per minute per IP                                                                                                                                                                                                                  |
| `GET /v1/store/me/rewards`                           | customer | `{ account: { available, balance, reserved, earnedTotal, redeemedTotal, lastActivityAt, expiresAt }, canRedeem, reason, program }`. `available` is never below 0; `balance` is exact. `canRedeem` says whether redeeming is offered for this balance (`reason` ∈ `disabled`, `no_coins`, `below_min_coins`) |
| `GET /v1/store/me/rewards/transactions?page=&limit=` | customer | `{ items: [ { id, type, coins, state, orderNumber, reference, reason, at } ], page, limit, total, totalPages }`, newest first; coins of given-up orders left out                                                                                                                                            |
| `GET /v1/store/cart` and every cart answer           | customer | the bill with `lines[].rewardAmount`, `totals.rewards`, and `rewards { requested, coins, amount, applied, reason, maxCoins, maxAmount, earn }` (`null` for visitors and guests)                                                                                                                             |
| `PUT /v1/store/checkout/rewards`                     | customer | Body `{ coins? }`; without `coins`, as many as allowed. Answers the full bill with the coins applied, or `400 REWARDS_NOT_APPLICABLE` with `details.reason`. The choice stays with the cart until the order is paid or removed. 30 calls per minute                                                         |
| `DELETE /v1/store/checkout/rewards`                  | customer | the bill without the coins                                                                                                                                                                                                                                                                                  |
| `POST /v1/store/checkout`                            | customer | unchanged; the coins of the cart are priced in and reserved. `409 REWARDS_NOT_APPLICABLE` when they stopped applying (the choice is dropped from the cart)                                                                                                                                                  |
| `POST /v1/store/auth/signup/verify`                  | none     | now also `rewards: { welcomeCoins }`                                                                                                                                                                                                                                                                        |
| `GET /v1/store/me/overview`                          | customer | now also `rewards: { enabled, available }`                                                                                                                                                                                                                                                                  |
| `GET /v1/store/orders/{orderNumber}`                 | customer | now also `rewards { coins, amount, percentPerCoin, state } \| null`, `items[].rewardAmount`, `totals.rewards`, `finalTotals.rewards`                                                                                                                                                                        |

`rewards` on a bill, in words: `maxCoins` and `maxAmount` are the most this cart allows right now; `earn` the coins the order will bring at delivery with the current rules (0 when the program or order earning is off); `applied: false` with `reason: null` means nothing was chosen yet.

## 6. Admin API

| Endpoint                                              | Body / query                                                                                                         | Answer                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/admin/rewards/settings`                      |                                                                                                                      | `{ settings }` (section 4)                                                                                                                                     |
| `PUT /v1/admin/rewards/settings`                      | the whole settings document                                                                                          | `{ settings }`; `400 REWARDS_SETTINGS_INVALID` when a campaign ends before it starts                                                                           |
| `GET /v1/admin/rewards/summary`                       |                                                                                                                      | `{ accounts, accountsWithBalance, coinsOutstanding, coinsReserved, last30Days: { earned, redeemed, returned, reversed, adjusted, expired, ordersWithCoins } }` |
| `GET /v1/admin/rewards/accounts`                      | `customerId`, `withBalance` (`true`/`false`), `limit`, `cursor`, `sort` (`available`, `lastActivityAt`, `createdAt`) | `{ items: [ account ], nextCursor }`                                                                                                                           |
| `GET /v1/admin/rewards/accounts/{customerId}`         |                                                                                                                      | `{ account, transactions: [ the latest 50 ] }`; `404 CUSTOMER_NOT_FOUND`                                                                                       |
| `POST /v1/admin/rewards/accounts/{customerId}/adjust` | `{ coins (signed), reason: goodwill \| correction \| misuse \| other, note? }`                                       | `201 { account, transaction }`; `400 REWARDS_AMOUNT_INVALID` for 0                                                                                             |
| `GET /v1/admin/rewards/transactions`                  | `customerId`, `type`, `orderNumber`, `limit`, `cursor`, `sort` (`createdAt`, `type`)                                 | `{ items: [ transaction ], nextCursor }`                                                                                                                       |
| `GET /v1/admin/rewards/transactions/count`            | the same filters                                                                                                     | `{ total }`                                                                                                                                                    |

**Account:** `id`, `customerId`, `customer { id, name, email, deleted }`, `available`, `balance`, `reserved`, `earnedTotal`, `redeemedTotal`, `lastActivityAt`, `expiresAt`, `createdAt`, `updatedAt`. **Transaction:** `id`, `type`, `coins`, `state`, `orderId`, `orderNumber`, `reference`, `rate`, `reason`, `note`, `customerId`, `customer`, `adminId`, `admin { id, name }`, `key`, `at`.

**Permissions:** `rewards.read` to look, `rewards.manage` to change the rules and adjust by hand. Super admins have everything; other roles need the new permissions added in the roles page.

`POST /v1/jobs/run` now also answers `rewards: { expired }`.

## 7. Errors

| Code                       | Status                                      | When                                                                                                                                            |
| -------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `REWARDS_NOT_APPLICABLE`   | 400 (checkout page), 409 (`POST /checkout`) | `details.reason` ∈ `disabled`, `no_coins`, `below_min_coins`, `below_min_order`, `below_min_value`, `code_applied`, `too_small`, `insufficient` |
| `REWARDS_AMOUNT_INVALID`   | 400                                         | an adjustment of 0 coins                                                                                                                        |
| `REWARDS_SETTINGS_INVALID` | 400                                         | the campaign ends before it starts                                                                                                              |
| `VALIDATION_FAILED`        | 400                                         | fields out of range (section 4)                                                                                                                 |

Messages the shop may show, per reason: "Coins cannot be redeemed at the moment." / "You have no coins to redeem." / "You do not have enough coins to redeem yet." / "The goods in the cart are worth less than coins require." / "Your coins are not worth enough yet to be redeemed." / "Coins cannot be combined with a discount code." / "These coins would take nothing off this order." / "You do not have that many coins."

## 8. Shop integration

- **Checkout page**, next to the discount code: while `rewards.maxCoins > 0`, a "Redeem coins" box: "You have 100 coins. Redeem up to 100 coins for € 0.90", a number field (default `maxCoins`) and "Redeem all", sent with `PUT /v1/store/checkout/rewards`; once applied, "59 coins: − € 0.53" with "Remove". While `rewards.reason` is set and not `null`, show the message of section 7 instead of the box (or nothing for `no_coins`). Under the total: "You will earn 17 coins with this order" while `rewards.earn > 0`. The bill is the API's bill: never compute the discount in the browser.
- **Order detail**: a "Coins redeemed: 59 (− € 0.53)" line while `rewards` is set; `totals.rewards` in the totals.
- **Account**: a "Coins" or "Rewards" page from `GET /v1/store/me/rewards`: the balance large, "earned in all" and "redeemed in all", `expiresAt` when set ("Your coins expire on …"), the rules in words from `program` ("1 coin per euro", "100 coins for signing up", "100 coins when a friend's first order is delivered", "25 coins for a review", "100 coins = 1 % off", caps and minimums), and the history from `…/transactions` with a label per `type` (Order RF-1084 / Welcome / Friend invited / Friend's order / Review / Redeemed on RF-1085 / Returned from RF-1085 / Taken back / Adjusted by Radhe Foods / Expired). The account overview shows `rewards.available` in a tile when `rewards.enabled`.
- **Sign-up**: after `signup/verify`, "You received 100 coins" while `rewards.welcomeCoins > 0`.
- **A "how it works" page or section** from `GET /v1/store/rewards/program`, shown only while `program.enabled`.
- **Texts** in English and German as the shop has them. Suggested German: "Coins einlösen", "Alle einlösen", "Entfernen", "Sie haben 100 Coins", "Bis zu 100 Coins für 0,90 € einlösen", "Mit dieser Bestellung erhalten Sie 17 Coins", "Eingelöste Coins", "Insgesamt gesammelt", "Insgesamt eingelöst", "Ihre Coins verfallen am …", "So funktioniert es".

## 9. Panel integration

- **Points & Rewards section** in the sidebar (`rewards.read`), with tabs:
  - **Settings** (`rewards.manage` to save): the program switch; earning (coins per euro, welcome, referral inviter and invitee, review, campaign with multiplier, period and name), each with its switch; redemption (percent per coin with a live example "100 coins = 1 % of the goods", minimum coins, minimum reward value, minimum goods value, maximum coins per order, maximum discount, combinable with codes); expiry (switch, months). Save the whole document with `PUT …/settings`.
  - **Overview**: the summary numbers.
  - **Accounts**: the list with customer, available, reserved, earned, redeemed, last activity; `withBalance` filter; row to the account detail with the history and "Adjust coins" (signed coins, reason, note, confirmation).
  - **Ledger**: `GET …/transactions` with filters `type`, `customerId`, `orderNumber`.
- **Customer detail**: a "Coins" tab from `GET /v1/admin/rewards/accounts/{customerId}` with the adjust action.
- **Order detail**: "Coins redeemed: 59 (− € 0.53), used" from `order.rewards`; `rewardAmount` per line if the lines table shows the discount per line.
- **Roles**: the permissions `rewards.read` and `rewards.manage` appear in the permissions list.

## 10. Deployment notes

- Run `npm run db:indexes` after deploying: it builds the indexes of `rewardAccounts` and `rewardTransactions`. Nothing of the old data changes.
- The program is **off** until the admin switches it on in the panel and sets the welcome and review coins. Balances are created on first use.
- No new environment variables. The welcome key uses `LINK_HMAC_SECRET`, which exists. No new emails.
- `POST /v1/jobs/run` (the external timer on Hostinger) now also runs the expiry; the API runs it daily by itself as well.
