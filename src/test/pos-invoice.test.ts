import { beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  commitLocalOperation: vi.fn(),
  getAllLocal: vi.fn(),
  getDeviceId: vi.fn(),
  getLocal: vi.fn(),
  nextLocalSequence: vi.fn(),
}));

vi.mock("@/lib/local-db", () => ({
  ...localDb,
  subscribeLocalChanges: vi.fn(),
}));

vi.mock("@/lib/offline-sync", () => ({
  syncOutbox: vi.fn(),
}));

import {
  createPosInvoice,
  createTransfer,
  loadLocalDraftPayload,
  matchesProductSearch,
  quickAddProduct,
  setTransferStatus,
  type Customer,
  type Product,
} from "@/lib/pos";

const product: Product = {
  id: "product-1",
  name: "Supari",
  name_hi: null,
  search_aliases: [],
  sku: "SUP-5",
  barcode: "12345",
  hsn: null,
  category: null,
  variant: "Small pouch",
  rack_location: null,
  purchase_cost: 2,
  mrp: 5,
  sale_price: 5,
  price_tiers: [],
  min_sale_price: 5,
  uom_purchase: "Pcs",
  uom_stock: "Pcs",
  uom_sale: "Pcs",
  conversion_factor: 1,
  min_stock: 0,
  is_loose: false,
  enrichment_status: "PENDING",
  preferred_supplier: null,
};

const customer: Customer = {
  id: "customer-1",
  name: "Walk-in",
  mobile: null,
  age_group: null,
  gender: null,
  credit_limit: 0,
  outstanding_balance: 0,
  visits: 0,
};

