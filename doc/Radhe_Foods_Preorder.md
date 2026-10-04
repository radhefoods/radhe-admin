# Radhe Foods Pre-Order, Cargo, Delivery & Post-Delivery Payment System

## 1. Project Overview

Radhe Foods will operate a **pre-order based sales system in Germany** where customers can place a binding order in advance, see the complete product pricing and tax information at checkout, but **do not make the payment at the time of ordering**.

The system is built around recurring **cargo / delivery cycles**.

Customers place orders during an active pre-order window. Every order placed during that window is automatically assigned to the currently active cargo. After the ordering window closes, a new cargo can immediately become active for new orders, while the previous cargo continues through transit, arrival, delivery, and payment collection.

The key business flow is:

**Available SKUs → Active Pre-Order Cargo → Customer Reviews Full Bill → Confirm Order → Cargo Closes → Delivery → Bulk Payment Activation → Automatic Payment Reminders → Paid → Cargo Completed**

The most important business rule is:

> **The customer sees and agrees to the full order price at checkout, but payment is collected only after the order has been delivered.**

---

# 2. Core Business Concept

The system should separate three things clearly:

## 2.1 SKU Catalogue

The SKU catalogue is permanent.

Products are created once and managed independently from cargo.

Each SKU contains its selling price and relevant tax/VAT information.

Examples:

- Kesar Mango
- Alphonso Mango
- Banana Chips
- Rice
- Flour
- Snacks
- Spices
- Fruits
- Other Radhe Foods products

A product does **not** need to be recreated for every cargo.

---

## 2.2 Cargo / Pre-Order Cycle

A cargo is an operational ordering and delivery cycle.

The cargo controls:

- when customers can place orders,
- which cargo receives new orders,
- the ordering deadline,
- the estimated delivery date/window,
- the operational status,
- when payment is activated after delivery,
- the payment deadline,
- reminder timing,
- whether all payments are complete.

The cargo does **not** own a separate duplicate product catalogue.

---

## 2.3 Customer Order

Every order belongs to:

- one customer,
- one cargo,
- one or more SKUs,
- one agreed order total,
- one delivery status,
- one payment status.

The customer does not need to manually select a cargo.

The system automatically assigns the order to whichever cargo is currently accepting orders.

---

# 3. Main System Principle

The architecture should follow this rule:

> **Products are permanent. Cargo cycles change. Orders always belong to the active ordering cargo at the time they are placed.**

For example:

### Cargo 21
Status: Delivering  
Delivery window: 23–25 September

### Cargo 22
Status: Taking Orders  
Order deadline: 26 September  
Delivery window: 5–7 October

### Cargo 23
Status: Scheduled  
Ordering starts: 27 September  
Delivery window: 12–15 October

This means several cargos can exist at the same time, but only one cargo should normally be accepting new customer orders.

---

# 4. SKU Management

The admin panel should contain a dedicated **SKU Management** section.

A SKU is created once and reused across all future cargo cycles.

Recommended SKU fields:

- Product ID
- SKU code
- Product name
- Category
- Description
- Product image
- Pack size
- Unit
- Selling price
- VAT/tax rate
- Product status
- Availability status
- Search keywords
- SEO information
- Created date
- Updated date

Example:

| SKU | Product | Category | Selling Price | VAT | Available |
|---|---|---|---:|---:|---|
| RF001 | Kesar Mango | Fruits | €24.99 | configured | ON |
| RF002 | Banana Chips | Snacks | €3.99 | configured | ON |
| RF003 | Rice 5 kg | Rice | €14.99 | configured | ON |
| RF004 | Guava | Fruits | €8.99 | configured | OFF |

## 4.1 Product Active vs Product Available

These should be two separate settings.

### Product Active

Controls whether the product exists as part of the Radhe Foods catalogue.

### Available for Ordering

Controls whether the customer can currently order the product.

Example:

Kesar Mango may remain a valid Radhe Foods product, but if it is temporarily unavailable, the admin can switch:

**Available for Ordering: OFF**

without deleting the product.

---

# 5. Categories

Products should be grouped into categories.

Examples:

- Fruits
- Snacks
- Rice
- Pulses
- Flour
- Spices
- Beverages
- Frozen
- Grocery
- Ingredients
- Other

Admin should be able to:

- create a category,
- edit a category,
- hide a category,
- reorder categories,
- assign SKUs to categories.

---

# 6. Cargo / Pre-Order Cycle Management

The **Cargo Management** section is the operational heart of the system.

