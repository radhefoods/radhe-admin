# Radhe Foods Pre-Order System — Core Concept

## 1. Main Idea

Radhe Foods will use a **pre-order sales model** in Germany.

Customers can browse available products, see their prices, add them to cart, review the complete bill, and confirm the order.

**No payment is collected when the order is confirmed.**

Payment becomes active only after the products have been delivered.

The complete flow is:

**Available SKUs → Active Cargo → Cart → Full Bill → Confirm Order → Delivery → Activate Payment → Reminder → Paid → Cargo Completed**

---

## 2. Permanent SKU Catalogue

Radhe Foods maintains one permanent SKU catalogue.

Each SKU contains:

- Product name
- SKU code
- Category
- Pack size
- Selling price
- VAT/tax
- Product image
- Availability ON/OFF

Products are not recreated for every cargo.

Example:

| Product | Price | Available |
|---|---:|---|
| Kesar Mango | €24.99 | ON |
| Banana Chips | €3.99 | ON |
| Rice 5 kg | €14.99 | ON |
| Guava | €8.99 | OFF |

If a SKU is ON, customers can order it.

If it is OFF, customers cannot order it.

---

## 3. Cargo = Pre-Order / Delivery Cycle

A cargo controls:

- Order opening date
- Order closing date
- Estimated delivery window
- Cargo status
- Orders received during that period
- Payment activation
- Payment deadline

Normally only **one cargo accepts new orders at a time**.

Every new order automatically belongs to that active cargo.

---

## 4. Continuous Cargo System

Example:

### Cargo 1

Orders:
24–26 September

Delivery:
5–7 October

### Cargo 2

Orders:
27–30 September

Delivery:
12–15 October

When Cargo 1 closes, Cargo 2 can immediately start accepting orders.

The SKU catalogue stays the same.

Only the cargo cycle and delivery promise change.

Several cargos can exist at the same time:

- Cargo 1 → Delivering
- Cargo 2 → Taking Orders
- Cargo 3 → Scheduled

---

## 5. Customer Website

The customer sees:

> **Next Radhe Foods Delivery**
>
> Order by: 26 September  
> Estimated delivery: 5–7 October

The website can also show a countdown such as:

> Order within 1 day 18 hours

Customers browse normal available products and see their prices.

They do not manually choose a cargo.

---

## 6. Cart

The cart should work like a normal online shop.

Example:

| Item | Qty | Unit Price | Total |
|---|---:|---:|---:|
| Kesar Mango | 2 | €24.99 | €49.98 |
| Banana Chips | 3 | €3.99 | €11.97 |

The customer should always be able to see what they are ordering and how much it costs.

---

## 7. Checkout

Checkout shows the full bill.

Example:

Subtotal: €57.90  
VAT/Tax: €4.05  
Delivery: €0.00  
**Total Order Value: €61.95**

Estimated delivery:
**5–7 October**

Then clearly show:

> **No payment is collected now.**
>
> You are confirming an order with a total value of €61.95. After successful delivery, Radhe Foods will activate payment and send you a secure payment request.

So this is **not a free reservation**.

The customer agrees to the order and price now, but pays later.

---

## 8. Confirm Order Instead of Pay Now

At preorder checkout there is no payment screen.

The flow is:

**Review Bill → Accept Terms → Confirm Pre-Order**

The customer confirms the order.

The exact final checkout wording should be legally reviewed for Germany if the action creates a binding payment obligation.

---

## 9. Order Creation

When the customer confirms:

- Order is created
- Active cargo is assigned automatically
- Product prices are saved
- VAT/tax is saved
- Delivery charge is saved
- Total order value is saved
- Estimated delivery is saved
- Payment remains disabled
- Customer receives confirmation

Example:

**Order RF-1084**

Order Total:
€58.50

Estimated Delivery:
5–7 October

Payment Status:
**Not Enabled**

---

## 10. Price Snapshot

The price shown when the customer confirms the order should be stored permanently with that order.

Example:

Customer orders Mango at €24.99.

Later the SKU price changes to €26.99.

The existing customer's order still remains €24.99.

The same principle applies to the tax/VAT used for that order.

---

## 11. Cargo Lifecycle

Recommended flow:

**Draft → Scheduled → Taking Orders → Orders Closed → In Transit → Arrived → Delivering → Delivered → Payment Active → Payment Remaining → Completed**

---

## 12. Delivery

Radhe Foods delivers the products before collecting payment.

Order statuses can include:

- Confirmed
- Preparing
- Out for Delivery
- Delivered
- Delivery Failed
- Cancelled

