# Prompt for the admin panel agent: order costs and the "Cost & profit" breakdown

Copy everything below the line into the agent that works on the admin panel (`radhe-admin`).

---

You are working on the Radhe Foods admin panel (`radhe-admin`, Next.js). The API now works out what every order earned: the price of each product from its buying price (10 % fulfilment, 35 % markup, VAT), and the profit of the order after delivery, packaging, the fee of the payment and other costs, with what refunds changed. Build the two screens for it.

**Read first:** `doc/ORDER_PROFIT.md` in the `radhe-api` repository (the sibling folder `../radhe-api`), all of it, and section 32 of `doc/ADMIN_API_DOCUMENTATION.md` there. They hold the complete contract. This prompt repeats what you need most; where the two differ, the documents are right. If you cannot read that repository, ask for the files. All calls use the existing admin session and API client.

**Do not change the theme, colours, fonts, typography or any unrelated functionality.** Reuse the panel's cards, tables, badges, form fields, toasts and money formatting.

## The API

| Call                                       | Permission       | Answers                    |
| ------------------------------------------ | ---------------- | -------------------------- |
| `GET /v1/admin/finance/settings`           | `finance.read`   | `{ settings }`             |
| `PUT /v1/admin/finance/settings`           | `finance.manage` | `{ settings }`             |
| `GET /v1/admin/finance/orders/{id}/profit` | `finance.read`   | the breakdown of the order |

The settings, as sent and answered (cents without VAT; the whole document on `PUT`):

```json
{
  "deliveryCost": 450,
  "packagingCost": 80,
  "otherCost": 20,
  "paymentFee": { "percent": 1.5, "fixed": 25 }
}
```

Limits: the three costs are whole cents from 0 to 1,000,000; `paymentFee.percent` is 0 to 100 with at most two decimals; `paymentFee.fixed` is whole cents from 0 to 10,000. `400 VALIDATION_FAILED` otherwise.

The breakdown is described field by field in `doc/ORDER_PROFIT.md` ("The breakdown of an order"), with a full example. In short:

- Amounts are **cents**; everything is **without VAT** except the block `customer` and the fields `gross`, `vat`, `unit.price`. Buying prices and what follows from them have up to four decimals.
- `lines[]`: one entry per pack size. `unit` is one pack (buying price, price rule, the steps of the calculation, the price charged). `quantity` has ordered, delivered, returned, restocked, kept. `ordered` is the line as the customer ordered it, `final` as it ended after corrections, returns and a cancellation.
- `summary`: the rows for the summary table. `profitAsOrdered + refundAdjustment = netProfit`.
- `paymentFee.source`: `actual` once Stripe reported the fee, `estimate` until then, `none` without a payment.
- `complete: false`: a line has no buying price; the profit shown is too high.
- `state`: `paid`, `not_paid` (the figures are what is expected) or `cancelled`.

Two new permissions exist: `finance.read` and `finance.manage`. The role that holds everything holds them already.

## Where to change the panel