Each cargo should contain:

- Cargo ID
- Internal cargo name
- Customer-facing pre-order cycle name
- Order opening date/time
- Order closing date/time
- Estimated delivery start date
- Estimated delivery end date
- Cargo status
- Payment status
- Payment activation date
- Payment due date
- Reminder configuration
- Internal notes
- Customer-facing message
- Number of orders
- Number of customers
- Total order value
- Total delivered value
- Total paid
- Outstanding balance

Example:

## Cargo RF-C027

Order window:  
24 September 2026 → 26 September 2026

Estimated delivery:  
5 October 2026 → 7 October 2026

Status:  
**Taking Orders**

Orders: 117

Customers: 94

Booked value: €6,850

---

# 7. Only One Active Ordering Cargo

Normally, only one cargo should have:

**Status = Taking Orders**

When the customer places an order, the backend automatically finds the current active ordering cargo and assigns the order to it.

Example:

```text
Current active cargo:
RF-C027

Customer confirms order:
Order RF-1084

System automatically saves:
cargo_id = RF-C027
```

The customer never needs to manually choose a cargo.

---

# 8. Cargo Rollover

Cargo cycles should support continuous ordering.

Example:

## Cargo 27

Ordering:
24–26 September

Estimated delivery:
5–7 October

At 26 September, 23:59:

Cargo 27 automatically changes from:

**Taking Orders → Orders Closed**

Then Cargo 28 can automatically become:

**Taking Orders**

Example:

## Cargo 28

Ordering:
27–30 September

Estimated delivery:
12–15 October

This allows Radhe Foods to continuously accept orders even while previous cargos are still in transit or being delivered.

---

# 9. Automatic and Manual Cargo Activation

The system should support both.

## Automatic Mode

Admin creates upcoming cargos in advance.

Example:

Cargo 27 closes:
26 September at 23:59

Cargo 28 opens:
27 September at 00:00

The system switches automatically.

## Manual Mode

Admin can manually click:

**Close Cargo 27 & Activate Cargo 28**

This is useful during the early stage of the business.

---

# 10. Cargo Statuses

Recommended cargo statuses:

1. **Draft**  
   Cargo is being prepared internally.

2. **Scheduled**  
   Future cargo is configured but ordering has not started.

3. **Taking Orders**  
   Customers can currently place orders.

4. **Orders Closed**  
   No new orders can enter this cargo.

5. **In Transit**  
   Cargo has been dispatched / is travelling.

6. **Arrived**  
   Cargo has reached Radhe Foods.

7. **Delivering**  
   Customer deliveries are in progress.

8. **Delivered**  
   Delivery stage for the cargo is complete.

9. **Payment Active**  
   Post-delivery payment has been activated.

10. **Payment Remaining**  
    One or more customers still have unpaid balances.

11. **Completed**  
    All required payments are settled.

12. **Cancelled**  
    Cargo/cycle was cancelled.

Normal flow:

**Draft → Scheduled → Taking Orders → Orders Closed → In Transit → Arrived → Delivering → Delivered → Payment Active → Payment Remaining → Completed**

---

# 11. Multiple Cargo States at the Same Time

The system must support multiple cargos at different stages.

Example:

### Cargo 21
**Delivering**

### Cargo 22
**Taking Orders**

### Cargo 23
**Scheduled**

This is essential.

A previous cargo may still be going through delivery or payment while a new cargo is already collecting orders.

---

# 12. Customer-Facing Delivery Promise

The cargo determines the delivery promise shown to the customer.

Example:

Cargo 27:

Order deadline:
26 September

Estimated delivery:
5–7 October

Website message:

> **Order within the next 2 days and receive your order approximately 5–7 October.**

When Cargo 27 closes and Cargo 28 becomes active:

> **Order now and receive your order approximately 12–15 October.**

The products and SKU prices stay controlled by the SKU catalogue.

Only the active cargo and delivery promise change.

---

# 13. Dynamic Countdown

The website should automatically display the remaining ordering time.

Example:

> **Next Radhe Foods Delivery**
>
> Order within:
> **1 day 18 hours**
>
> Estimated delivery:
> **5–7 October**
>
> **Pre-Order Now**

This data should come directly from the active cargo.

---

# 14. Customer-Facing Terminology

Internally, Radhe Foods can use the word **Cargo**.

Customer-facing language should be simpler.

Recommended wording:

- Current Pre-Order
- Next Delivery
- Pre-Order Window
- Upcoming Delivery
- Order Deadline
- Estimated Delivery

