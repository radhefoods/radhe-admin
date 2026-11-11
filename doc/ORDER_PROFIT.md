# Costs and profit of an order

Since 2026-11-11 the API works out what every order earned. Two calculations meet:

- **Model A, the price of a product.** Buying price, plus the fulfilment cost on it, plus the markup on both, plus VAT. This sets the selling price in the catalogue (`doc/SUPPLIER_IMPORT.md`).
- **Model B, the profit of an order.** What the customer paid without VAT, less what the goods cost (Model A, per pack and quantity), less what the order itself cost: delivery, packaging, the fee of the payment and other costs, and with what refunds changed.

Everything here is internal. No customer endpoint answers any of it, and the admin needs the permission `finance.read` to see it.

## The rules

1. **Without VAT.** VAT is collected for the tax office. It is neither revenue nor cost and is left out of every figure except where a row says "VAT included".
2. **Markup, not margin.** The price rule adds 35 % on top of the costs. The breakdown shows both what that is as a markup (profit in percent of the costs) and as a margin (profit in percent of the revenue).
3. **A snapshot per order.** When an order is placed, the API copies into it: the buying price of every pack, the price rule of its product (fulfilment, other expenses, markup, and whether the price followed the rule), and the costs of an order from the settings. The profit of an order is worked out from these only. Changing a buying price, a rule or a cost setting later changes the orders that follow and never an earlier one.
4. **The fee of the payment** is an estimate from the settings (a percentage of what the customer pays, plus an amount) until Stripe reports what it really took. The API asks Stripe when the money is captured, and again with the scheduled jobs for up to 14 days if Stripe had not booked the payment yet. From then on the real fee is used. Stripe keeps its fee when a payment is refunded, so it stays a cost.
5. **Refunds.** Two bills are compared: the order as the customer agreed to it (`ordered`), and as it ended after corrections by the admin, returns and a cancellation (`final`). The difference between the two profits is the refund adjustment.
6. **Costs follow the stock.** A unit that went back on the shelf was not spent: one the admin corrected away as not delivered, one that was returned and put back, and every unit of a cancelled order. A unit that came back and was **not** put back on the shelf is gone: its buying price stays a cost. A unit that was delivered and came back still cost its handling.
7. **Costs of the order itself** (delivery, packaging, other) count for every order that was not cancelled, and for a cancelled one only if it had left already.
8. **Goodwill.** Money given back beyond what the bill called for is a cost, VAT and all.
9. **An order that is not paid yet** shows what is expected, with `state: "not_paid"`.

## Settings: what one order costs

`GET /v1/admin/finance/settings` (`finance.read`) answers `{ settings }`. `PUT /v1/admin/finance/settings` (`finance.manage`) takes the whole document and answers `{ settings }`.

```json
{
  "deliveryCost": 450,
  "packagingCost": 80,
  "otherCost": 20,
  "paymentFee": { "percent": 1.5, "fixed": 25 }
}
```

| Field                | Meaning                                                             | Limits                |
| -------------------- | ------------------------------------------------------------------- | --------------------- |
| `deliveryCost`       | What it costs the shop to deliver one order. Cents without VAT.     | whole, 0 to 1,000,000 |
| `packagingCost`      | Box, filling and tape of one order. Cents without VAT.              | whole, 0 to 1,000,000 |
| `otherCost`          | Anything else that one order costs. Cents without VAT.              | whole, 0 to 1,000,000 |
| `paymentFee.percent` | The estimate of the payment fee: percent of what the customer pays. | 0 to 100, 2 decimals  |
| `paymentFee.fixed`   | The estimate of the payment fee: cents per payment.                 | whole, 0 to 10,000    |

Until the admin saves something, the three costs are 0 and the payment fee is 1.5 % + 0.25 €: Stripe's price in Germany for a standard card from the European Economic Area (stripe.com/de/pricing, November 2026). Premium cards cost 2.8 % + 0.25 €, cards from the United Kingdom 2.5 % + 0.25 €, cards from elsewhere 3.15 % + 0.25 €; PayPal has its own rates. The estimate is only used until the real fee of a payment is known.

A change counts for orders placed from then on. `400 VALIDATION_FAILED` when a field is missing or out of its limits.

