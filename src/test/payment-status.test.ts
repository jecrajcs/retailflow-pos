import { describe, expect, it } from "vitest";

import { computePaymentStatus } from "@/lib/pos";

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
