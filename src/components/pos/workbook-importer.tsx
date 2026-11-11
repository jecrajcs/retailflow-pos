import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/pos/data-table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { refreshLocalReplica } from "@/lib/offline-sync";
import { retailApi, userFacingError } from "@/lib/retail-api";
import { useAccess } from "@/lib/access";
import { useProducts, type Product } from "@/lib/pos";

type ImportLocation = { id: string; name: string; code: string; type: string };
type SourceRow = {
  sheet_name: string;
  source_key: string;
  row_number: number;
  entity_type: string;
  entity_id: string;
  source_payload: Record<string, unknown>;
};
type ImportPayload = {
  products: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
  purchases: Array<Record<string, unknown>>;
  sales: Array<Record<string, unknown>>;
  movements: Array<Record<string, unknown>>;
  adjustments: Array<Record<string, unknown>>;
  source_rows: SourceRow[];
};
type CustomerMatch = {
  billId: string;
  billNumber: string;
  sourceName: string;
  candidates: Array<{ id: string; name: string; mobile: string | null }>;
};
type Preview = {
  payload: ImportPayload;
  batchKey: string;
  counts: Record<string, number>;
  anomalies: string[];
  blockingAnomalies: string[];
  mixedBills: string[];
  customerMatches: CustomerMatch[];
  varianceCount: number;
  adjustmentTotal: number;
  draftCandidates: string[];
};

const SHEETS = {
  sales: "2_Sales_Billing",
  customers: "4_Customer_Master",
  purchases: "5_Purchase_Entry",
  products: "6_Master_Stock",
} as const;

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return String(value).trim();
}

function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = text(value).replace(/[₹,\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNumericSource(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);
  const normalized = text(value).replace(/[₹,\s]/g, "");
  return !!normalized && Number.isFinite(Number(normalized));
}

function normalizeMobile(value: unknown) {
  const raw = text(value);
  if (!raw || raw === "-" || raw.toLowerCase() === "walk-in") return "";
  return raw
    .replace(/\.0$/, "")
    .replace(/\D/g, "")
    .replace(/^91(?=\d{10}$)/, "");
}

function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + Math.round(value) * 86400000).toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return "";
  const dayFirst = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    let year = Number(dayFirst[3]);
    if (year < 100) year += 2000;
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    return parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === month - 1 &&
      parsedDate.getUTCDate() === day
      ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : "";
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function recordsFromSheet(
  XLSX: typeof import("xlsx"),
  sheet: import("xlsx").WorkSheet | undefined,
  headerIndex: number,
) {
  if (!sheet) return [] as Array<{ rowNumber: number; row: Record<string, unknown> }>;
  const data = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const header = data[headerIndex] ?? [];
  const headers = header.map((value) => text(value));
  return data.slice(headerIndex + 1).flatMap((cells, index) => {
    const row = Object.fromEntries(
      headers.flatMap((name, column) => (name ? [[name, cells[column] ?? null]] : [])),
    );
    return Object.values(row).some((value) => value !== null && value !== "")
      ? [{ rowNumber: headerIndex + index + 2, row }]
      : [];
  });
}

function field(row: Record<string, unknown>, key: string) {
  const wanted = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const entry = Object.entries(row).find(
    ([name]) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted,
  );
  return entry?.[1] ?? null;
}

function productFromMaster(row: Record<string, unknown>, id: string) {
  const sku = text(field(row, "SKU_Number"));
  const name = text(field(row, "Product_Name"));
  const salePrice = number(field(row, "Standard_Sell_Price"));
  return {
    id,
    name,
    name_hi: null,
    search_aliases: [text(field(row, "Full_Item_Name"))].filter(Boolean),
    sku,
    barcode: null,
    hsn: null,
    category: text(field(row, "Category")) || null,
    variant: text(field(row, "Variant_Spec")) || null,
    rack_location: text(field(row, "Rack_Location")) || null,
    preferred_supplier: text(field(row, "Preferred_Supplier")) || null,
    purchase_cost: number(field(row, "Avg_Buy_Price")) || number(field(row, "Last_Buy_Price")),
    mrp: number(field(row, "MRP")),
    sale_price: salePrice,
    min_sale_price: Math.min(number(field(row, "Min_Selling_Price")), salePrice),
    price_tiers: [],
    uom_purchase: text(field(row, "Unit")) || "Pcs",
    uom_stock: text(field(row, "Unit")) || "Pcs",
    uom_sale: text(field(row, "Unit")) || "Pcs",
    conversion_factor: 1,
    min_stock: number(field(row, "Min_Stock_Limit")),
    is_loose: false,
    enrichment_status: "PENDING",
  };
}