The price rule of Model A (fulfilment, other expenses, markup, safety buffer) is not here: it is in `GET` / `PUT /v1/admin/supply/settings`, with overrides per category and product.

## The breakdown of an order

`GET /v1/admin/finance/orders/{id}/profit` (`finance.read`). `{id}` is the id of the order, as in `GET /v1/admin/orders/{id}`. `404 ORDER_NOT_FOUND`.

Amounts are cents. Buying prices and what follows from them have up to four decimals; what the customer pays is whole cents.

```json
{
  "orderId": "66f1…",
  "orderNumber": "RF-1084",
  "status": "delivered",
  "paymentStatus": "paid",
  "placedAt": "2026-11-11T09:00:00.000Z",
  "currency": "EUR",
  "state": "paid",
  "complete": true,
  "linesWithoutCost": 0,
  "costs": {
    "delivery": 450,
    "packaging": 80,
    "other": 20,
    "paymentFeePercent": 1.5,
    "paymentFeeFixed": 25
  },
  "lines": [
    {
      "productId": "66f3…",
      "variantId": "66f4…",
      "sku": "RF-00001",
      "name": {
        "en": "AliBaba Black Pepper Powder",
        "de": "AliBaba Schwarzer Pfeffer gemahlen"
      },
      "packSize": { "value": 100, "unit": "g" },
      "vatRate": 700,
      "vatPercent": 7,
      "unit": {
        "cost": 138,
        "rule": {
          "fulfilmentPercent": 10,
          "extraPercent": 0,
          "extraAmount": 0,
          "markupPercent": 35
        },
        "priceMode": "auto",
        "calculation": {
          "cost": 138,
          "fulfilment": 13.8,
          "extra": 0,
          "markup": 53.13,
          "net": 204.93,
          "vat": 14.3451,
          "price": 219
        },
        "price": 219,
        "regularPrice": null
      },
      "quantity": {
        "ordered": 2,
        "delivered": 2,
        "returned": 0,
        "restocked": 0,
        "kept": 2
      },
      "ordered": {
        "units": 2,
        "gross": 438,
        "discount": 0,
        "vat": 29,
        "netRevenue": 409,
        "costUnits": 2,
        "handledUnits": 2,
        "buyingCost": 276,
        "fulfilmentCost": 27.6,
        "extraCost": 0,
        "profit": 105.4,
        "marginPercent": 25.77,
        "markupPercent": 34.72
      },
      "final": { "…the same fields, for the units that were kept…": "" }
    }
  ],
  "ordered": {
    "revenue": {
      "products": 609,
      "delivery": 451,
      "vatRounding": 0,
      "total": 1060
    },
    "costs": {
      "buying": 410.75,
      "fulfilment": 41.075,
      "extra": 0,
      "delivery": 450,
      "packaging": 80,
      "paymentFee": 43,
      "other": 20,
      "goodwill": 0,
      "total": 1044.825
    },
    "netProfit": 15.175,
    "marginPercent": 1.43
  },
  "final": {
    "…the same fields, after corrections, returns and a cancellation…": ""
  },
  "summary": {
    "productRevenue": 609,
    "buyingCosts": 410.75,
    "fulfilmentCosts": 41.075,
    "extraCosts": 0,
    "deliveryRevenue": 451,
    "deliveryCost": 450,
    "packagingCost": 80,
    "paymentFee": 43,
    "otherCosts": 20,
    "profitAsOrdered": 15.175,
    "refundAdjustment": 0,
    "netProfit": 15.175,
    "marginPercent": 1.43
  },
  "refunds": { "revenue": 0, "costsRecovered": 0, "goodwill": 0, "profit": 0 },
  "paymentFee": {
    "amount": 43,
    "source": "actual",
    "estimate": 42.625,
    "actual": 43,
    "percent": 1.5,
    "fixed": 25,
    "reportedAt": "2026-11-11T09:01:10.000Z"
  },
  "customer": {
    "agreed": 1175,
    "paid": 1175,
    "refunded": 0,
    "kept": 1175,
    "bill": 1175,
    "vat": 115,
    "pendingRefund": 0
  }
}
```

### The whole answer

