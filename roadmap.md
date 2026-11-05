# Roadmap

## Full redesign (60-30-10 Material) + Excel integration
- [x] DB: products variant/rack/min price, customers visits, payments tendered/change, cash_transactions, function updates
- [x] lib/pos.ts, AppNav 4 tabs, /inventory, POS customer-first banner, F2 prefill, floor guards, payment modal, receipt, cash history
- [ ] DB: stock_movements ledger table + inventory triggers (SALE/ADJUSTMENT/TRANSFER/OPENING via GUC), backfill opening rows; cash_drawer_sessions opening/closing_denominations jsonb + function updates
- [ ] Import Excel data: 464 SKUs (prices/rack/min stock/supplier), opening+current stock, 24 customers with udhar/visits; drop demo seed products
- [ ] Design system: 60-30-10 slate canvas/cards, #5B5CE2 primary, emerald/amber/rose/sky semantics (styles.css)
- [ ] lib/pos.ts: stock movement hooks, auto-SKU (SKU-YYMMDD-XXX) in quickAdd, legacy stock adjustment mutation, xlsx import/export helpers
- [ ] POS screen: inline customer-first section (search/add/walk-in inline), scan lock till customer resolved, new-bill button, left grid / right quick tiles, big F4 Pay
- [ ] Quick-add: auto-SKU, numeric→barcode / text→name smart prefill, minimal fields, PENDING flag
- [ ] Inventory: stock movement register tab, legacy/opening stock entry flow, Excel export (stock register, reorder list)
- [ ] Cash drawer: denomination-wise shift open/close counting, express/detailed
- [ ] Manager: Excel import (catalog, opening stock, customers incl. old udhar) + exports (daily sales register)
- [ ] Tests + Playwright end-to-end billing verify
