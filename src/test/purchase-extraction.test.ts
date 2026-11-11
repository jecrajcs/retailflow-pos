import { describe, expect, it } from "vitest";

import { itemRowsFromOcr } from "@/lib/purchase-extraction";
import type { Product } from "@/lib/pos";

describe("local purchase invoice OCR extraction", () => {
  it("prefills SKU, quantity, cost, source total, and retail price for an unmatched item", () => {
    const [item] = itemRowsFromOcr(
      "SKU: NEW-02 New item Qty: 3 Cost: ₹24 Amount: ₹72 Selling Price: ₹35",
      [],
    );

    expect(item).toMatchObject({
      product_id: "",
      name: "New item",
      sku: "NEW-02",
      quantity: 3,
      unit_cost: 24,
      source_total: 72,
      retail_price: 35,
    });
  });

  it("matches a known SKU to catalog name and retail price", () => {
    const product = {
      id: "product-1",
      name: "Basmati Rice",
      sku: "RICE-01",
      barcode: null,
      sale_price: 75,
      uom_sale: "Kg",
    } as Product;
    const [item] = itemRowsFromOcr("SKU: RICE-01 Qty: 2 Rate: 50 Amount: 100", [product]);

    expect(item).toMatchObject({
      product_id: "product-1",
      name: "Basmati Rice",
      sku: "RICE-01",
      quantity: 2,
      unit_cost: 50,
      source_total: 100,
      retail_price: 75,
      uom: "Kg",
    });
  });
});