| Field              | Meaning                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`            | `paid`; `not_paid` (the figures are what is expected); `cancelled`.                                                                                                                   |
| `complete`         | False when a line has no buying price. The profit is then too high by that cost; `linesWithoutCost` says how many lines.                                                              |
| `costs`            | The costs of an order as they were when it was placed. `null` on orders from before they were kept: such orders count 0 for them.                                                     |
| `lines`            | Every pack size of the order. See below.                                                                                                                                              |
| `ordered`, `final` | The order as agreed, and as it ended. The same fields in both.                                                                                                                        |
| `summary`          | The table for the screen: the rows as ordered, then `refundAdjustment`, then `netProfit` and `marginPercent`. `profitAsOrdered + refundAdjustment = netProfit`.                       |
| `refunds`          | How the refunds changed the result: `revenue` that went back (0 or negative), `costsRecovered` (0 or positive), `goodwill`, and `profit`, their sum.                                  |
| `paymentFee`       | `amount` is the fee the figures use. `source`: `actual` once Stripe reported it, `estimate` until then, `none` without a payment.                                                     |
| `customer`         | What the customer agreed to, paid and got back, **VAT included**. `bill` is the final bill, `vat` the VAT in it, `pendingRefund` what is credited or cancelled and not paid back yet. |

### A line

| Field              | Meaning                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit.cost`        | The buying price of one pack when it was ordered. `null`: not known.                                                                                                                                                                                                                                                                                                        |
| `unit.rule`        | The price rule of the product when it was ordered.                                                                                                                                                                                                                                                                                                                          |
| `unit.priceMode`   | `auto`: the price followed the rule. `manual`: the admin set it.                                                                                                                                                                                                                                                                                                            |
| `unit.calculation` | Model A, step by step: `cost`, `fulfilment`, `extra`, `markup`, `net` (price before VAT), `vat`, `price` (what the rule gives). `null` without a buying price.                                                                                                                                                                                                              |
| `unit.price`       | What the customer was charged for one pack, VAT included. It differs from `calculation.price` when the price was set by hand or reduced; `regularPrice` is the crossed-out one.                                                                                                                                                                                             |
| `quantity`         | `ordered`, `delivered` (after corrections), `returned`, `restocked` (of the returned, those put back on the shelf), `kept`.                                                                                                                                                                                                                                                 |
| `ordered`, `final` | The line as agreed and as it ended: `units`, `gross` (paid, VAT included, after discounts), `discount`, `vat`, `netRevenue`, `costUnits` (units whose buying price is spent), `handledUnits` (units that were packed), `buyingCost`, `fulfilmentCost`, `extraCost`, `profit`, `marginPercent`, `markupPercent`. The costs and the profit are `null` without a buying price. |

### An order as a whole (`ordered`, `final`)

| Field                                              | Calculation                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `revenue.products`                                 | The sum of `netRevenue` of the lines: selling prices before VAT, after discounts.                 |
| `revenue.delivery`                                 | The delivery fee the customer pays, without its VAT.                                              |
| `revenue.vatRounding`                              | The invoice rounds VAT per VAT rate, the lines per line: the cent or two between them. Usually 0. |
| `revenue.total`                                    | The net total of the invoice (or of the final bill).                                              |
| `costs.buying`                                     | Buying price times the units that are not back on the shelf.                                      |
| `costs.fulfilment`                                 | The fulfilment percentage of the buying price, times the units that were packed.                  |
| `costs.extra`                                      | The other expenses of the price rule, times the units that were packed.                           |
| `costs.delivery`, `costs.packaging`, `costs.other` | From the settings as they were when the order was placed.                                         |
| `costs.paymentFee`                                 | The real fee, or the estimate until it is known.                                                  |
| `costs.goodwill`                                   | Money given back beyond the bill. Only in `final`.                                                |
| `netProfit`                                        | `revenue.total` less `costs.total`.                                                               |
| `marginPercent`                                    | `netProfit` in percent of `revenue.total`. `null` without revenue.                                |

## What happens when

