# Roadmap

- [x] DB: products (variant, rack, floor price), customers (visits), payments (tendered/change), cash_transactions log, function updates
- [x] lib/pos.ts: types, hooks (cash txn), mutations (logCashTxn, quickAdd full fields, addCustomer demographics)
- [x] AppNav: Billing, Inventory, Cash Drawer, Manager tabs
- [x] /inventory route: SKU/rack/4-location stock/min/reorder status + 1-click transfer request
- [x] Billing: customer-first auto-dialog, customer banner (visits, age, gender, udhar), rack chip per line, line & bill discount floor guard, F2 prefill from scan box
- [x] QuickAdd: variant/category/UOM/rack/cost/sell/min-sell full form with prefill
- [x] Payment modal: cash tendered + currency chips + live big Change display; credit only registered customer
- [x] Receipt: change return printed
- [x] Cash Drawer: full cash in/out history log with reasons, quick log form, pre-filled shift close
- [ ] Verify: Playwright end-to-end billing flow (build OK कॉन्फर्म है)