function paymentMode(value: unknown) {
  const mode = text(value)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (["CASH", "CASHPAID"].includes(mode)) return "CASH";
  if (["UPI", "GPAY", "PHONEPE", "PAYTM"].includes(mode)) return "UPI";
  if (["CREDIT", "UDHAR", "ACCOUNT", "DUE"].includes(mode)) return "CREDIT";
  return "";
}

async function hashFile(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function WorkbookImporter({ locations }: { locations: ImportLocation[] }) {
  const { profile, online } = useAccess();
  const { data: existingProducts = [] } = useProducts();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [sourceSheet, setSourceSheet] = useState("all");
  const [ackMixed, setAckMixed] = useState(false);
  const [ackAdjustments, setAckAdjustments] = useState(false);
  const [busy, setBusy] = useState(false);

  async function readWorkbook(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setPreview(null);
    setSourceSheet("all");
    setAckMixed(false);
    setAckAdjustments(false);
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const productsSource = recordsFromSheet(XLSX, workbook.Sheets[SHEETS.products], 0);
      const customersSource = recordsFromSheet(XLSX, workbook.Sheets[SHEETS.customers], 3);
      const salesSource = recordsFromSheet(XLSX, workbook.Sheets[SHEETS.sales], 0);
      const purchasesSource = recordsFromSheet(XLSX, workbook.Sheets[SHEETS.purchases], 0);
      if (
        !productsSource.length ||
        !customersSource.length ||
        !salesSource.length ||
        !purchasesSource.length
      )
        throw new Error(
          "The workbook must contain Master Stock, Customer Master, Sales Billing, and Purchase Entry sheets.",
        );

      const productBySku = new Map<string, Record<string, unknown>>();
      const existingBySku = new Map<string, Product[]>();
      for (const product of existingProducts) {
        const key = product.sku?.toLowerCase();
        if (key) existingBySku.set(key, [...(existingBySku.get(key) ?? []), product]);
      }
      const payload: ImportPayload = {
        products: [],
        customers: [],
        purchases: [],
        sales: [],
        movements: [],
        adjustments: [],
        source_rows: [],
      };
      const anomalies: string[] = [];
      const blockingAnomalies: string[] = [];
      const addBlockingAnomaly = (message: string) => {
        anomalies.push(message);
        blockingAnomalies.push(message);
      };
      const productMasterRows = new Map<string, Record<string, unknown>>();
      const productIdBySku = new Map<string, string>();
      const productRowSources = new Map<
        string,
        { rowNumber: number; row: Record<string, unknown>; sheetName: string }
      >();

      for (const source of productsSource) {
        const sku = text(field(source.row, "SKU_Number"));
        if (!sku) {
          addBlockingAnomaly(`Master Stock row ${source.rowNumber} is missing its SKU.`);
          continue;
        }
        if (
          !isNumericSource(field(source.row, "Opening_Stock")) ||
          !isNumericSource(field(source.row, "Standard_Sell_Price"))
        ) {
          addBlockingAnomaly(
            `Master Stock row ${source.rowNumber} has an invalid opening quantity or retail price.`,
          );
        }
        if (number(field(source.row, "Opening_Stock")) < 0)
          addBlockingAnomaly(`Master Stock row ${source.rowNumber} has negative opening stock.`);
        const key = sku.toLowerCase();
        if (productMasterRows.has(key)) {
          addBlockingAnomaly(`Master Stock has duplicate SKU ${sku} at row ${source.rowNumber}.`);
          continue;
        }
        productMasterRows.set(key, source.row);
        productRowSources.set(key, { ...source, sheetName: SHEETS.products });
      }
      for (const [sheetName, sources] of [
        [SHEETS.purchases, purchasesSource],
        [SHEETS.sales, salesSource],
      ] as const)
        for (const source of sources) {
          const sku = text(field(source.row, "Barcode_SKU"));
          const key = sku.toLowerCase();
          if (!sku || productMasterRows.has(key)) continue;
          const candidate = {
            SKU_Number: sku,
            Product_Name: field(source.row, "Product_Name") ?? field(source.row, "Full_Item_Name"),
            Variant_Spec: field(source.row, "Variant_Spec"),
            Category: field(source.row, "Category"),
            Unit: field(source.row, "Unit") ?? "Pcs",
            Rack_Location: field(source.row, "Rack_Location"),
            Avg_Buy_Price:
              field(source.row, "Unit_Landing_Cost") ?? field(source.row, "Unit_Avg_Cost"),
            MRP: field(source.row, "MRP"),
            Standard_Sell_Price:
              field(source.row, "Standard_Sell_Price") ?? field(source.row, "Actual_Sell_Price"),
            Min_Selling_Price:
              field(source.row, "Min_Selling_Price") ?? field(source.row, "Min_Allowed_Rate"),
            Min_Stock_Limit: field(source.row, "Min_Stock_Limit"),
          };
          if (!text(candidate["Product_Name"]) || number(candidate["Standard_Sell_Price"]) <= 0) {
            addBlockingAnomaly(
              `SKU ${sku} from row ${source.rowNumber} needs a product name and retail price.`,
            );
            continue;
          }
          productMasterRows.set(key, candidate);
          productRowSources.set(key, { ...source, sheetName });
        }

      for (const [key, sourceRow] of productMasterRows) {
        const sku = text(field(sourceRow, "SKU_Number"));
        const matches = existingBySku.get(key) ?? [];
        if (matches.length > 1) {
          addBlockingAnomaly(
            `SKU ${sku} matches more than one existing catalog record; resolve the duplicate SKU before import.`,
          );
          continue;
        }
        const id = matches[0]?.id ?? crypto.randomUUID();
        productIdBySku.set(key, id);
        const product = productFromMaster(sourceRow, id);
        if (!product.name || product.sale_price <= 0)
          addBlockingAnomaly(`SKU ${sku} needs a name and retail price.`);
        payload.products.push(product);
        const source = productRowSources.get(key);
        if (source)
          payload.source_rows.push({
            sheet_name: source.sheetName,
            source_key: `SKU:${sku}`,
            row_number: source.rowNumber,
            entity_type: "product",
            entity_id: id,
            source_payload: source.row,
          });
        const opening = number(field(sourceRow, "Opening_Stock"));
        if (opening > 0)
          payload.movements.push({
            id: crypto.randomUUID(),
            product_id: id,
            location_id: "",
            movement_type: "OPENING",
            quantity_delta: opening,
            created_at: new Date().toISOString(),
            reference: `Workbook opening stock ${sku}`,
          });
      }

      const customerSegmentById = new Map<string, string | null>();
      const importedCustomers: Array<{ id: string; name: string; mobile: string | null }> = [];
      const importedCustomerSourceIds = new Set<string>();
      for (const source of customersSource) {
        const externalId = text(field(source.row, "Customer ID"));
        const name = text(field(source.row, "Customer Name"));
        if (!name || !externalId) {
          addBlockingAnomaly(
            `Customer Master row ${source.rowNumber} is missing its source ID or name.`,
          );
          continue;
        }
        if (importedCustomerSourceIds.has(externalId)) {
          addBlockingAnomaly(
            `Customer Master has duplicate source ID ${externalId} at row ${source.rowNumber}.`,
          );
          continue;
        }
        importedCustomerSourceIds.add(externalId);
        const id = crypto.randomUUID();
        const mobile = normalizeMobile(field(source.row, "Mobile Number")) || null;
        const segment = text(field(source.row, "Customer Segment")) || null;
        importedCustomers.push({ id, name, mobile });
        customerSegmentById.set(id, segment);
        payload.customers.push({
          id,
          name,
          mobile,
          segment,
          age_group: text(field(source.row, "Buyer_Age_Group")) || null,
          gender: text(field(source.row, "Buyer_Gender")) || null,
          credit_limit: 0,
          outstanding_balance: number(field(source.row, "Udhar / Credit Due")),
          visits: number(field(source.row, "Total Visits")),
        });
        payload.source_rows.push({
          sheet_name: SHEETS.customers,
          source_key: `CUSTOMER:${externalId}`,
          row_number: source.rowNumber,
          entity_type: "customer",
          entity_id: id,
          source_payload: source.row,
        });
      }

      const purchaseGroups = new Map<
        string,
        {
          id: string;
          supplier: string;
          invoice: string;
          date: string;
          items: Array<Record<string, unknown>>;
          lineRows: Array<{ rowNumber: number; row: Record<string, unknown> }>;
          total: number;
        }
      >();
      const purchaseQtyBySku = new Map<string, number>();
      for (const source of purchasesSource) {
        const sku = text(field(source.row, "Barcode_SKU"));
        const productId = productIdBySku.get(sku.toLowerCase());
        const qty = number(field(source.row, "Qty_Bought"));
        const cost = number(field(source.row, "Unit_Landing_Cost"));
        const sourceTotal = number(field(source.row, "Total_Purchase_Amt"));
        const supplier = text(field(source.row, "Supplier_Name"));
        const invoice = text(field(source.row, "Bill_Invoice_No"));
        const receiptDate = dateValue(field(source.row, "Date"));
        if (
          !productId ||
          qty <= 0 ||
          !isNumericSource(field(source.row, "Unit_Landing_Cost")) ||
          cost < 0 ||
          !receiptDate ||
          !supplier ||
          !invoice
        ) {
          addBlockingAnomaly(
            `Purchase row ${source.rowNumber} has an unknown SKU, invalid quantity/cost, or missing supplier, invoice number, or date.`,
          );
          continue;
        }
        if (!isNumericSource(field(source.row, "Total_Purchase_Amt"))) {
          addBlockingAnomaly(`Purchase row ${source.rowNumber} is missing its source line total.`);
          continue;
        }
        if (Math.abs(qty * cost - sourceTotal) > 0.01)
          anomalies.push(
            `Purchase row ${source.rowNumber} source total ${sourceTotal} differs from quantity × cost ${qty * cost}. Source total will be retained.`,
          );
        const key = `${supplier.toLowerCase()}|${invoice.toLowerCase()}`;
        const group = purchaseGroups.get(key) ?? {
          id: crypto.randomUUID(),
          supplier,
          invoice,
          date: receiptDate,
          items: [],
          lineRows: [],
          total: 0,
        };
        const itemId = crypto.randomUUID();
        group.items.push({
          id: itemId,
          product_id: productId,
          quantity: qty,
          unit_cost: cost,
          source_total: sourceTotal,
        });
        group.lineRows.push(source);
        group.total += sourceTotal;
        purchaseGroups.set(key, group);
        purchaseQtyBySku.set(
          sku.toLowerCase(),
          (purchaseQtyBySku.get(sku.toLowerCase()) ?? 0) + qty,
        );
        payload.movements.push({
          id: crypto.randomUUID(),
          product_id: productId,
          location_id: "",
          movement_type: "PURCHASE",
          quantity_delta: qty,
          created_at: `${receiptDate}T12:00:00.000Z`,
          reference: `${supplier} · ${invoice}`,
        });
      }
      for (const group of purchaseGroups.values()) {
        const receiptId = group.id;
        payload.purchases.push({
          id: receiptId,
          supplier_name: group.supplier,
          supplier_invoice_number: group.invoice,
          invoice_date: group.date,
          warehouse_location_id: "",
          status: "RECEIVED",
          attachment_path: null,
          ocr_text: null,
          received_at: `${group.date}T12:00:00.000Z`,
          created_at: `${group.date}T12:00:00.000Z`,
          source_total: group.total,
          items: group.items,
        });
        group.lineRows.forEach((source) =>
          payload.source_rows.push({
            sheet_name: SHEETS.purchases,
            source_key: `ROW:${source.rowNumber}`,
            row_number: source.rowNumber,
            entity_type: "purchase_line",
            entity_id: receiptId,
            source_payload: source.row,
          }),
        );
      }

      const salesGroups = new Map<
        string,
        {
          id: string;
          billNumber: string;
          date: string;
          items: Array<Record<string, unknown>>;
          modes: Map<string, number>;
          lineRows: Array<{ rowNumber: number; row: Record<string, unknown> }>;
          sourceName: string;
          mobile: string;
          orderType: string;
          segment: string | null;
          candidates: CustomerMatch["candidates"];
          customerId: string | null;
          total: number;
        }
      >();
      const saleQtyBySku = new Map<string, number>();
      for (const source of salesSource) {
        const sku = text(field(source.row, "Barcode_SKU"));
        const productId = productIdBySku.get(sku.toLowerCase());
        const qty = number(field(source.row, "Qty_Sold"));
        const rate = number(field(source.row, "Actual_Sell_Price"));
        const sourceTotal = number(field(source.row, "Total_Bill_Amount"));
        const billNumber = text(field(source.row, "Bill_No"));
        if (
          !productId ||
          !billNumber ||
          qty <= 0 ||
          rate <= 0 ||
          !isNumericSource(field(source.row, "Actual_Sell_Price")) ||
          !isNumericSource(field(source.row, "Total_Bill_Amount"))
        ) {
          addBlockingAnomaly(
            `Sales row ${source.rowNumber} has an unknown SKU, bill number, quantity, sell price, or source total.`,
          );
          continue;
        }
        const billDate = dateValue(field(source.row, "Date"));
        if (!billDate) {
          addBlockingAnomaly(`Sales row ${source.rowNumber} is missing a valid bill date.`);
          continue;
        }
        if (Math.abs(qty * rate - sourceTotal) > 0.01)
          anomalies.push(
            `Sales row ${source.rowNumber} source total ${sourceTotal} differs from quantity × sell price ${qty * rate}. Source total will be retained.`,
          );
        const standardRate = number(field(source.row, "Standard_Rate"));
        const minimumRate = number(field(source.row, "Min_Allowed_Rate"));
        if ((minimumRate > 0 && rate < minimumRate) || (standardRate > 0 && rate > standardRate))
          anomalies.push(
            `Sales row ${source.rowNumber} sell rate ${rate} is outside source min/standard rates (${minimumRate}–${standardRate}). Historical rate will be retained.`,
          );
        const sourceProfit = number(field(source.row, "Gross_Profit_Loss"));
        const derivedProfit = sourceTotal - qty * number(field(source.row, "Unit_Avg_Cost"));
        if (Math.abs(sourceProfit - derivedProfit) > 0.01)
          anomalies.push(
            `Sales row ${source.rowNumber} source gross profit ${sourceProfit} differs from the cost snapshot calculation ${derivedProfit}. Both source sale and cost values will be retained.`,
          );
        const rawMode = field(source.row, "Payment_Mode");
        const mode = paymentMode(rawMode);
        if (!mode)
          addBlockingAnomaly(
            `Sales row ${source.rowNumber} has an unsupported payment mode: ${text(rawMode)}.`,
          );
        const rawOrder = text(field(source.row, "Customer_Order_Type"));
        const key = `${billDate}|${billNumber.toLowerCase()}`;
        const group = salesGroups.get(key) ?? {
          id: crypto.randomUUID(),
          billNumber: `WB-${billDate.replace(/-/g, "")}-${billNumber}`,
          date: billDate,
          items: [],
          modes: new Map<string, number>(),
          lineRows: [],
          sourceName: text(field(source.row, "Customer_Name")),
          mobile: normalizeMobile(field(source.row, "Customer_Mobile")),
          orderType: rawOrder || "Walk-in",
          segment: null,
          candidates: [],
          customerId: null,
          total: 0,
        };
        const itemId = crypto.randomUUID();
        group.items.push({
          id: itemId,
          product_id: productId,
          quantity: qty,
          unit_price: rate,
          uom: text(field(source.row, "Unit")) || "Pcs",
          discount: 0,
          total: sourceTotal,
          unit_cost_snapshot: number(field(source.row, "Unit_Avg_Cost")),
        });
        if (mode) group.modes.set(mode, (group.modes.get(mode) ?? 0) + sourceTotal);
        group.lineRows.push(source);
        group.total += sourceTotal;
        salesGroups.set(key, group);
        saleQtyBySku.set(sku.toLowerCase(), (saleQtyBySku.get(sku.toLowerCase()) ?? 0) + qty);
      }

      const customerMatches: CustomerMatch[] = [];
      const mixedBills: string[] = [];
      for (const [key, group] of salesGroups) {
        const isWalkIn =
          group.orderType.toLowerCase().includes("walk-in") ||
          group.sourceName.toLowerCase().includes("walk-in");
        const candidatesByMobile =
          isWalkIn || !group.mobile
            ? []
            : importedCustomers.filter((customer) => customer.mobile === group.mobile);
        const exactMobileNameMatches = candidatesByMobile.filter(
          (customer) => customer.name.toLowerCase() === group.sourceName.toLowerCase(),
        );
        const exactNameMatches = isWalkIn
          ? []
          : importedCustomers.filter(
              (customer) => customer.name.toLowerCase() === group.sourceName.toLowerCase(),
            );
        const nameMatches = exactMobileNameMatches.length
          ? exactMobileNameMatches
          : exactNameMatches;
        const candidateRows = candidatesByMobile.length
          ? exactMobileNameMatches.length
            ? exactMobileNameMatches
            : candidatesByMobile
          : exactNameMatches;
        group.candidates = candidateRows.map(({ id, name, mobile }) => ({ id, name, mobile }));
        const safeExactNameMatch =
          exactMobileNameMatches.length === 1 || (!group.mobile && exactNameMatches.length === 1);
        if (safeExactNameMatch) {
          group.customerId = nameMatches[0]!.id;
          group.segment = customerSegmentById.get(group.customerId) ?? null;
        } else if (!isWalkIn && group.candidates.length > 0)
          customerMatches.push({
            billId: group.id,
            billNumber: group.billNumber,
            sourceName: group.sourceName,
            candidates: group.candidates,
          });
        if (group.modes.size > 1) mixedBills.push(group.billNumber);
        const payments = [...group.modes].map(([mode, amount]) => ({
          id: crypto.randomUUID(),
          amount,
          mode,
          created_at: `${group.date}T12:00:00.000Z`,
        }));
        const credit = group.modes.get("CREDIT") ?? 0;
        const paid = group.total - credit;
        const invoiceId = group.id;
        payload.sales.push({
          id: invoiceId,
          invoice_number: group.billNumber,
          location_id: "",
          customer_id: group.customerId,
          customer_segment: group.segment,
          order_type: group.orderType,
          total_amount: group.total,
          discount_amount: 0,
          paid_amount: paid,
          balance_amount: credit,
          payment_status: credit <= 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "UNPAID",
          invoice_status: "COMPLETED",
          business_date: group.date,
          created_at: `${group.date}T12:00:00.000Z`,
          updated_at: `${group.date}T12:00:00.000Z`,
          cashier_id: null,
          cashier_name: "Workbook import",
          items: group.items,
          payments,
        });
        group.lineRows.forEach((source) =>
          payload.source_rows.push({
            sheet_name: SHEETS.sales,
            source_key: `ROW:${source.rowNumber}`,
            row_number: source.rowNumber,
            entity_type: "sale_line",
            entity_id: invoiceId,
            source_payload: source.row,
          }),
        );
        group.items.forEach((item) =>
          payload.movements.push({
            id: crypto.randomUUID(),
            product_id: item["product_id"],
            location_id: "",
            movement_type: "SALE",
            quantity_delta: -number(item["quantity"]),
            created_at: `${group.date}T12:00:00.000Z`,
            reference: `Workbook bill ${group.billNumber}`,
          }),
        );
      }

      const varianceRows: Array<{ sku: string; productId: string; delta: number }> = [];
      for (const [key, sourceRow] of productMasterRows) {
        const productId = productIdBySku.get(key);
        if (!productId) continue;
        const opening = number(field(sourceRow, "Opening_Stock"));
        const current = number(field(sourceRow, "Current_Stock"));
        const projection =
          opening + (purchaseQtyBySku.get(key) ?? 0) - (saleQtyBySku.get(key) ?? 0);
        const delta = Math.round((current - projection) * 1000) / 1000;
        if (Math.abs(delta) > 0.001)
          varianceRows.push({ sku: text(field(sourceRow, "SKU_Number")), productId, delta });
      }
      varianceRows.forEach((variance) => {
        const adjustmentId = crypto.randomUUID();
        payload.adjustments.push({
          id: adjustmentId,
          product_id: variance.productId,
          location_id: "",
          quantity: variance.delta,
          reason: "IMPORT_VARIANCE_APPROVED",
          returnable_to_vendor: false,
          cost_loss: 0,
        });
        payload.movements.push({
          id: crypto.randomUUID(),
          product_id: variance.productId,
          location_id: "",
          movement_type: "ADJUSTMENT",
          quantity_delta: variance.delta,
          created_at: new Date().toISOString(),
          reference: `Approved workbook variance · ${variance.sku}`,
          adjustment_id: adjustmentId,
        });
        anomalies.push(
          `Current_Stock differs from the movement projection for ${variance.sku} by ${variance.delta > 0 ? "+" : ""}${variance.delta}. An audited adjustment will be created only after approval.`,
        );
      });

      const draftCandidates = ["1_Bill_Invoice_Generator", "Purchase_Inward_Voucher"].filter(
        (name) => workbook.Sheets[name],
      );
      setPreview({
        payload,
        batchKey: await hashFile(buffer),
        counts: {
          products: payload.products.length,
          customers: payload.customers.length,
          sales: payload.sales.length,
          saleLines: salesSource.length,
          purchases: payload.purchases.length,
          purchaseLines: purchasesSource.length,
        },
        anomalies,
        blockingAnomalies,
        mixedBills,
        customerMatches,
        varianceCount: varianceRows.length,
        adjustmentTotal: varianceRows.reduce((sum, row) => sum + row.delta, 0),
        draftCandidates,
      });
      setFileName(file.name);
      toast.success("Workbook preview is ready", {
        description: "No business data has been imported yet.",
      });
    } catch (error) {
      toast.error("Could not preview this workbook", {
        description: userFacingError(
          error,
          "Select the supplied RetailFlow workbook and try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  function chooseCustomer(billId: string, customerId: string) {
    if (!preview) return;
    const customer = preview.payload.customers.find((row) => row["id"] === customerId);
    setPreview({
      ...preview,
      payload: {
        ...preview.payload,
        sales: preview.payload.sales.map((sale) =>
          sale["id"] === billId
            ? {
                ...sale,
                customer_id: customerId || null,
                customer_segment: customer?.["segment"] ?? null,
              }
            : sale,
        ),
      },
      customerMatches: preview.customerMatches.filter((match) => match.billId !== billId),
    });
  }

  async function commit() {
    if (
      !preview ||
      !profile ||
      !locationId ||
      !online ||
      busy ||
      preview.customerMatches.length ||
      (preview.mixedBills.length > 0 && !ackMixed) ||
      (preview.varianceCount > 0 && !ackAdjustments) ||
      preview.blockingAnomalies.length > 0
    )
      return;
    setBusy(true);
    try {
      const payload: ImportPayload = {
        ...preview.payload,
        purchases: preview.payload.purchases.map((receipt) => ({
          ...receipt,
          warehouse_location_id: locationId,
        })),
        sales: preview.payload.sales.map((sale) => ({ ...sale, location_id: locationId })),
        movements: preview.payload.movements.map((movement) => ({
          ...movement,
          location_id: locationId,
        })),
        adjustments: preview.payload.adjustments.map((adjustment) => ({
          ...adjustment,
          location_id: locationId,
        })),
      };
      const result = await retailApi<{ ok: boolean; duplicate?: boolean }>(
        "/api/retail-workbook-import",
        {
          method: "POST",
          json: {
            batch_key: preview.batchKey,
            source_file_name: fileName,
            location_mapping: { business_location_id: locationId },
            summary: {
              ...preview.counts,
              mixed_payment_reviewed: preview.mixedBills.length === 0 || ackMixed,
              stock_adjustments_approved: preview.varianceCount === 0 || ackAdjustments,
            },
            payload,
          },
        },
      );
      await refreshLocalReplica();
      await Promise.all(
        ["products", "customers", "sales", "inventory", "purchases"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      toast.success(result.duplicate ? "Workbook was already imported" : "Workbook imported", {
        description: result.duplicate
          ? "The existing batch was kept unchanged and this device’s local records were refreshed."
          : `${preview.counts["products"]} products, ${preview.counts["customers"]} customers, ${preview.counts["sales"]} bills, and ${preview.counts["purchases"]} receipts committed.`,
      });
      setPreview(null);
      setFileName("");
    } catch (error) {
      toast.error("Workbook import was not committed", {
        description: userFacingError(
          error,
          "Resolve the preview issues and retry. The server applies the batch atomically.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  const blockingAnomaly = !!preview?.blockingAnomalies.length;
  const canImport =
    !!preview &&
    !!profile &&
    ["MANAGER", "ADMIN"].includes(profile.role) &&
    !!locationId &&
    online &&
    !busy &&
    !blockingAnomaly &&
    preview.customerMatches.length === 0 &&
    (!preview.mixedBills.length || ackMixed) &&
    (!preview.varianceCount || ackAdjustments);
  const visibleSourceRows =
    preview?.payload.source_rows.filter(
      (row) => sourceSheet === "all" || row.sheet_name === sourceSheet,
    ) ?? [];

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="mt-1 h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">RetailFlow workbook migration</h2>
            <p className="text-sm text-muted-foreground">
              Preview source sheets locally, resolve review items, then commit the full batch once.
            </p>
          </div>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" />
          {busy ? "Reading…" : "Choose workbook"}
          <input
            className="sr-only"
            type="file"
            accept=".xlsx,.xls"
            disabled={busy}
            onChange={(event) => void readWorkbook(event.target.files?.[0])}
          />
        </label>
      </header>
      {preview && (
        <div className="space-y-4 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">{fileName}</div>
              <div className="text-xs text-muted-foreground">
                File fingerprint {preview.batchKey.slice(0, 16)}… · duplicate uploads are rejected
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Local preview only
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {Object.entries(preview.counts).map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs capitalize text-muted-foreground">
                  {label.replace(/([A-Z])/g, " $1")}
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Source rows</h3>
                <p className="text-xs text-muted-foreground">
                  Search and inspect imported catalog, customer, sales, and purchase lines before
                  committing.
                </p>
              </div>
              <SearchableSelect
                className="w-full sm:w-72"
                value={sourceSheet}
                onValueChange={setSourceSheet}
                placeholder="Filter source sheet"
                options={[
                  { value: "all", label: "All source sheets" },
                  { value: SHEETS.products, label: "Master Stock" },
                  { value: SHEETS.customers, label: "Customer Master" },
                  { value: SHEETS.sales, label: "Sales Billing" },
                  { value: SHEETS.purchases, label: "Purchase Entry" },
                ]}
              />
            </div>
            <DataTable<SourceRow>
              rows={visibleSourceRows}
              getRowId={(row) => `${row.sheet_name}:${row.source_key}`}
              resetKey={sourceSheet}
              searchPlaceholder="Search source values, SKU, customer or invoice…"
              emptyMessage="No source rows match this search."
              tableHeightClass="max-h-[40dvh]"
              columns={[
                { id: "sheet", header: "Source sheet", accessor: (row) => row.sheet_name },
                {
                  id: "row",
                  header: "Row",
                  accessor: (row) => row.row_number,
                },
                { id: "type", header: "Record type", accessor: (row) => row.entity_type },
                { id: "key", header: "Source key", accessor: (row) => row.source_key },
                {
                  id: "source_fields",
                  header: "Source values",
                  accessor: (row) => JSON.stringify(row.source_payload),
                  cell: (row) => {
                    const fields = Object.entries(row.source_payload)
                      .filter(([, value]) => value !== null && value !== "")
                      .slice(0, 6)
                      .map(([key, value]) => `${key}: ${String(value)}`)
                      .join(" · ");
                    return (
                      <div className="max-w-[36rem]">
                        <span className="block truncate" title={fields}>
                          {fields || "—"}
                        </span>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-primary">
                            Inspect full source row
                          </summary>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                            {JSON.stringify(row.source_payload, null, 2)}
                          </pre>
                        </details>
                      </div>
                    );
                  },
                },
              ]}
            />
          </div>
          <div className="max-w-md space-y-1">
            <Label>Workbook destination location *</Label>
            <SearchableSelect
              value={locationId}
              onValueChange={setLocationId}
              placeholder="Select the location represented by this workbook"
              options={locations.map((location) => ({
                value: location.id,
                label: `${location.code} · ${location.name}`,
                keywords: [location.type],
              }))}
            />
            <p className="text-xs text-muted-foreground">
              The workbook has no location column, so all historical stock, receipts, and sales will
              map to this location. The server checks for existing stock and matching bills or
              supplier invoices before committing to prevent duplicate migration data.
            </p>
          </div>
          {preview.customerMatches.length > 0 && (
            <div className="space-y-2 rounded-lg border border-warning/50 bg-warning/5 p-3">
              <h3 className="text-sm font-medium">Resolve sales customer matches</h3>
              {preview.customerMatches.map((match) => (
                <div
                  key={match.billId}
                  className="grid gap-2 sm:grid-cols-[1fr_1fr] sm:items-center"
                >
                  <p className="text-xs">
                    Bill {match.billNumber} · {match.sourceName || "Customer not recorded"}
                  </p>
                  <SearchableSelect
                    value=""
                    onValueChange={(value) =>
                      chooseCustomer(match.billId, value === "NO_CUSTOMER" ? "" : value)
                    }
                    placeholder="Choose a Customer Master record"
                    options={[
                      { value: "NO_CUSTOMER", label: "Import without customer" },
                      ...match.candidates.map((candidate) => ({
                        value: candidate.id,
                        label: `${candidate.name}${candidate.mobile ? ` · ${candidate.mobile}` : ""}`,
                      })),
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
          {preview.mixedBills.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                checked={ackMixed}
                onChange={(event) => setAckMixed(event.target.checked)}
              />
              <span>
                Review mixed payment mode bills ({preview.mixedBills.join(", ")}). Source line
                amounts will be grouped by CASH, UPI, and CREDIT.
              </span>
            </label>
          )}
          {preview.varianceCount > 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm">
              <input
                type="checkbox"
                checked={ackAdjustments}
                onChange={(event) => setAckAdjustments(event.target.checked)}
              />
              <span>
                Approve {preview.varianceCount} audited stock adjustment(s), net{" "}
                {preview.adjustmentTotal > 0 ? "+" : ""}
                {preview.adjustmentTotal}. Current_Stock is validation data; it will not be imported
                as another stock movement.
              </span>
            </label>
          )}
          {preview.anomalies.length > 0 && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Review validation issues ({preview.anomalies.length}) ·{" "}
                {preview.blockingAnomalies.length} block import
              </summary>
              <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-auto pl-5 text-xs text-muted-foreground">
                {preview.anomalies.slice(0, 200).map((issue, index) => (
                  <li key={`${index}-${issue}`}>{issue}</li>
                ))}
              </ul>
            </details>
          )}
          {preview.draftCandidates.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Optional draft candidates found: {preview.draftCandidates.join(", ")}. They are
              excluded from this import.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {online
                ? "Online Manager/Admin approval is required to commit."
                : "Reconnect before committing the batch."}
            </p>
            <Button onClick={() => void commit()} disabled={!canImport}>
              {busy ? "Committing…" : "Commit reviewed batch"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