Example:

> **Next Radhe Foods Delivery**
>
> Order by 26 September  
> Estimated delivery: 5–7 October

The customer does not need to understand internal cargo operations.

---

# 15. Product Pricing

Every SKU is uploaded with its own selling price and applicable VAT/tax information.

Example:

```text
SKU: RF-FRU-001
Product: Kesar Mango
Pack Size: 3 kg
Selling Price: €24.99
VAT: configured
Available: ON
```

The same SKU price is used on:

- Product page
- Cart
- Checkout
- Order confirmation
- Order history
- Payment request

If the SKU price changes later, existing orders must keep the original agreed price.

---

# 16. Cart and Checkout Pricing

The customer should always see the full bill before confirming the pre-order.

Example:

## Your Pre-Order

| Item | Qty | Unit Price | Total |
|---|---:|---:|---:|
| Kesar Mango Box | 2 | €24.99 | €49.98 |
| Banana Chips | 3 | €3.99 | €11.97 |

Subtotal: €57.90  
VAT/Tax: €4.05  
Delivery: €0.00  
**Total Order Value: €61.95**

Estimated Delivery:
**5–7 October**

### Payment Now:
**No payment is collected at checkout**

The important distinction is:

> **The customer agrees to the full order value now, but pays later after delivery.**

---

# 17. Checkout Confirmation

Instead of taking payment, the customer confirms the order.

Recommended customer-facing concept:

**Review Order → Accept Terms → Confirm Pre-Order**

The checkout should clearly state:

> **Your order total is €61.95. No payment will be collected now. After successful delivery, Radhe Foods will activate payment and send you a secure payment request for the amount due.**

If the final checkout action creates a binding purchase obligation, the exact button wording and legal presentation should be reviewed for German consumer-law compliance before launch.

---

# 18. Order Creation

When a customer confirms an order:

1. Validate that a cargo is currently accepting orders.
2. Validate that each SKU is currently available.
3. Read the current SKU selling price.
4. Calculate line totals.
5. Calculate VAT/tax.
6. Calculate delivery charges if applicable.
7. Calculate the final order total.
8. Save the current product price into the order item.
9. Assign the active cargo.
10. Save the current delivery promise.
11. Save the agreed order total.
12. Create the order.
13. Send pre-order confirmation.
14. Do not initiate payment.

Example:

```text
Order RF-1084

Customer:
Max Müller

Cargo:
RF-C027

Items:
2 × Kesar Mango
3 × Banana Chips
1 × Rice 5 kg

Subtotal:
€54.62

VAT/Tax:
€3.88

Delivery:
€0.00

Order Total:
€58.50

Payment Status:
Not Enabled

Estimated Delivery:
5–7 October
```

---

# 19. Price Snapshot

Every order item must save the price at the moment the order is confirmed.

Example:

Mango price on 24 September:
€20

Customer confirms order:
€20

Mango price later changes:
€25

The existing order must remain:
€20

Recommended field:

```text
order_items.price_snapshot
```

This avoids price disputes and preserves historical accuracy.

---

# 20. Tax Snapshot

The applicable tax/VAT information used when the order is confirmed should also be stored with the order/order item.

Recommended fields:

```text
vat_rate_snapshot
vat_amount_snapshot
```

This keeps historical orders consistent even if product tax configuration changes later.

---

# 21. Delivery Window Snapshot

The system should also save the delivery promise shown at order time.

Example:

Cargo delivery originally:
5–7 October

Customer confirms order.

Later the cargo is delayed.

The original promise should remain historically recorded.

Recommended order fields:

```text
promised_delivery_start
promised_delivery_end
```

Cargo may later contain:

```text
current_delivery_start
current_delivery_end
```

This makes it possible to track original vs updated delivery dates.

---

# 22. Order Confirmation

After the customer confirms the pre-order, the confirmation should show the complete agreed bill.

Example:

## Order RF-1084 Confirmed

Order Total:
**€58.50**

Payment collected now:
**€0.00**

Payment status:
**Not yet enabled**

Estimated delivery:
**5–7 October**

The customer should also receive the same information by email.

---

# 23. Cargo Delay Management

If cargo is delayed, admin should be able to change the expected delivery dates.

Example:

Original:
5–7 October

Updated:
8–10 October

The system should ask:

> Notify affected customers?

If yes:

- send email,
- optionally send WhatsApp,
- update customer order tracking,
- retain original promised dates for audit/history.

