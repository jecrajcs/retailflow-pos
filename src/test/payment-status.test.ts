import { describe, expect, it } from "vitest";

import {
  computePaymentStatus,
  discountFromInput,
  familySummary,
  matchesProductSearch,
  type Customer,
  type Product,
} from "@/lib/pos";

// Rule from the POS spec: an invoice is PAID when payments cover the total,
// PARTIALLY_PAID when some money was received, UNPAID when none was.
describe("invoice payment status", () => {
  it("is PAID when payments cover the invoice total", () => {
    expect(computePaymentStatus(450, 450)).toBe("PAID");
    expect(computePaymentStatus(450, 500)).toBe("PAID");
  });

  it("is PARTIALLY_PAID when some money was received but not the full total", () => {
    expect(computePaymentStatus(450, 200)).toBe("PARTIALLY_PAID");
  });

  it("is UNPAID when nothing was received", () => {
    expect(computePaymentStatus(450, 0)).toBe("UNPAID");
  });
});

describe("POS search and bill rules", () => {
  it("converts a percentage bill discount from the current subtotal", () => {
    expect(discountFromInput(1000, 10, "PERCENT")).toBe(100);
  });

  it("includes every family member with a shared mobile in the due total", () => {
    const family = [
      { id: "1", mobile: "9000", outstanding_balance: 195 },
      { id: "2", mobile: "9000", outstanding_balance: 80 },
      { id: "3", mobile: "8000", outstanding_balance: 25 },
    ] as Customer[];
    expect(familySummary(family, "9000").outstanding).toBe(275);
    expect(familySummary(family, "9000").members).toHaveLength(2);
  });

  it("matches bucket searches to balti and tolerates a one-character typo", () => {
    const product = { name: "Plastic Balti", sku: "SKU-BKT" } as Product;
    expect(matchesProductSearch(product, "bucket")).toBe(true);
    expect(matchesProductSearch(product, "balti")).toBe(true);
    expect(matchesProductSearch(product, "baltiy")).toBe(true);
  });
});