| File or place                                                     | Change                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/api/types/` (new `finance.ts`, exported from `index.ts`) | Types of the settings and of the breakdown, taken from the example in `doc/ORDER_PROFIT.md`.                                         |
| `src/lib/api/endpoints/` (new `finance.ts`)                       | The three calls.                                                                                                                     |
| The permission list and the roles matrix                          | Add `finance.read` ("See costs and profit") and `finance.manage` ("Change order costs") with their labels.                           |
| `src/app/(panel)/settings/(shop)/` (new page "Order costs")       | The settings form, next to "Delivery fee". Add it to the navigation of the settings, shown only with `finance.read`.                 |
| `src/app/(panel)/orders/[id]/` and `src/features/orders/`         | A new section "Cost & profit" on the order page, shown only with `finance.read`.                                                     |
| `mocks/`                                                          | The mock API: the settings, and a breakdown computed for the mock orders (it may be simpler than the real one, with the same shape). |
| Tests of the settings and the order page                          | The new form and the new section.                                                                                                    |

## Step 1: Settings → Order costs

1. Four inputs: **Delivery cost per order**, **Packaging cost per order**, **Other costs per order** (euros with two decimals; send whole cents), and **Estimated payment fee**: a percentage (up to two decimals) and an amount in euros (send cents).
2. Under the form, two sentences: "Counts for orders placed from now on. Earlier orders keep the costs they were placed with." and "The payment fee is an estimate. The real fee of each payment replaces it once Stripe reports it."
3. A live example that follows the inputs: "An order of 50.00 € would cost 0.75 € + 0.25 € = 1.00 € in payment fees."
4. Without `finance.manage` the form is read-only.
5. Do **not** put the price rule here (fulfilment, markup, safety buffer): that is the page "Pricing & supplier" of the other prompt (`GET` / `PUT /v1/admin/supply/settings`). Link the two pages to each other with one line: "Product prices are calculated on the page Pricing & supplier."

## Step 2: Order page → "Cost & profit"

Load the breakdown when the order page opens, and again after anything that changes the order: a correction of a quantity, a return, a cancellation, a refund, a status change. Show the section only with `finance.read`; do not call the endpoint without it.

1. **Products**, a table with one row per entry of `lines`:
   - product name and pack size, article number;
   - quantity: `quantity.ordered`, and when `kept` differs, "2 ordered, 1 kept";
   - buying price per pack (`unit.cost`), selling price per pack (`unit.price`);
   - discount, revenue without VAT, buying cost, fulfilment cost, profit, margin, from `final`;
   - when a figure of `ordered` differs from `final`, show the ordered one crossed out next to it.
   - A row without a buying price shows "–" for the costs and the profit, and a hint "buying price not known".
2. **A row opens to the calculation of one pack** from `unit.calculation`, with the owner's labels:

   | Label                        | Field                                            |
   | ---------------------------- | ------------------------------------------------ |
   | Supplier buying price        | `cost`                                           |
   | Fulfilment cost (10 %)       | `fulfilment`, with `unit.rule.fulfilmentPercent` |
   | Cost after fulfilment        | `cost + fulfilment + extra`                      |
   | Markup (35 %)                | `markup`, with `unit.rule.markupPercent`         |
   | Selling price before VAT     | `net`                                            |
   | VAT (7 %)                    | `vat`, with `vatPercent`                         |
   | Final customer selling price | `price`                                          |

   Show "Other expenses" (`extra`) as a row of its own only when it is not 0. When `unit.price` differs from `calculation.price`, add "Charged: 1.99 €" with "price set by hand" (`priceMode: "manual"`) or "reduced" (`regularPrice` is set).

3. **Order summary**, from `summary`, in this order:

   | Label                    | Field                                                                      |
   | ------------------------ | -------------------------------------------------------------------------- |
   | Total product revenue    | `productRevenue`                                                           |
   | Total buying costs       | `buyingCosts`                                                              |
   | Total fulfilment costs   | `fulfilmentCosts`                                                          |
   | Other product costs      | `extraCosts` (only when not 0)                                             |
   | Delivery revenue         | `deliveryRevenue`                                                          |
   | Delivery cost            | `deliveryCost`                                                             |
   | Packaging cost           | `packagingCost`                                                            |
   | Stripe processing fee    | `paymentFee`, with a badge "actual" or "estimate" from `paymentFee.source` |
   | Other operational costs  | `otherCosts`                                                               |
   | Profit as ordered        | `profitAsOrdered`                                                          |
   | Refund adjustments       | `refundAdjustment` (only when not 0)                                       |
   | **Final net profit**     | `netProfit`                                                                |
   | **Actual profit margin** | `marginPercent`                                                            |

   Revenue rows as positive amounts, cost rows as negative ones, the net profit green when positive and red when negative. Under the table: "All amounts without VAT."

4. **Refunds**, only when `refunds.profit` is not 0: "Revenue given back" (`refunds.revenue`), "Costs recovered" (`refunds.costsRecovered`), "Goodwill" (`refunds.goodwill`, only when not 0).
5. **What the customer paid**, from `customer`, VAT included: agreed, paid, refunded, kept, "of which VAT" (`vat`), and "Still to refund" when `pendingRefund` is above 0.
6. **Notes** above the tables:
   - `complete: false` → "The buying price of N product(s) is not known: the profit shown is too high."
   - `state: "not_paid"` → "Not paid yet: these figures are what is expected."
   - `state: "cancelled"` → "Cancelled: only what the order still cost is shown."
   - `costs: null` → "Placed before order costs were recorded."
   - `paymentFee.source: "estimate"` → "The payment fee is an estimate until Stripe reports it."

Money is cents: divide by 100. Two decimals in the tables; up to four in the calculation of one pack, where the steps are fractions of a cent. **Never add figures up in the panel**: every total comes from the API, and adding rounded figures gives other totals.

## How to work

Write your plan first and wait for my go before coding. Then do step 1, run the panel's lint, type check and tests, and report. Wait for my go, then do step 2 the same way.
