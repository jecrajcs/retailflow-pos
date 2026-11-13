import { describe, expect, it } from "vitest";

import {
  computePaymentStatus,
  discountFromInput,
  familySummary,
  getProductPrice,
  matchesProductSearch,
  parsePriceTiers,
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

  it("matches product brands", () => {
    const product = { name: "Supari", brand: "Sweety" } as Product;
    expect(matchesProductSearch(product, "sweety")).toBe(true);
  });
});

describe("quantity based wholesale pricing", () => {
  const product = {
    sale_price: 80,
    price_tiers: parsePriceTiers("Small:6:72; Medium:12:68; Large:24:62"),
  } as Product;

  it("uses retail below the first configured tier and the highest reached tier above it", () => {
    expect(getProductPrice(product, 5).unitPrice).toBe(80);
    expect(getProductPrice(product, 6).unitPrice).toBe(72);
    expect(getProductPrice(product, 18).unitPrice).toBe(68);
    expect(getProductPrice(product, 24).unitPrice).toBe(62);
  });

  it("normalizes legacy quantities to the three named wholesale levels", () => {
    expect(parsePriceTiers("6:72,12:68,24:62").map((tier) => tier.label)).toEqual([
      "Wholesale Small",
      "Wholesale Medium",
      "Wholesale Large",
    ]);
  });

  it("rejects out of order thresholds and increasing unit prices", () => {
    expect(() => parsePriceTiers("Medium:6:68; Small:12:64")).toThrow(
      "thresholds must increase in that order",
    );
    expect(() => parsePriceTiers("Small:6:68; Medium:12:72")).toThrow("cannot cost more per unit");
  });
});
