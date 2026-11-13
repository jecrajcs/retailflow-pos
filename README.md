# DailyPlazaa POS

अब आप प्रोजेक्ट बनाना स्टार्ट कीजिए, पूरा एंड टू एंड विद पॉस, विद बैकएंड, विद एवरीथिंग... एक बेसिक सिस्टम जहाँ पे मैं सीधा का सीधा जाके... स्कैन या बारकोड से स्कैन कर सकूँ या फिर... अ... सीधा सीधा प्रोडक्ट ऐड कर सकूँ पर... पॉस बनाने का, बिलिंग बनाने का, कस्टमर एडिशन सब चीज़ करना स्टार्ट कर सकूँ।

Requirements based on our confirmed architecture:

1. Complete PostgreSQL / Supabase schema for Hub-and-Spoke Retail:

- locations (Central Warehouse, Outlet 1 Retail, Outlet 2 Retail, Outlet 3 Wholesale/Retail, Ecommerce Virtual Outlet)
- products (id, name, barcode/sku, hsn, purchase_cost, mrp, sale_price, uom_purchase, uom_stock, uom_sale, conversion_factor, min_stock, is_loose, enrichment_status)
- inventory (product_id, location_id, quantity_on_hand, reserved_qty)
- customers (id, name, mobile, age_group, gender, credit_limit, outstanding_balance) - mobile not mandatory, multiple profiles can share mobile
- invoices (id, invoice_number, location_id, customer_id, total_amount, discount_amount, paid_amount, balance_amount, payment_status: PAID/PARTIALLY_PAID/UNPAID, created_at)
- invoice_items (id, invoice_id, product_id, quantity, unit_price, uom, discount, total)
- payments (id, invoice_id, customer_id, amount, mode: CASH/UPI/CARD/CREDIT, created_at)
- stock_transfers (id, from_location_id, to_location_id, status: REQUESTED/IN_TRANSIT/RECEIVED, notes)
- cash_drawer_sessions (id, location_id, opened_by, opening_cash, closing_cash, cash_sales, cash_in, cash_out, status)
- stock_adjustments (id, product_id, location_id, quantity, reason: PEST/TORN/EXPIRED/SPOILAGE, returnable_to_vendor, cost_loss)

2. Frontend UI Screens:

- Single-Screen Fast POS Billing: Top store selector, keyboard shortcuts, barcode auto-focus input, invoice item grid, customer search/add without mandatory phone, visual quick-item tiles, and multi-location stock badge on each item with 1-click indent request.
- On-the-fly quick item addition modal (name, price, UOM in 5s) directly from POS.
- Payment modal: Split payment (Cash, UPI QR, Card, Customer Credit) with instant invoice-linked reconciliation.
- Thermal receipt (2-inch/3-inch) print preview.
- Cash Drawer Express & Detailed view with shift open/close reconciliation.
- Manager screens: Catalog Enrichment Queue, Stock Transfer requests, and Damage/Expiry Write-Off.
- Role-separated Admin console at `/admin` for network-wide location setup, analytics, and staff provisioning; Managers operate assigned stores and manage Cashier access within their locations.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b76256b9-9042-48f3-8071-e13caa8707fb).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
