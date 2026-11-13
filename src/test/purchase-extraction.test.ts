import { describe, expect, it } from "vitest";

import { itemRowsFromOcr } from "@/lib/purchase-extraction";
import type { Product } from "@/lib/pos";
import { managerExpiryAlerts } from "@/routes/manager";
import { purchaseLineForProduct } from "@/routes/purchases";

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
  it("uses the catalog cost for a matched line without replacing an invoice cost", () => {
    const product = {
      id: "product-2",
      name: "Dish Soap",
      sku: "SOAP-01",
      variant: "500 ml",
      purchase_cost: 28,
      sale_price: 40,
      uom_sale: "Pcs",
    } as Product;

    expect(
      purchaseLineForProduct(
        {
          product_id: "",
          quantity: 3,
          unit_cost: 0,
          manufactured_on: "2026-01-01",
          expires_on: "2027-01-01",
        },
        product,
      ),
    ).toMatchObject({
      product_id: "product-2",
      unit_cost: 28,
      variant: "500 ml",
      manufactured_on: "2026-01-01",
      expires_on: "2027-01-01",
    });

    expect(
      purchaseLineForProduct({ product_id: "", quantity: 3, unit_cost: 31 }, product).unit_cost,
    ).toBe(31);
  });

  it("alerts managers about received lots expiring in the next 30 days", () => {
    const alerts = managerExpiryAlerts(
      [
        {
          id: "received",
          status: "RECEIVED",
          supplier_invoice_number: "INV-1",
          items: [
            { product_id: "product-3", quantity: 4, expires_on: "2026-01-30" },
            { product_id: "product-3", quantity: 2, expires_on: "2026-02-01" },
          ],
        },
        {
          id: "draft",
          status: "DRAFT",
          supplier_invoice_number: "INV-2",
          items: [{ product_id: "product-3", quantity: 1, expires_on: "2026-01-15" }],
        },
      ],
      [{ id: "product-3", name: "Dish Soap", variant: "500 ml" } as Product],
      new Date("2026-01-01T10:00:00"),
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      name: "Dish Soap",
      variant: "500 ml",
      quantity: 4,
      expiresOn: "2026-01-30",
      expired: false,
    });
  });
});