---

# 24. Order Status vs Payment Status

These must be separate.

## Order Status

Recommended values:

- Pre-Order Received
- Confirmed
- Preparing
- Out for Delivery
- Delivered
- Delivery Failed
- Cancelled

## Payment Status

Recommended values:

- Not Enabled
- Payment Due
- Paid
- Overdue
- Waived
- Refunded
- Failed

This separation is important because:

**Delivered ≠ Paid**

---

# 25. Delivery Process

Orders within a cargo are delivered to customers.

The admin should be able to see:

- total orders,
- delivered orders,
- pending deliveries,
- failed deliveries,
- cancelled orders.

Example:

## Cargo 27 Delivery Progress

118 total orders

115 delivered

2 delivery failed

1 cancelled

---

# 26. Final Delivered Amount

Normally, the amount due after delivery should equal the amount the customer agreed to at checkout.

However, if the actual delivered quantity is lower or the order changes, the system should support a final adjusted delivered amount.

Example:

Customer originally ordered:

4 × Mango  
3 × Snacks

Actually delivered:

3 × Mango  
3 × Snacks

The final payment should reflect only what was actually delivered.

Any adjustment should be clearly recorded so the customer can see:

- Original order value
- Adjustment
- Final payable amount

---

# 27. Bulk Payment Activation at Cargo Level

Payment should **not** be activated manually order by order.

When Radhe Foods finishes deliveries for a cargo, admin opens that cargo and clicks:

## Activate Payment

Example:

Cargo RF-C027

Delivered eligible orders:
118

Cancelled orders:
2

Total amount to collect:
€5,842.60

Admin selects:

- Payment opening date/time
- Payment deadline
- First reminder timing
- Final reminder timing
- Notification channels

Then clicks:

**Activate & Notify 118 Customers**

---

# 28. Payment Happens After Delivery

The customer already knows the order value from checkout.

After delivery, payment becomes active.

Main flow:

**Review Full Price → Confirm Pre-Order → Delivery → Payment Activation → Payment**

The customer does not discover the price only after delivery.

The price is agreed in advance.

---

# 29. Individual Payment Record per Order

Even though payment is activated for the whole cargo at once, every customer/order must have an individual payment record.

Example:

Cargo 27 payment opens for 80 customers.

Customer A:
€32.00

Customer B:
€87.50

Customer C:
€14.99

Each receives their own secure payment request.

Cargo controls:

**when payment is opened**

Order/payment record controls:

**how much this customer owes and whether they have paid**

---

# 30. Payment Provider

Stripe can be used for online payment.

Preferred model:

- create a unique payment session/request for the individual order,
- associate the Radhe Foods order ID with the payment,
- redirect customer to secure Stripe Checkout,
- receive a payment confirmation webhook,
- update payment status automatically.

---

# 31. Payment Screen

Customer order page could show:

## Order RF-1084

Status:
**Delivered**

Original Order Total:
**€58.50**

Adjustment:
**€0.00**

Amount Due:
**€58.50**

Payment deadline:
**Friday, 23:59**

Button:

**Pay €58.50**

After payment:

Status automatically changes to:

**Paid**

---

# 32. Payment Deadline

Admin can define a payment period when activating cargo payment.

Example:

Payment activated:
Tuesday 20:00

Payment deadline:
Friday 23:59

This deadline applies to eligible unpaid orders in that cargo.

---

# 33. Automatic Payment Reminders

A scheduled background job / cron should automatically check unpaid orders.

Example schedule:

### Tuesday 20:00
Payment opens.

118 customers receive initial payment notification.

### Wednesday 20:00
System checks payment status.

Customers already paid:
No message.

Customers unpaid:
Reminder 1.

### Friday Morning
System checks again.

Only unpaid customers receive:

> Your Radhe Foods payment is due today.

### Friday 23:59
Still unpaid orders become:

**Overdue**

---

# 34. Reminder Safety Rule

Immediately before sending any reminder, the system must check:

```text
payment_status != PAID
```

This avoids sending payment reminders to customers who have already paid.

---

# 35. Cargo Payment Remaining Status

When payment is active:

If all customers pay:

**Cargo → Completed**

If one or more customers remain unpaid:

**Cargo → Payment Remaining**

Example:

Cargo 27

82 customers

81 paid

1 unpaid

Collected:
€5,803.70

Outstanding:
€38.90

Cargo status:
**Payment Remaining**

---

# 36. Automatic Cargo Completion