| Event                                                         | Revenue                      | Buying cost of the units | Other costs                                           |
| ------------------------------------------------------------- | ---------------------------- | ------------------------ | ----------------------------------------------------- |
| The admin corrects a quantity down (missing, damaged, …)      | falls by the units           | not spent                | handling of those units not counted                   |
| A return is completed and the goods are put back on the shelf | falls by the units           | not spent                | handling stays; delivery, packaging, fee stay         |
| A return is completed and the goods are **not** put back      | falls by the units           | stays a cost             | handling stays; delivery, packaging, fee stay         |
| Everything is returned                                        | falls to 0, delivery fee too | as above, per unit       | delivery, packaging, other and the fee stay           |
| A paid order is cancelled before it left                      | 0                            | not spent                | only the fee of the payment stays                     |
| A paid order is cancelled after it left                       | 0                            | not spent                | handling, delivery, packaging, other and the fee stay |
| The admin refunds more than the bill calls for                | unchanged                    | unchanged                | the difference is `goodwill`                          |

A correction of a quantity puts the units back on the shelf whatever its reason, also when the reason is "damaged". The profit follows the stock, so such a unit counts as not spent. If damaged goods are thrown away, take them off the stock by hand; the order's profit will not show that loss.

## Where the figures are kept

- On every order item: `unitCost` (the buying price) and `costing` (`fulfilmentPercent`, `extraPercent`, `extraAmount`, `markupPercent`, `priceMode`).
- On the order: `costs` (`delivery`, `packaging`, `other`, `paymentFeePercent`, `paymentFeeFixed`), and `payment.feeAmount` with `payment.feeAt` once Stripe reported the fee.
- In the settings: the key `order_costs`.

None of these fields is part of any answer about an order, neither to the customer nor to the admin: only the breakdown above shows them.

## Permissions

Two new permissions: `finance.read` (the settings and the breakdown) and `finance.manage` (changing the settings). The role that holds everything holds them already; other roles get them in the roles screen. `GET /v1/admin/roles/permissions` lists them.

## Screens for the admin panel

1. **Settings → Order costs** (`finance.read` to see, `finance.manage` to save). Four inputs: delivery cost per order, packaging cost per order, other costs per order (euros with two decimals, sent as whole cents), and the estimated payment fee (percent with up to two decimals, and an amount in euros sent as cents). Say under the form: "Counts for orders placed from now on. Earlier orders keep the costs they were placed with." and "The payment fee is an estimate; the real fee of each payment replaces it once Stripe reports it." A line with the example helps: "An order of 50.00 € would cost 0.75 € + 0.25 € = 1.00 € in fees."
2. **Order page → "Cost & profit"**, a section shown only with `finance.read`, loaded from the breakdown when the order page opens and again after any correction, return, cancellation or refund.
   - **A table of the products**, one row per line: name and pack size, quantity (`quantity.ordered`; when `kept` differs, "2 ordered, 1 kept"), buying price per pack, selling price per pack, discount, revenue without VAT, buying cost, fulfilment cost, profit, margin. Show the `final` figures; when `ordered` differs from `final`, show the ordered value crossed out next to it.
   - **A row opens to the calculation of one pack** (`unit.calculation`): supplier buying price, fulfilment cost with its percentage, cost after fulfilment, markup with its percentage, selling price before VAT, VAT with its percentage, final customer price. Use the labels of the owner's table. When `unit.price` differs from `calculation.price`, add "charged: 1.99 € (price set by hand)" or "(reduced)".
   - **The summary of the order** from `summary`, in this order: total product revenue; total buying costs; total fulfilment costs; other product costs (only if not 0); delivery revenue; delivery cost; packaging cost; payment fee with a badge "actual" or "estimate" from `paymentFee.source`; other operational costs; profit as ordered; refund adjustments; **net profit**; **profit margin**. Costs are shown as negative amounts, the net profit in green or red.
   - **Refunds**, when `refunds.profit` is not 0: revenue given back, costs recovered, goodwill.
   - **What the customer paid** from `customer`: agreed, paid, refunded, kept, of which VAT, and "still to refund" when `pendingRefund` is above 0.
   - **Notes**: `complete: false` → "The buying price of N product(s) is not known: the profit shown is too high."; `state: "not_paid"` → "Not paid yet: these figures are what is expected."; `costs: null` → "Placed before order costs were recorded.".
3. **Roles screen**: labels for `finance.read` ("See costs and profit") and `finance.manage` ("Change order costs").

Money is cents: divide by 100 and show two decimals in the tables, up to four in the calculation of one pack (the owner's example shows 0.143451 € of VAT; the API gives four decimals of a cent). Never round and add again in the panel: every total comes from the API.