describe("POS invoice creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localDb.getDeviceId.mockResolvedValue("device-1");
    localDb.getLocal.mockResolvedValue(undefined);
    localDb.getAllLocal.mockImplementation(async (store: string) => {
      if (store === "catalog") return [product];
      if (store === "location_products")
        return [
          {
            id: "product-1:location-1",
            product_id: product.id,
            location_id: "location-1",
            stock_count_status: "AWAITING_COUNT",
          },
        ];
      if (store === "customers") return [customer];
      return [];
    });
  });

  it("records the signed-in cashier ID instead of the device ID", async () => {
    await createPosInvoice({
      locationId: "location-1",
      invoiceNumber: "SHOP-0001",
      cashierId: "staff-user-1",
      cashierName: "Cashier One",
      customerId: customer.id,
      discount: 0,
      businessDate: "2026-11-13",
      items: [
        {
          product_id: product.id,
          quantity: 1,
          unit_price: 5,
          uom: "Pcs",
          discount: 0,
          total: 5,
          unit_cost_snapshot: 2,
        },
      ],
      payments: [{ mode: "CASH", amount: 5, tendered: 5, change_given: 0 }],
    });

    const operation = localDb.commitLocalOperation.mock.calls[0]?.[1];
    const payload = localDb.commitLocalOperation.mock.calls[0]?.[2];
    expect(operation).toBe("invoice.finalize");
    expect(payload).toMatchObject({
      invoice: { cashier_id: "staff-user-1", cashier_name: "Cashier One" },
    });
  });

  it("allows multiple quick-added SKUs to share a barcode", async () => {
    localDb.getAllLocal.mockResolvedValue([]);
    const small = await quickAddProduct({
      name: "Supari",
      sku: "SUP-5",
      barcode: "12345",
      variant: "Small pouch",
      salePrice: 5,
      purchaseCost: 2,
      mrp: 5,
      uom: "Pcs",
      locationId: "location-1",
      cashierQuickAdd: true,
    });
    const medium = await quickAddProduct({
      name: "Supari",
      sku: "SUP-10",
      barcode: "12345",
      variant: "Medium pouch",
      salePrice: 10,
      purchaseCost: 4,
      mrp: 10,
      uom: "Pcs",
      locationId: "location-1",
      cashierQuickAdd: true,
    });

    expect(small.barcode).toBe(medium.barcode);
    expect(small.id).not.toBe(medium.id);
    expect(localDb.commitLocalOperation).toHaveBeenCalledTimes(2);
    for (const [, operation, payload] of localDb.commitLocalOperation.mock.calls) {
      expect(operation).toBe("product.quick_add");
      expect(payload).toMatchObject({
        barcode_candidate: { code: "12345" },
      });
    }
    const candidateIds = localDb.commitLocalOperation.mock.calls.map(
      ([entries]) =>
        (entries as Array<{ store: string; value: Record<string, unknown> }>).find(
          (entry) => entry.store === "barcode_candidates",
        )?.value["id"],
    );
    expect(new Set(candidateIds).size).toBe(2);
  });

  it("finds a catalog product by its barcode", () => {
    expect(matchesProductSearch(product, "12345")).toBe(true);
    expect(matchesProductSearch(product, "SUP-5")).toBe(true);
  });

  it("reconstructs an open bill when the saved draft payload is missing", async () => {
    const invoice = {
      id: "draft-1",
      invoice_number: "SHOP-0001",
      location_id: "location-1",
      customer_id: customer.id,
      cashier_id: "staff-user-1",
      cashier_name: "Cashier One",
      total_amount: 5,
      discount_amount: 0,
      paid_amount: 0,
      balance_amount: 5,
      payment_status: "UNPAID",
      status: "DRAFT",
      business_date: "2026-11-13",
      created_at: "2026-11-13T00:00:00.000Z",
      sync_status: "SYNCED",
    };
    localDb.getLocal.mockImplementation(async (store: string) =>
      store === "bills" ? invoice : undefined,
    );
    localDb.getAllLocal.mockImplementation(async (store: string) => {
      if (store === "invoice_items")
        return [
          {
            id: "draft-1:product-1",
            invoice_id: invoice.id,
            product_id: product.id,
            quantity: 1,
            unit_price: 5,
            uom: "Pcs",
            discount: 0,
            total: 5,
            line_index: 0,
            product_snapshot: product,
          },
        ];
      if (store === "catalog") return [product];
      if (store === "customers") return [customer];
      return [];
    });

    const payload = await loadLocalDraftPayload(invoice.id);

    expect(payload).toMatchObject({
      invoice: { id: invoice.id },
      customer: { id: customer.id },
      customer_mode: "chosen",
      items: [{ product: { id: product.id }, quantity: 1, unit_price: 5 }],
    });
    expect(localDb.commitLocalOperation).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ store: "settings" })]),
      "invoice.draft.save",
      expect.objectContaining({ record_id: invoice.id }),
      "location-1",
      invoice.id,
    );
  });

  it("combines repeated SKUs in a transfer before saving the stock request", async () => {
    await createTransfer({
      fromLocationId: "warehouse-1",
      toLocationId: "store-1",
      items: [
        { product_id: product.id, quantity: 3 },
        { product_id: product.id, quantity: 2 },
      ],
      notes: null,
    });

    const entries = localDb.commitLocalOperation.mock.calls[0]?.[0] as Array<{
      store: string;
      value: Record<string, unknown>;
    }>;
    const transferItems = entries.filter((entry) => entry.store === "transfer_items");
    expect(transferItems).toHaveLength(1);
    expect(transferItems[0]?.value).toMatchObject({
      product_id: product.id,
      quantity: 5,
    });
  });

  it("rejects non-finite quantities and same-location transfers", async () => {
    await expect(
      createTransfer({
        fromLocationId: "warehouse-1",
        toLocationId: "store-1",
        items: [{ product_id: product.id, quantity: Number.NaN }],
        notes: null,
      }),
    ).rejects.toThrow("finite and greater than zero");

    await expect(
      createTransfer({
        fromLocationId: "store-1",
        toLocationId: "store-1",
        items: [{ product_id: product.id, quantity: 1 }],
        notes: null,
      }),
    ).rejects.toThrow("two different locations");

    expect(localDb.commitLocalOperation).not.toHaveBeenCalled();
  });

  it("applies duplicate legacy transfer lines as one stock movement", async () => {
    localDb.getLocal.mockResolvedValue({
      id: "transfer-1",
      from_location_id: "warehouse-1",
      to_location_id: "store-1",
      status: "REQUESTED",
      notes: null,
      created_at: "2026-11-13T00:00:00.000Z",
    });
    localDb.getAllLocal.mockImplementation(async (store: string) => {
      if (store === "transfer_items")
        return [
          { id: "transfer-item-1", transfer_id: "transfer-1", product_id: product.id, quantity: 4 },
          { id: "transfer-item-2", transfer_id: "transfer-1", product_id: product.id, quantity: 4 },
        ];
      if (store === "inventory_snapshot")
        return [
          {
            id: `${product.id}:warehouse-1`,
            product_id: product.id,
            location_id: "warehouse-1",
            quantity_on_hand: 10,
          },
        ];
      return [];
    });

    await setTransferStatus("transfer-1", "IN_TRANSIT");

    const [, operation, payload] = localDb.commitLocalOperation.mock.calls[0] ?? [];
    expect(operation).toBe("inventory.transfer.status");
    expect(payload).toMatchObject({
      stock_movements: [
        {
          product_id: product.id,
          location_id: "warehouse-1",
          quantity_delta: -8,
          quantity_on_hand: 2,
        },
      ],
    });
  });
});
