import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  isWorkbookLocationColumn,
  RETAILFLOW_WORKBOOK_HEADER_ROWS,
  RETAILFLOW_WORKBOOK_SHEETS,
} from "@/lib/retail-workbook";

type SourceRow = Record<string, unknown>;

const workbook = XLSX.readFile(
  resolve(process.cwd(), "Shop Inventory & POS Management System.xlsx"),
  {
    cellDates: true,
  },
);

function sourceRows(sheetName: string, headerRow: number): SourceRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Workbook is missing the ${sheetName} source sheet.`);
  const values = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const headers = (values[headerRow] ?? []).map((value) => String(value ?? "").trim());
  return values.slice(headerRow + 1).flatMap((cells) => {
    const row = Object.fromEntries(
      headers.flatMap((header, index) => (header ? [[header, cells[index] ?? null]] : [])),
    );
    return Object.values(row).some((value) => value !== null && value !== "") ? [row] : [];
  });
}

function value(row: SourceRow, key: string) {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.entries(row).find(
    ([name]) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedKey,
  )?.[1];
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function amount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(stringValue(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : stringValue(value);
}

describe("attached DailyPlazaa workbook source", () => {
  const products = sourceRows(
    RETAILFLOW_WORKBOOK_SHEETS.products,
    RETAILFLOW_WORKBOOK_HEADER_ROWS.products,
  );
  const customers = sourceRows(
    RETAILFLOW_WORKBOOK_SHEETS.customers,
    RETAILFLOW_WORKBOOK_HEADER_ROWS.customers,
  );
  const sales = sourceRows(RETAILFLOW_WORKBOOK_SHEETS.sales, RETAILFLOW_WORKBOOK_HEADER_ROWS.sales);
  const purchases = sourceRows(
    RETAILFLOW_WORKBOOK_SHEETS.purchases,
    RETAILFLOW_WORKBOOK_HEADER_ROWS.purchases,
  );

  it("imports only the four source sheets and keeps derived report tabs out", () => {
    expect(Object.values(RETAILFLOW_WORKBOOK_SHEETS)).toEqual([
      "2_Sales_Billing",
      "4_Customer_Master",
      "5_Purchase_Entry",
      "6_Master_Stock",
    ]);
    expect(products).toHaveLength(531);
    expect(customers).toHaveLength(34);
    expect(sales).toHaveLength(264);
    expect(purchases).toHaveLength(554);
    expect(Object.keys(workbook.Sheets)).toContain("7_Auto_Reorder");
    expect(Object.values(RETAILFLOW_WORKBOOK_SHEETS)).not.toContain("7_Auto_Reorder");
    expect(Object.keys(workbook.Sheets)).toContain("10_Executive_Analytics");
  });

  it("groups source sales and purchases without losing source totals", () => {
    const saleBills = new Map<string, Set<string>>();
    for (const row of sales) {
      const key = `${dateKey(value(row, "Date"))}|${stringValue(value(row, "Bill_No")).toLowerCase()}`;
      const modes = saleBills.get(key) ?? new Set<string>();
      modes.add(
        stringValue(value(row, "Payment_Mode"))
          .toUpperCase()
          .replace(/[^A-Z]/g, ""),
      );
      saleBills.set(key, modes);
    }
    const receipts = new Set(
      purchases.map(
        (row) =>
          `${stringValue(value(row, "Supplier_Name")).toLowerCase()}|${stringValue(value(row, "Bill_Invoice_No")).toLowerCase()}`,
      ),
    );
    const salesCents = Math.round(
      sales.reduce((sum, row) => sum + amount(value(row, "Total_Bill_Amount")), 0) * 100,
    );
    const purchaseCents = Math.round(
      purchases.reduce((sum, row) => sum + amount(value(row, "Total_Purchase_Amt")), 0) * 100,
    );

    expect(saleBills.size).toBe(168);
    expect([...saleBills.values()].filter((modes) => modes.size > 1)).toHaveLength(1);
    expect(receipts.size).toBe(59);
    expect(salesCents).toBe(599_299);
    expect(purchaseCents).toBe(27_652_419);
    expect(
      sales.reduce(
        (sum, row) => sum + amount(value(row, "Qty_Sold")) * amount(value(row, "Unit_Avg_Cost")),
        0,
      ),
    ).toBeCloseTo(4313.295238, 5);
  });

  it("does not mistake rack locations for store locations or create a false stock adjustment", () => {
    for (const [sheetName, headerRow] of Object.entries(RETAILFLOW_WORKBOOK_HEADER_ROWS)) {
      const sheet =
        workbook.Sheets[
          RETAILFLOW_WORKBOOK_SHEETS[sheetName as keyof typeof RETAILFLOW_WORKBOOK_SHEETS]
        ];
      if (!sheet) throw new Error(`Workbook is missing the ${sheetName} source sheet.`);
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: true,
        defval: null,
      }) as unknown[][];
      const headers = (rows[headerRow] ?? []).map((item) => String(item ?? "").trim());
      expect(headers.filter(isWorkbookLocationColumn)).toEqual([]);
    }

    const skuKey = (row: SourceRow) => stringValue(value(row, "SKU_Number")).toLowerCase();
    const master = new Map(products.map((row) => [skuKey(row), row]));
    const purchasesBySku = new Map<string, number>();
    const salesBySku = new Map<string, number>();
    for (const row of purchases) {
      const key = stringValue(value(row, "Barcode_SKU")).toLowerCase();
      purchasesBySku.set(key, (purchasesBySku.get(key) ?? 0) + amount(value(row, "Qty_Bought")));
    }
    for (const row of sales) {
      const key = stringValue(value(row, "Barcode_SKU")).toLowerCase();
      salesBySku.set(key, (salesBySku.get(key) ?? 0) + amount(value(row, "Qty_Sold")));
    }

    const variances = [...master].flatMap(([sku, row]) => {
      const delta =
        amount(value(row, "Current_Stock")) -
        amount(value(row, "Opening_Stock")) -
        (purchasesBySku.get(sku) ?? 0) +
        (salesBySku.get(sku) ?? 0);
      return Math.abs(delta) > 0.001 ? [delta] : [];
    });

    expect(
      sales.every((row) => master.has(stringValue(value(row, "Barcode_SKU")).toLowerCase())),
    ).toBe(true);
    expect(
      purchases.every((row) => master.has(stringValue(value(row, "Barcode_SKU")).toLowerCase())),
    ).toBe(true);
    expect(variances).toEqual([]);
  });
});
