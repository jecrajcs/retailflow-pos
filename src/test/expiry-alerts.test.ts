import { describe, expect, it } from "vitest";

import { expiringProductSuggestions } from "@/lib/expiry-alerts";
import type { LocalPurchaseReceipt, Product } from "@/lib/pos";

const product = {
  id: "product-1",
  name: "Supari",
  variant: "Small pouch",
} as Product;

function receipt(
  status: LocalPurchaseReceipt["status"],
  items: LocalPurchaseReceipt["items"],
): LocalPurchaseReceipt {
  return {
    id: `receipt-${status}`,
    supplier_name: "Supplier",
    supplier_invoice_number: "INV-1",
    invoice_date: "2026-11-01",
    warehouse_location_id: "location-1",
    status,
    created_at: "2026-11-01T10:00:00.000Z",
    sync_status: "SYNCED",
    items,
  };
}

describe("cashier expiry suggestions", () => {
  it("suggests available products from received lots expiring in the next 30 days", () => {
    const suggestions = expiringProductSuggestions(
      [
        receipt("RECEIVED", [
          { product_id: product.id, quantity: 3, unit_cost: 4, expires_on: "2026-11-20" },
          { product_id: product.id, quantity: 2, unit_cost: 4, expires_on: "2026-11-25" },
        ]),
        receipt("DRAFT", [
          { product_id: product.id, quantity: 9, unit_cost: 4, expires_on: "2026-11-15" },
        ]),
        receipt("RECEIVED", [
          { product_id: product.id, quantity: 7, unit_cost: 4, expires_on: "2027-01-01" },
        ]),
      ],
      [product],
      new Set([product.id]),
      new Date("2026-11-13T10:00:00"),
    );

    expect(suggestions).toEqual([{ product, quantity: 5, expiresOn: "2026-11-20" }]);
  });

  it("does not suggest expired or unavailable product lots", () => {
    const suggestions = expiringProductSuggestions(
      [
        receipt("RECEIVED", [
          { product_id: product.id, quantity: 3, unit_cost: 4, expires_on: "2026-11-12" },
        ]),
      ],
      [product],
      new Set(),
      new Date("2026-11-13T10:00:00"),
    );

    expect(suggestions).toEqual([]);
  });
});