When the final required payment arrives, no manual admin action should be needed.

System automatically changes:

**Payment Remaining → Completed**

---

# 37. Customer Database

Each customer should have a central profile.

Recommended fields:

- Customer ID
- Name
- Email
- Phone
- WhatsApp phone
- Address
- Customer type
- Company name
- VAT details where relevant
- Total orders
- Total spend
- Outstanding amount
- Last cargo
- Last order
- Payment history
- Account status
- Created date
- Last activity

---

# 38. Customer Types

Recommended:

- Private Customer
- Business Customer

This allows future support for:

- different invoice requirements,
- B2B pricing,
- company details,
- VAT information,
- business-specific payment logic.

---

# 39. Customer Account Status

Recommended values:

- Normal
- Payment Outstanding
- Overdue
- Blocked
- Trusted / VIP

Example rule:

If a customer has a significantly overdue unpaid order, the system may prevent a new pre-order.

Admin should have an override option.

---

# 40. Guest Ordering / Account Strategy

For the first version, forced account registration is not necessary.

Customer can order using:

- Name
- Email
- Phone
- WhatsApp number
- Delivery address

After ordering, customer receives a secure order link.

The secure page can show:

- order details,
- item prices,
- VAT/tax,
- agreed order total,
- estimated delivery,
- updated delivery status,
- payment status,
- Pay Now button after payment activation.

---

# 41. Pre-Order Checkout

The checkout should make the payment model extremely clear.

Recommended summary:

## Your Pre-Order

Products:
€57.90

VAT/Tax:
€4.05

Delivery:
€0.00

### Total Order Value:
**€61.95**

Estimated Delivery:
5–7 October

### Pay Now:
**No payment is collected at checkout**

Then display prominently:

> **You are confirming an order with a total value of €61.95. No payment is collected now. After successful delivery, Radhe Foods will activate payment and send you a secure payment request.**

---

# 42. Pre-Order Terms and Privacy

The payment obligation should not simply be buried inside the Privacy Policy.

Use separate documents/acknowledgments:

## Pre-Order & Payment Terms

Covers:

- binding pre-order nature,
- agreed order price,
- payment after delivery,
- payment deadline,
- final delivered quantity adjustments,
- changes/cancellations where applicable,
- delivery estimate,
- delay handling,
- payment reminder process,
- consequences of overdue payment.

## Privacy Policy

Covers:

- personal data processing,
- order data,
- customer communication,
- payment-provider data,
- retention,
- customer privacy rights,
- other applicable privacy information.

---

# 43. Checkout Agreement

Recommended acknowledgment:

> ☐ I agree to the Radhe Foods Terms & Conditions and Pre-Order & Payment Terms. I understand the total price of my order and that no payment is collected now. After delivery, payment will become due and I must pay the final amount within the stated payment deadline.

Privacy acknowledgment:

> ☐ I confirm that I have read the Privacy Policy.

The exact legal wording and checkbox behaviour should be reviewed before launch for compliance with German and EU consumer/privacy law.

---

# 44. Legal Audit Trail

For every order, save which terms, prices, taxes and delivery information were presented and accepted.

Recommended fields:

```text
terms_version
terms_accepted_at

privacy_version
privacy_acknowledged_at

checkout_language

subtotal_snapshot
vat_total_snapshot
delivery_fee_snapshot
order_total_snapshot

cargo_id

promised_delivery_start
promised_delivery_end
```

This creates a clear record of:

- what the customer ordered,
- which prices were shown,
- which tax/VAT applied,
- the agreed order total,
- the delivery promise,
- which terms applied,
- when the order was confirmed.

---

# 45. Germany / EU Legal Review

Before launch, Radhe Foods should obtain appropriate legal review for:

- Terms & Conditions / AGB
- Pre-Order Terms
- Payment-after-delivery wording
- Checkout confirmation/button wording
- Consumer cancellation / withdrawal rights
- Price display
- VAT/tax display
- Delivery estimates
- Data protection / GDPR
- Privacy Policy
- Cookie handling
- Invoice requirements
- B2C and B2B differences
- Reminder / overdue payment process
- WhatsApp service-message permissions where applicable

---

# 46. Notifications

The system should support transactional notifications.

Recommended channels:

## Email

Use for:

- Pre-order confirmation with full bill
- Delivery-date change
- Order dispatched / out for delivery
- Delivered confirmation
- Payment request
- Payment reminder
- Final payment reminder
- Payment confirmation