Payment status is separate.

Example:

**Order Status: Delivered**

**Payment Status: Not Enabled**

---

## 13. Final Amount Adjustment

Normally the payment amount should equal the amount the customer agreed to at checkout.

If actual delivery changes, the final amount can be adjusted.

Example:

Customer ordered:
4 Mango boxes

Actually delivered:
3 Mango boxes

The customer should only pay for what was actually delivered.

The order should show the adjustment clearly.

---

## 14. Cargo-Level Payment Activation

Radhe Foods does not activate payment customer by customer.

After the cargo delivery process is complete, admin opens the cargo and clicks:

**Activate Payment**

Example:

Delivered orders:
118

Cancelled orders:
2

Total amount to collect:
€5,842.60

Payment deadline:
Friday 23:59

Then:

**Activate & Notify Customers**

---

## 15. Payment

Each customer receives their own payment request.

Example:

> Your Radhe Foods order has been delivered.
>
> Order total: €58.50
>
> Amount due: €58.50
>
> Payment deadline: Friday 23:59
>
> **Pay Now**

Stripe can be used for secure online payment.

When payment succeeds:

**Payment Status → Paid**

---

## 16. Automatic Reminders

The system should automatically remind only unpaid customers.

Example:

### Tuesday
Payment activated.

### Wednesday
After 24 hours, unpaid customers receive a reminder.

### Friday Morning
Customers still unpaid receive a final due-today reminder.

### Friday End of Day
Still unpaid orders become:

**Overdue**

Paid customers are automatically excluded.

---

## 17. Payment Remaining

If most customers have paid but some remain unpaid:

**Cargo Status → Payment Remaining**

Example:

82 customers

81 paid

1 unpaid

Outstanding:
€38.90

---

## 18. Cargo Completion

When the final required payment is received:

**Cargo automatically becomes Completed**

No manual update is required.

---

## 19. Customer Database

Radhe Foods maintains a customer database including:

- Name
- Email
- Phone
- WhatsApp
- Address
- Order history
- Cargo history
- Total spend
- Outstanding balance
- Payment history
- Customer status

Possible statuses:

- Normal
- Payment Outstanding
- Overdue
- Blocked
- Trusted / VIP

Customers with serious overdue balances can be prevented from placing another pre-order.

---

## 20. Pre-Order Terms

Before confirming the order, the customer should acknowledge the pre-order/payment terms.

The checkout should clearly explain:

- The full order price
- VAT/tax
- Delivery charge
- Estimated delivery
- No payment is collected now
- Payment becomes due after delivery
- Payment deadline will apply after activation

The Privacy Policy should remain separate from the commercial/payment terms.

---

## 21. Customer Journey

The customer-side journey is:

**Browse → See Price → Add to Cart → Review Full Bill → Confirm Pre-Order → Track → Receive → Pay**

Step by step:

1. Customer visits Radhe Foods.
2. Customer sees available SKUs and prices.
3. Customer sees current order deadline and estimated delivery.
4. Customer adds products to cart.
5. Customer reviews item prices, VAT/tax, delivery and total.
6. Customer confirms the order.
7. No payment is taken.
8. Order is assigned to the active cargo.
9. Customer receives confirmation.
10. Cargo closes.
11. New cargo starts accepting future orders.
12. Previous cargo arrives.
13. Radhe Foods delivers the order.
14. Final amount is confirmed if needed.
15. Radhe Foods activates payment for the cargo.
16. Customer receives payment notification.
17. Customer pays online.
18. Unpaid customers receive automatic reminders.
19. Paid orders complete.
20. When the last required payment arrives, the cargo completes.

---

## 22. Admin Journey

The admin-side journey is:

**Manage SKUs → Set Prices & VAT → Switch Availability ON/OFF → Open Cargo → Collect Orders → Close Cargo → Deliver → Activate Payment → Send Automatic Reminders → Collect Payments → Complete Cargo**

---

## 23. Main Admin Sections

Recommended:

- Dashboard
- SKU Products
- Categories
- Cargo / Pre-Order Cycles
- Orders
- Deliveries
- Payments
- Customers
- Notifications
- Invoices
- Reports
- Settings

---

## 24. Final Core Concept

The business model is:

> **Radhe Foods shows the customer the complete product price and full order bill at the time of pre-order. The customer confirms the order but does not pay immediately. Radhe Foods delivers the products first, then activates payment for the entire cargo and collects payment from each customer afterward.**

In one line:

**See Price → Confirm Order → Receive Delivery → Pay After Delivery**