## WhatsApp

Optional but valuable for:

- Pre-order confirmation
- Delivery update
- Payment request
- Payment reminder
- Payment confirmation

---

# 47. Notification Logging

Every notification should be logged.

Recommended fields:

```text
notification_id
customer_id
order_id
cargo_id
channel
message_type
sent_at
delivery_status
error_message
retry_count
```

---

# 48. Failed Notification Handling

If an email or WhatsApp message fails:

Admin should see:

**Notification Failed**

and have:

**Retry**

The customer should always be able to access payment from their secure order page once payment is active.

---

# 49. Admin Dashboard

The dashboard should focus on the operating cycle.

Recommended sections:

## Current Delivery

Cargo 21  
Status: Delivering  
78 / 82 delivered

## Current Pre-Order

Cargo 22  
Status: Taking Orders  
Orders close in: 1d 7h  
47 orders  
€3,820 booked  
Delivery: 5–7 October

## Next Pre-Order

Cargo 23  
Status: Scheduled  
Starts: 27 September  
Delivery: 12–15 October

## Outstanding Payments

Cargo 20  
81 / 82 paid  
Outstanding: €38.90

---

# 50. Cargo Dashboard

Each cargo should have its own detail screen.

Example:

# Cargo RF-C027

Status:
**Taking Orders**

Order Window:
24–26 September

Delivery:
5–7 October

Orders:
117

Customers:
94

Units:
326

Booked Value:
€6,850

Then later:

Delivered:
115 / 117

Payment Enabled:
Yes

Paid:
112 / 115

Outstanding:
€180

---

# 51. Main Admin Navigation

Recommended admin menu:

1. Dashboard
2. SKU Products
3. Categories
4. Cargo / Pre-Order Cycles
5. Orders
6. Deliveries
7. Payments
8. Customers
9. Invoices
10. Notifications
11. Reports
12. Settings
13. Legal / Terms Versions
14. Admin Users

---

# 52. Website Customer Journey

The customer-facing website should stay extremely simple.

## Step 1: Browse

Customer sees currently available products and prices.

## Step 2: Delivery Promise

Customer sees:

> Order by 26 September  
> Estimated delivery 5–7 October

## Step 3: Add Products

Customer adds products to cart.

## Step 4: Cart

Customer sees:

- item price,
- quantity,
- tax/VAT,
- delivery charge,
- order total.

## Step 5: Checkout

Customer provides:

- Name
- Email
- Phone
- Address

## Step 6: Review

Customer sees the complete bill and understands:

- total order value,
- no payment is collected now,
- payment will become due after delivery.

## Step 7: Confirm Pre-Order

Order is created.

## Step 8: Track

Customer can see estimated delivery and order status.

## Step 9: Receive Delivery

Products are delivered.

## Step 10: Payment Activated

Customer receives payment notification.

## Step 11: Pay

Customer pays securely.

## Step 12: Complete

Customer receives payment confirmation.

---

# 53. Customer Order Page

The secure customer order page should show different content depending on status.

## Before Delivery

Order:
RF-1084

Status:
Confirmed

Subtotal:
€54.62

VAT/Tax:
€3.88

Total:
**€58.50**

Estimated Delivery:
5–7 October

Payment:
**Not yet enabled**

---

## After Delivery / Payment Activation

Order:
RF-1084

Status:
Delivered

Agreed Order Total:
€58.50

Adjustment:
€0.00

Amount Due:
**€58.50**

Payment Deadline:
Friday, 23:59

Button:
**Pay €58.50**

---

## After Payment

Order:
RF-1084

Status:
Completed

Payment:
**Paid**

---

# 54. Database Architecture

Recommended core tables:

```text
USERS / ADMIN_USERS
CUSTOMERS
CATEGORIES
PRODUCTS / SKUS
CARGOS
ORDERS
ORDER_ITEMS
DELIVERIES
PAYMENTS
PAYMENT_EVENTS
NOTIFICATIONS
TERMS_VERSIONS
ORDER_CONSENTS
INVOICES
```

---

# 55. Products Table

Example:

```text
products
--------
id
sku
name
slug
category_id
description
image_url
pack_size
unit
selling_price
vat_rate
is_active
is_available
created_at
updated_at
```

---

# 56. Cargo Table

Example:

```text
cargos
------
id
cargo_number
internal_name
customer_name

order_open_at
order_close_at

delivery_start_date
delivery_end_date

status

payment_enabled
payment_opened_at
payment_due_at

first_reminder_at
final_reminder_at

customer_message
internal_notes

created_at
updated_at
```

---

# 57. Orders Table

Example:

```text
orders
------
id
order_number
customer_id
cargo_id

subtotal
vat_total
delivery_fee
order_total

final_delivered_total

order_status
payment_status

promised_delivery_start
promised_delivery_end

created_at
updated_at
delivered_at
```

---

# 58. Order Items Table

Example:

```text
order_items
-----------
id
order_id
product_id

product_name_snapshot
sku_snapshot

ordered_quantity
delivered_quantity

price_snapshot
vat_rate_snapshot
vat_amount_snapshot

line_total
final_line_total
```

---

# 59. Payments Table

Example:

```text
payments
--------
id
order_id
cargo_id
customer_id

amount_due
amount_paid

status

provider
provider_reference

payment_opened_at
payment_due_at
paid_at

created_at
updated_at
```

---

# 60. Key Automation Rules

## Rule 1

Only one cargo should normally have:

```text
status = TAKING_ORDERS
```

## Rule 2

Every new confirmed order automatically receives:

```text
cargo_id = current_active_cargo.id
```

## Rule 3

Unavailable SKUs cannot be ordered.

## Rule 4

The customer must see complete pricing before order confirmation.

## Rule 5

No payment is collected when the pre-order is confirmed.

## Rule 6

The confirmed order stores price, VAT/tax, delivery fee and total snapshots.

## Rule 7

When cargo order deadline expires:

```text
TAKING_ORDERS → ORDERS_CLOSED
```

## Rule 8

If a scheduled next cargo exists, it may automatically become active.

## Rule 9

When payment is bulk activated:

```text
eligible delivered orders
→ PAYMENT_DUE
```

## Rule 10

Cancelled/non-delivered orders are excluded from payment activation unless manually handled.

## Rule 11

Paid customers never receive future payment reminders.

## Rule 12

When all required balances are settled:

```text
cargo = COMPLETED
```

---

# 61. Edge Cases

The system should anticipate operational exceptions.

## Product price changes after order

Existing order keeps the original price snapshot.

## Product becomes unavailable before cargo closes

Admin can switch SKU to unavailable.

Existing orders remain intact unless admin explicitly changes them.

## Cargo delayed

Update delivery dates and optionally notify all affected customers.

## Partial delivery

Record delivered quantities and calculate any adjustment to final payable amount.

## Customer unavailable during delivery

Order remains not delivered.

Do not automatically request payment.

## Delivery failed

Mark delivery failed and decide whether to retry or cancel.

## Order cancelled before delivery

Payment remains disabled.

## Payment failed

Keep payment due and allow retry.

## Customer claims incorrect amount

Admin can compare original bill, delivered quantities and any adjustment.

---

# 62. Security Requirements

Recommended:

- HTTPS everywhere
- Secure admin authentication
- Role-based admin access
- MFA for admin users if possible
- Secure order tokens
- Server-side price validation
- Server-side tax/VAT calculation validation
- Server-side cargo validation
- Server-side payment verification
- Verify payment-provider webhook signatures
- Audit logs
- Rate limiting
- Database backups
- Never store raw card details

---

# 63. Reporting

Useful reports:

- Sales by cargo
- Orders by cargo
- Customers by cargo
- Product quantity by cargo
- Most ordered SKUs
- Category sales
- Delivery completion rate
- Payment collection rate
- Outstanding payments
- VAT/tax totals
- Revenue by week/month/cargo
- Average order value

---

# 64. MVP Scope

## Admin

- SKU management
- SKU price and VAT/tax configuration
- Category management
- SKU availability ON/OFF
- Cargo creation
- Cargo scheduling
- Active cargo
- Order deadline
- Delivery window
- Cargo statuses
- Order list
- Customer database
- Delivery status
- Bulk payment activation
- Payment deadline
- Stripe integration
- Email notifications
- Automatic reminders
- Payment tracking
- Cargo completion
- Basic reports

## Customer

- Browse products with prices
- See pre-order deadline
- See estimated delivery
- Add to cart
- See complete bill
- See VAT/tax and delivery charge
- Confirm order without paying
- Accept pre-order/payment terms
- Receive order confirmation
- Secure order tracking page
- Receive payment request after delivery
- Pay online
- Receive payment confirmation

---

# 65. Recommended Homepage / Pre-Order Banner

> ## Next Radhe Foods Delivery
>
> **Order by:** 26 September  
> **Estimated delivery:** 5–7 October  
>
> Order within:
> **1d 18h**
>
> Browse products, review your full order price, and confirm your pre-order now.  
> **Payment is collected only after delivery.**
>
> **Pre-Order Now**

---

# 66. Recommended Checkout Summary

> ## Your Pre-Order
>
> Subtotal: €57.90  
> VAT/Tax: €4.05  
> Delivery: €0.00  
> **Total Order Value: €61.95**
>
> Estimated delivery: 5–7 October
>
> **No payment is collected now.**
>
> By confirming this pre-order, you agree to the displayed order value. After successful delivery, Radhe Foods will activate payment and send you a secure payment request.

---

# 67. Recommended Payment Activation Screen

# Activate Payments — Cargo RF-C027

Eligible delivered orders:
118

Excluded cancelled orders:
2

Total amount to collect:
€5,842.60

Payment deadline:
Friday, 23:59

Notifications:

- Email: ON
- WhatsApp: ON/OFF

Reminders:

- After 24 hours: ON
- Due date morning: ON

Button:

## Activate & Notify 118 Customers

---

# 68. Recommended Business Workflow

```text
PERMANENT SKU CATALOGUE
        │
        │ Price + VAT/Tax + Availability
        ▼
ACTIVE PRE-ORDER CARGO
        │
        │ Order Window
        │ Delivery Promise
        ▼
CUSTOMER ADDS PRODUCTS TO CART
        │
        ▼
FULL BILL SHOWN
        │
        │ Item Prices
        │ VAT/Tax
        │ Delivery Fee
        │ Total Order Value
        ▼
CUSTOMER CONFIRMS PRE-ORDER
        │
        │ NO PAYMENT COLLECTED
        ▼
ORDER AUTOMATICALLY ASSIGNED TO ACTIVE CARGO
        │
        ▼
CARGO ORDER WINDOW CLOSES
        │
        ├──────────────► NEXT CARGO STARTS ACCEPTING ORDERS
        │
        ▼
CARGO IN TRANSIT
        │
        ▼
CARGO ARRIVES
        │
        ▼
CUSTOMER DELIVERY
        │
        ▼
FINAL DELIVERED AMOUNT CONFIRMED IF NEEDED
        │
        ▼
BULK PAYMENT ACTIVATION FOR CARGO
        │
        ▼
INDIVIDUAL CUSTOMER PAYMENT REQUESTS
        │
        ▼
EMAIL / WHATSAPP NOTIFICATION
        │
        ▼
AUTOMATIC REMINDERS TO UNPAID CUSTOMERS
        │
        ▼
LAST PAYMENT RECEIVED
        │
        ▼
CARGO = COMPLETED
```

---

# 69. Most Important Design Decisions

1. **SKU products are permanent and are not recreated for every cargo.**
2. **Every SKU contains its selling price and VAT/tax configuration.**
3. **Admin controls product availability using ON/OFF.**
4. **Cargo represents a pre-order and delivery cycle, not a separate product catalogue.**
5. **Only one cargo normally accepts new orders at a time.**
6. **Several older/future cargos can exist simultaneously in other statuses.**
7. **Every new order is automatically assigned to the currently active cargo.**
8. **The active cargo controls the customer-facing order deadline and estimated delivery window.**
9. **The customer sees the complete bill before confirming the pre-order.**
10. **The customer agrees to the order price at checkout.**
11. **No payment is collected at checkout.**
12. **Prices and tax/VAT are snapshotted into the order.**
13. **Payment is activated only after delivery.**
14. **Payment activation happens in bulk at cargo level.**
15. **Every order still has its own individual amount and payment record.**
16. **Only unpaid customers receive automated reminders.**
17. **Order status and payment status remain separate.**
18. **Customer-facing language should focus on Pre-Order / Next Delivery instead of internal cargo terminology.**
19. **The customer experience stays simple even though the admin system is operationally powerful.**

---

# 70. Final Product Vision

The Radhe Foods platform should feel simple to the customer:

**Browse → See Price → Add to Cart → Review Full Bill → Confirm Pre-Order → Track → Receive → Pay**

Behind the scenes, the admin system should manage:

**SKUs + Prices + VAT → Active Cargo → Orders → Delivery → Bulk Payment Activation → Automated Reminders → Payment Reconciliation → Cargo Completion**

The central business concept is:

> **The customer knows and agrees to the complete price when the pre-order is placed, but Radhe Foods collects the money only after successful delivery.**
