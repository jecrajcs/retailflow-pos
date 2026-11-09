import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commitLocalOperation,
  getAllLocal,
  getDeviceId,
  getLocal,
  nextLocalSequence,
  subscribeLocalChanges,
  type KeyedRecord,
  type LocalStoreName,
  type SyncStatus,
} from "@/lib/local-db";

export interface Location {
  id: string;
  name: string;
  code: string;
  type: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
}

export interface Product {
  id: string;
  name: string;
  name_hi?: string | null;
  search_aliases?: string[] | null;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  category: string | null;
  variant: string | null;
  rack_location: string | null;
  purchase_cost: number;
  mrp: number;
  sale_price: number;
  price_tiers?: ProductPriceTier[];
  min_sale_price: number;
  uom_purchase: string;
  uom_stock: string;
  uom_sale: string;
  conversion_factor: number;
  min_stock: number;
  is_loose: boolean;
  enrichment_status: string;
  preferred_supplier: string | null;
}

export interface ProductPriceTier {
  label: string;
  min_quantity: number;
  unit_price: number;
}

/** Return the most favorable quantity tier the current basket quantity qualifies for. */
export function getProductPrice(product: Product, quantity: number) {
  const tier = [...(product.price_tiers ?? [])]
    .filter(
      (candidate) =>
        candidate.min_quantity > 0 &&
        candidate.unit_price > 0 &&
        quantity >= candidate.min_quantity,
    )
    .sort((a, b) => b.min_quantity - a.min_quantity)[0];
  return { unitPrice: tier?.unit_price ?? product.sale_price, tier };
}

/** Excel/UI format: `6:68,12:64`; JSON arrays are also accepted for exported workbooks. */
export function parsePriceTiers(value: unknown): ProductPriceTier[] {
  if (Array.isArray(value)) {
    const tiers = value.map((entry) => {
      const row = entry as Partial<ProductPriceTier>;
      return {
        label: String(row.label ?? `${Number(row.min_quantity)}+ units`),
        min_quantity: Number(row.min_quantity),
        unit_price: Number(row.unit_price),
      };
    });
    return validatePriceTiers(tiers);
  }
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      return parsePriceTiers(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof Error && error.message.includes("price tier")) throw error;
      throw new Error("Price tiers must be quantity:price pairs, for example 6:68,12:64.");
    }
  }
  const tiers = text.split(/[,;\n]/).map((part) => {
    const match = part.trim().match(/^(\d+(?:\.\d+)?)\s*[:=]\s*(\d+(?:\.\d+)?)$/);
    if (!match) throw new Error("Enter quantity-based tiers like 6:68,12:64.");
    const min_quantity = Number(match[1]);
    return {
      label: `${min_quantity}+ units`,
      min_quantity,
      unit_price: Number(match[2]),
    };
  });
  return validatePriceTiers(tiers);
}

function validatePriceTiers(tiers: ProductPriceTier[]) {
  const sorted = tiers.sort((a, b) => a.min_quantity - b.min_quantity);
  if (
    sorted.some(
      (tier) =>
        !Number.isFinite(tier.min_quantity) ||
        tier.min_quantity <= 0 ||
        !Number.isFinite(tier.unit_price) ||
        tier.unit_price <= 0,
    )
  )
    throw new Error("Every price tier needs a positive minimum quantity and unit price.");
  if (new Set(sorted.map((tier) => tier.min_quantity)).size !== sorted.length)
    throw new Error("Each price tier must use a different minimum quantity.");
  if (sorted.some((tier, index) => index > 0 && tier.unit_price > sorted[index - 1]!.unit_price))
    throw new Error("A higher quantity tier cannot cost more per unit than the tier below it.");
  return sorted;
}

export function formatPriceTiers(tiers: ProductPriceTier[] | null | undefined) {
  return (tiers ?? []).map((tier) => `${tier.min_quantity}:${tier.unit_price}`).join(", ");
}

/** Internal Code 128 value derived from a unique local SKU; not a GS1-issued retail EAN. */
export function barcodeForSku(sku: string) {
  const value = `RF${sku.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
  return value.slice(0, 80);
}

export interface Customer {
  id: string;
  name: string;
  mobile: string | null;
  age_group: string | null;
  gender: string | null;
  credit_limit: number;
  outstanding_balance: number;
  visits: number;
}

export interface CustomerFamily {
  mobile: string;
  members: Customer[];
  outstanding: number;
}

export interface StockTransfer {
  id: string;
  from_location_id: string;
  to_location_id: string;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface InventorySyncAlert {
  id: string;
  operation_id: string;
  product_id: string;
  location_id: string;
  resulting_quantity: number;
  message: string;
  resolved_at: string | null;
  created_at: string;
}

export interface CashSession {
  id: string;
  location_id: string;
  opened_by: string;
  opening_cash: number;
  closing_cash: number | null;
  cash_sales: number;
  cash_in: number;
  cash_out: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_denominations: Record<string, number> | null;
  closing_denominations: Record<string, number> | null;
}

export interface CashTxnRow {
  id: string;
  session_id: string | null;
  location_id: string;
  direction: "IN" | "OUT";
  amount: number;
  reason: string;
  created_at: string;
}

export interface LocalInvoice {
  id: string;
  invoice_number: string;
  location_id: string;
  customer_id: string | null;
  cashier_id: string;
  cashier_name: string;
  total_amount: number;
  discount_amount: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  status: "DRAFT" | "COMPLETED" | "VOID";
  business_date: string;
  created_at: string;
  updated_at?: string;
  sync_status: SyncStatus;
  discount_mode?: "AMOUNT" | "PERCENT";
  discount_input?: number;
}

export interface LocalPurchaseReceipt {
  id: string;
  supplier_name: string;
  supplier_invoice_number: string;
  invoice_date: string;
  warehouse_location_id: string;
  attachment?: Blob | null;
  attachment_name?: string | null;
  attachment_path?: string | null;
  ocr_text?: string | null;
  ocr_rows?: Array<Record<string, unknown>>;
  status: "DRAFT" | "REVIEWED" | "RECEIVED";
  created_at: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  received_at?: string | null;
  sync_status: SyncStatus;
  items: Array<{ product_id: string; quantity: number; unit_cost: number; name?: string }>;
}

export interface CartLine {
  product: Product;
  quantity: number;
  unit_price: number;
  uom: string;
  discount: number;
}

export interface ReceiptPayment {
  mode: string;
  amount: number;
  tendered?: number;
  change_given?: number;
}

export type PaymentMode = "CASH" | "UPI" | "CARD" | "CREDIT";

export const inr = (n: number | null | undefined) =>
  "₹" +
  (Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PAID: "Paid",
  PARTIALLY_PAID: "Partially Paid",
  UNPAID: "Unpaid",
};

export const REASONS = ["PEST", "TORN", "EXPIRED", "SPOILAGE"] as const;

export const UOMS = [
  "Pcs",
  "Kg",
  "Meter",
  "Pouch",
  "Pack",
  "Roll",
  "Jar",
  "Box",
  "Bottle",
  "Unit",
  "Litre",
  "PKT",
  "BAG",
] as const;

export const CATEGORIES = [
  "FMCG",
  "Grocery",
  "Snacks",
  "Dairy",
  "Beverages",
  "Personal Care",
  "Cosmetics",
  "Household",
  "Spices",
  "Pan",
  "Toffee",
  "Other",
] as const;

export const CASH_TXN_REASONS = [
  "Shop expense",
  "Tea & snacks",
  "Vendor payment",
  "Freight / maal bhada",
  "Change top-up",
  "Other",
] as const;

/** Largest discount possible on a line without breaking the floor (min selling) price. */
export function maxLineDiscount(unitPrice: number, quantity: number, minSalePrice: number) {
  const floor = minSalePrice > 0 ? minSalePrice : 0;
  return Math.max(quantity * unitPrice - quantity * floor, 0);
}

export function familySummary(customers: Customer[], mobile: string): CustomerFamily {
  const members = customers.filter((customer) => customer.mobile === mobile);
  return {
    mobile,
    members,
    outstanding: members.reduce((sum, member) => sum + member.outstanding_balance, 0),
  };
}

const HINDI_SEARCH_ALIASES: Record<string, string[]> = {
  bucket: ["balti", "baalti", "बाल्टी"],
  balti: ["bucket", "बाल्टी"],
  broom: ["jhadu", "jhaadu", "झाड़ू"],
  jhadu: ["broom", "झाड़ू"],
  soap: ["sabun", "साबुन"],
  sabun: ["soap", "साबुन"],
  rice: ["chawal", "चावल"],
  chawal: ["rice", "चावल"],
};

const SEARCH_NORMALIZATIONS: Record<string, string> = {
  jhaadu: "jhadu",
  झाड़ू: "jhadu",
  झाडू: "jhadu",
  broom: "jhadu",
  baalti: "balti",
  बाल्टी: "balti",
  bucket: "balti",
  sabun: "soap",
  साबुन: "soap",
  chawal: "rice",
  चावल: "rice",
};

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("hi-IN")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .map((token) => SEARCH_NORMALIZATIONS[token] ?? token)
    .join(" ");
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    let diagonal = previous[0] ?? 0;
    previous[0] = row;
    for (let col = 1; col <= b.length; col++) {
      const above = previous[col] ?? 0;
      previous[col] = Math.min(
        above + 1,
        (previous[col - 1] ?? 0) + 1,
        diagonal + (a[row - 1] === b[col - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

/** In-memory phonetic + typo-tolerant search across catalog fields. */
export function matchesProductSearch(product: Product, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const fields = [
    product.name,
    product.name_hi,
    ...(product.search_aliases ?? []),
    product.sku,
    product.barcode,
    product.category,
    product.variant,
  ]
    .filter((field): field is string => !!field)
    .map(normalizeSearchText);
  const aliases = (HINDI_SEARCH_ALIASES[q] ?? []).map(normalizeSearchText);
  if (fields.some((field) => field.includes(q) || aliases.some((alias) => field.includes(alias)))) {
    return true;
  }
  const terms = q.split(/\s+/).filter(Boolean);
  return terms.every((term) =>
    fields.some((field) =>
      field.split(/\s+/).some((word) => {
        if (word.startsWith(term) || term.startsWith(word)) return true;
        const allowed = term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0;
        return allowed > 0 && word.length >= 3 && editDistance(word, term) <= allowed;
      }),
    ),
  );
}

export function matchesSearchFields(fields: Array<string | null | undefined>, query: string) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  const values = fields.filter((field): field is string => !!field).map(normalizeSearchText);
  return terms.every((term) =>
    values.some(
      (value) =>
        value.includes(term) ||
        value.split(" ").some((word) => {
          const allowed = term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0;
          return word.startsWith(term) || (allowed > 0 && editDistance(word, term) <= allowed);
        }),
    ),
  );
}

export function discountFromInput(subtotal: number, value: number, mode: "AMOUNT" | "PERCENT") {
  return mode === "PERCENT" ? (subtotal * Math.max(0, value)) / 100 : Math.max(0, value);
}

function useLocalRows<T extends KeyedRecord>(
  store: LocalStoreName,
  queryKey: unknown[],
  predicate?: (row: T) => boolean,
) {
  const queryClient = useQueryClient();
  const keySignature = JSON.stringify(queryKey);
  useEffect(
    () =>
      subscribeLocalChanges((changedStore) => {
        if (changedStore === store) {
          void queryClient.invalidateQueries({ queryKey: JSON.parse(keySignature) as unknown[] });
        }
      }),
    [queryClient, store, keySignature],
  );
  return useQuery<T[]>({
    queryKey,
    queryFn: async () => {
      const rows = await getAllLocal<T>(store);
      return predicate ? rows.filter(predicate) : rows;
    },
    staleTime: Infinity,
  });
}

export function useLocations() {
  return useLocalRows<Location & KeyedRecord>(
    "locations",
    ["locations"],
    (location) => location.is_active !== false,
  );
}

export function useProducts() {
  return useLocalRows<Product & KeyedRecord>("catalog", ["products"]);
}

export interface InventoryRow {
  product_id: string;
  location_id: string;
  quantity_on_hand: number;
  reserved_qty: number;
}

export function useInventory() {
  return useLocalRows<InventoryRow & KeyedRecord>("inventory_snapshot", ["inventory"]);
}

export function useCustomers() {
  return useLocalRows<Customer & KeyedRecord>("customers", ["customers"]);
}

export function useSales() {
  return useLocalRows<LocalInvoice & KeyedRecord>("bills", ["sales"]);
}

export function usePurchases() {
  return useLocalRows<LocalPurchaseReceipt & KeyedRecord>("purchases", ["purchases"]);
}

export function useStockTransfers() {
  return useLocalRows<StockTransfer & KeyedRecord>("stock_transfers", ["transfers"]);
}

export function useTransferItems() {
  return useLocalRows<KeyedRecord>("transfer_items", ["transfer-items"]);
}

export function useStockAdjustments() {
  return useLocalRows<KeyedRecord>("stock_adjustments", ["adjustments"]);
}

export function useShortcutTiles() {
  return useLocalRows<KeyedRecord>("shortcuts", ["shortcuts"]);
}

export function useCashSessions(locationId: string | null) {
  return useLocalRows<CashSession & KeyedRecord>(
    "cash_sessions",
    ["cash-sessions", locationId],
    (session) => !!locationId && session.location_id === locationId,
  );
}

/** Cash in/out events at one location since a timestamp. */
export function useCashTransactions(locationId: string | null, since: string | null) {
  return useLocalRows<CashTxnRow & KeyedRecord>(
    "cash_transactions",
    ["cash-transactions", locationId, since],
    (txn) => !!locationId && txn.location_id === locationId && (!since || txn.created_at >= since),
  );
}

export interface InvoiceItemRow {
  id: string;
  invoice_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  uom: string;
  discount: number;
  total: number;
  products?: { name: string } | null;
  product_snapshot?: Product | null;
}

export function useInvoiceItems(invoiceId: string | null) {
  return useLocalRows<InvoiceItemRow & KeyedRecord>(
    "invoice_items",
    ["invoice-items", invoiceId],
    (item) => item.invoice_id === invoiceId,
  );
}

export interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: number;
  mode: string;
  tendered: number | null;
  change_given: number | null;
  created_at: string;
}

/** Payments at one location since a timestamp (for cash drawer / receipts). */
export function usePaymentsSince(locationId: string | null, since: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["payments-since", locationId, since];
  const keySignature = JSON.stringify(queryKey);
  useEffect(
    () =>
      subscribeLocalChanges((store) => {
        if (store === "payments" || store === "bills") {
          void queryClient.invalidateQueries({ queryKey: JSON.parse(keySignature) as unknown[] });
        }
      }),
    [queryClient, keySignature],
  );
  return useQuery<PaymentRow[]>({
    queryKey,
    queryFn: async () => {
      const [payments, invoices] = await Promise.all([
        getAllLocal<PaymentRow & KeyedRecord>("payments"),
        getAllLocal<LocalInvoice & KeyedRecord>("bills"),
      ]);
      const invoiceLocations = new Map(
        invoices.map((invoice) => [invoice.id, invoice.location_id]),
      );
      return payments.filter(
        (payment) =>
          !!locationId &&
          invoiceLocations.get(payment.invoice_id) === locationId &&
          (!since || payment.created_at >= since),
      );
    },
    staleTime: Infinity,
  });
}

/* ------------------------------- mutations ------------------------------- */

export interface InvoiceResult {
  invoice_id: string;
  invoice_number: string;
  total: number;
  paid: number;
}

export interface PaymentSplitInput {
  amount: number;
  mode: string;
  tendered?: number;
  change_given?: number;
}

function localId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function compactDate(date: string) {
  return date.replaceAll("-", "").slice(2);
}

async function localStockDelta(
  productId: string,
  locationId: string,
  delta: number,
  movementType: string,
  reference: string | null,
) {
  const rows = await getAllLocal<InventoryRow & KeyedRecord>("inventory_snapshot");
  const current = rows.find(
    (row) => row.product_id === productId && row.location_id === locationId,
  );
  const nextQuantity = (current?.quantity_on_hand ?? 0) + delta;
  if (nextQuantity < -0.0001)
    throw new Error(`Insufficient cached stock. Available: ${current?.quantity_on_hand ?? 0}.`);
  const inventory: InventoryRow & KeyedRecord = {
    id: current?.id ?? `${productId}:${locationId}`,
    product_id: productId,
    location_id: locationId,
    quantity_on_hand: nextQuantity,
    reserved_qty: current?.reserved_qty ?? 0,
    sync_status: "PENDING",
    updated_at: new Date().toISOString(),
  };
  const movement = {
    id: localId(),
    product_id: productId,
    location_id: locationId,
    movement_type: movementType,
    quantity_delta: delta,
    quantity_on_hand: nextQuantity,
    reference,
    created_at: new Date().toISOString(),
    sync_status: "PENDING",
  };
  return {
    inventory,
    movement,
    entries: [
      { store: "inventory_snapshot" as const, value: inventory as KeyedRecord },
      { store: "stock_movements" as const, value: movement as KeyedRecord },
    ],
  };
}

function triggerBackgroundSync() {
  void import("@/lib/offline-sync").then(({ syncOutbox }) => syncOutbox()).catch(() => undefined);
}

export type LocalDraftLine = CartLine;

export interface DraftPayload {
  invoice: LocalInvoice;
  customer: Customer | null;
  customer_mode: "unset" | "chosen" | "walkin";
  items: LocalDraftLine[];
  discount_mode: "AMOUNT" | "PERCENT";
  discount_input: number;
}

export async function createLocalDraft(
  locationId: string,
  businessDate: string,
  cashierId?: string,
  cashierName = "Cashier",
): Promise<LocalInvoice> {
  const location = await getLocal<Location & KeyedRecord>("locations", locationId);
  const deviceId = await getDeviceId();
  const sequence = await nextLocalSequence(`bill:${location?.code ?? locationId}:${businessDate}`);
  const number = `${(location?.code ?? "SHOP").toUpperCase()}-${deviceId.slice(0, 4).toUpperCase()}-${compactDate(businessDate)}-${String(sequence).padStart(4, "0")}`;
  const invoice: LocalInvoice = {
    id: localId(),
    invoice_number: number,
    location_id: locationId,
    customer_id: null,
    cashier_id: cashierId ?? deviceId,
    cashier_name: cashierName,
    total_amount: 0,
    discount_amount: 0,
    paid_amount: 0,
    balance_amount: 0,
    payment_status: "UNPAID",
    status: "DRAFT",
    business_date: businessDate,
    created_at: new Date().toISOString(),
    sync_status: "LOCAL",
  };
  const payload: DraftPayload = {
    invoice,
    customer: null,
    customer_mode: "unset",
    items: [],
    discount_mode: "AMOUNT",
    discount_input: 0,
  };
  await commitLocalOperation(
    [
      { store: "bills", value: invoice as unknown as KeyedRecord },
      { store: "settings", value: { key: `draft:${invoice.id}`, value: payload } as KeyedRecord },
    ],
    "invoice.draft.save",
    { record_id: invoice.id, invoice, items: [], customer: null, customer_mode: "unset" },
    locationId,
    invoice.id,
  );
  triggerBackgroundSync();
  return invoice;
}

export async function saveLocalDraft(draft: DraftPayload): Promise<void> {
  const persisted = await getLocal<LocalInvoice & KeyedRecord>("bills", draft.invoice.id);
  if (persisted && persisted.status !== "DRAFT") return;
  const invoice: LocalInvoice = {
    ...draft.invoice,
    status: "DRAFT",
    customer_id: draft.customer?.id ?? null,
    discount_amount: draft.discount_input,
    discount_mode: draft.discount_mode,
    updated_at: new Date().toISOString(),
    sync_status: "LOCAL",
  };
  const itemRows = draft.items.map((line, index) => ({
    id: `${invoice.id}:${line.product.id}`,
    invoice_id: invoice.id,
    product_id: line.product.id,
    quantity: line.quantity,
    unit_price: line.unit_price,
    uom: line.uom,
    discount: line.discount,
    total: line.quantity * line.unit_price - line.discount,
    line_index: index,
    product_snapshot: line.product,
  }));
  const payload: DraftPayload = { ...draft, invoice };
  await commitLocalOperation(
    [
      { store: "bills", value: invoice as unknown as KeyedRecord },
      { store: "settings", value: { key: `draft:${invoice.id}`, value: payload } as KeyedRecord },
    ],
    "invoice.draft.save",
    {
      record_id: invoice.id,
      invoice,
      items: itemRows,
      customer: draft.customer,
      customer_mode: draft.customer_mode,
    },
    invoice.location_id,
    invoice.id,
  );
  triggerBackgroundSync();
}

export async function loadLocalDraftPayload(invoiceId: string): Promise<DraftPayload | undefined> {
  const row = await getLocal<KeyedRecord>("settings", `draft:${invoiceId}`);
  return row?.["value"] as DraftPayload | undefined;
}

export async function voidLocalDraft(invoiceId: string): Promise<void> {
  const invoice = await getLocal<LocalInvoice & KeyedRecord>("bills", invoiceId);
  if (!invoice) return;
  const voided = {
    ...invoice,
    status: "VOID" as const,
    sync_status: "LOCAL" as const,
    updated_at: new Date().toISOString(),
  };
  await commitLocalOperation(
    [{ store: "bills", value: voided as unknown as KeyedRecord }],
    "invoice.draft.void",
    { record_id: invoice.id, invoice: voided },
    invoice.location_id,
  );
  triggerBackgroundSync();
}

export async function savePurchaseReceipt(receipt: LocalPurchaseReceipt): Promise<void> {
  const existing = await getAllLocal<LocalPurchaseReceipt & KeyedRecord>("purchases");
  const supplierKey = receipt.supplier_name.trim().toLocaleLowerCase("hi-IN");
  const invoiceKey = receipt.supplier_invoice_number.trim().toLocaleLowerCase("hi-IN");
  const duplicate = existing.find(
    (row) =>
      row.id !== receipt.id &&
      row.supplier_name.trim().toLocaleLowerCase("hi-IN") === supplierKey &&
      row.supplier_invoice_number.trim().toLocaleLowerCase("hi-IN") === invoiceKey,
  );
  if (invoiceKey && duplicate)
    throw new Error(
      `Invoice ${receipt.supplier_invoice_number} from ${receipt.supplier_name} already exists on this device (${duplicate.status.toLowerCase()}). Open that purchase instead of adding it again.`,
    );
  await commitLocalOperation(
    [
      {
        store: "purchases",
        value: { ...receipt, sync_status: "PENDING" } as unknown as KeyedRecord,
      },
    ],
    "purchase.draft.save",
    { record_id: receipt.id, receipt },
    receipt.warehouse_location_id,
  );
  triggerBackgroundSync();
}

export async function markPurchaseReviewed(receiptId: string, reviewedBy: string): Promise<void> {
  const receipt = await getLocal<LocalPurchaseReceipt & KeyedRecord>("purchases", receiptId);
  if (!receipt || receipt.status === "RECEIVED")
    throw new Error("This purchase cannot be reviewed.");
  const reviewed: LocalPurchaseReceipt = {
    ...receipt,
    status: "REVIEWED",
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString(),
    sync_status: "PENDING",
  };
  await commitLocalOperation(
    [{ store: "purchases", value: reviewed as unknown as KeyedRecord }],
    "purchase.review",
    { record_id: receipt.id, receipt: reviewed },
    receipt.warehouse_location_id,
  );
  triggerBackgroundSync();
}

export async function receivePurchaseReceipt(receiptId: string, reviewedBy: string): Promise<void> {
  const receipt = await getLocal<LocalPurchaseReceipt & KeyedRecord>("purchases", receiptId);
  if (!receipt) throw new Error("Purchase receipt not found on this device.");
  if (receipt.status === "RECEIVED") throw new Error("This purchase has already been received.");
  if (receipt.status !== "REVIEWED")
    throw new Error("A manager must review this purchase before stock is received.");
  if (!receipt.items.length || receipt.items.some((item) => item.quantity <= 0))
    throw new Error("Add valid item quantities before receiving stock.");
  const entries: Array<{ store: LocalStoreName; value: KeyedRecord }> = [];
  const movements: KeyedRecord[] = [];
  for (const item of receipt.items) {
    const result = await localStockDelta(
      item.product_id,
      receipt.warehouse_location_id,
      item.quantity,
      "PURCHASE RECEIPT",
      receipt.supplier_invoice_number,
    );
    entries.push(...result.entries);
    movements.push(result.movement as unknown as KeyedRecord);
  }
  const received: LocalPurchaseReceipt = {
    ...receipt,
    status: "RECEIVED",
    reviewed_by: reviewedBy,
    received_at: new Date().toISOString(),
    sync_status: "PENDING",
  };
  entries.push({ store: "purchases", value: received as unknown as KeyedRecord });
  await commitLocalOperation(
    entries,
    "purchase.receive",
    { record_id: receipt.id, receipt: received, stock_movements: movements },
    receipt.warehouse_location_id,
  );
  triggerBackgroundSync();
}

export async function createPosInvoice(input: {
  locationId: string;
  draftId?: string | null | undefined;
  invoiceNumber?: string | null | undefined;
  cashierId?: string | null | undefined;
  cashierName?: string | undefined;
  customerId: string | null;
  discount: number;
  businessDate: string;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    uom: string;
    discount: number;
    total: number;
  }>;
  payments: PaymentSplitInput[];
}): Promise<InvoiceResult> {
  if (input.items.length === 0) throw new Error("Add at least one item before checkout.");
  const inventory = await getAllLocal<InventoryRow & KeyedRecord>("inventory_snapshot");
  const products = await getAllLocal<Product & KeyedRecord>("catalog");
  const existing = input.draftId
    ? await getLocal<LocalInvoice & KeyedRecord>("bills", input.draftId)
    : undefined;
  const grouped = new Map<string, number>();
  for (const item of input.items)
    grouped.set(item.product_id, (grouped.get(item.product_id) ?? 0) + item.quantity);
  for (const [productId, quantity] of grouped) {
    const stock = inventory.find(
      (row) => row.product_id === productId && row.location_id === input.locationId,
    );
    if (!stock || stock.quantity_on_hand - stock.reserved_qty < quantity) {
      const product = products.find((row) => row.id === productId);
      throw new Error(
        `Insufficient cached stock for ${product?.name ?? "this item"}. Available: ${Math.max(0, stock?.quantity_on_hand ?? 0)}.`,
      );
    }
  }

  const deviceId = input.cashierId ?? (await getDeviceId());
  const location = await getLocal<Location & KeyedRecord>("locations", input.locationId);
  const invoiceNumber =
    existing?.invoice_number ??
    input.invoiceNumber ??
    `${(location?.code ?? "SHOP").toUpperCase()}-${(await getDeviceId()).slice(0, 4).toUpperCase()}-${compactDate(input.businessDate)}-${String(await nextLocalSequence(`bill:${location?.code ?? input.locationId}:${input.businessDate}`)).padStart(4, "0")}`;
  const id = existing?.id ?? input.draftId ?? localId();
  const subtotal = input.items.reduce((sum, item) => sum + item.total, 0);
  const total = Math.max(0, subtotal - input.discount);
  const paid = input.payments
    .filter((payment) => payment.mode !== "CREDIT")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const balance = Math.max(0, total - paid);
  const createdAt = new Date().toISOString();
  const invoice: LocalInvoice = {
    id,
    invoice_number: invoiceNumber,
    location_id: input.locationId,
    customer_id: input.customerId,
    cashier_id: deviceId,
    cashier_name: input.cashierName ?? "Cashier",
    total_amount: total,
    discount_amount: input.discount,
    paid_amount: paid,
    balance_amount: balance,
    payment_status: computePaymentStatus(total, paid),
    status: "COMPLETED",
    business_date: input.businessDate,
    created_at: existing?.created_at ?? createdAt,
    updated_at: createdAt,
    sync_status: "PENDING",
  };
  const itemRows = input.items.map((item, index) => ({
    id: localId(),
    invoice_id: id,
    ...item,
    line_index: index,
    product_snapshot: products.find((product) => product.id === item.product_id) ?? null,
  }));
  const paymentRows = input.payments.map((payment, index) => ({
    id: localId(),
    invoice_id: id,
    customer_id: input.customerId,
    ...payment,
    created_at: createdAt,
  }));
  const stockRows = inventory.map((row) =>
    grouped.has(row.product_id) && row.location_id === input.locationId
      ? {
          ...row,
          quantity_on_hand: row.quantity_on_hand - (grouped.get(row.product_id) ?? 0),
          updated_at: createdAt,
        }
      : row,
  );
  const movements = [...grouped.entries()].map(([productId, quantity]) => {
    const stock = stockRows.find(
      (row) => row.product_id === productId && row.location_id === input.locationId,
    );
    return {
      id: localId(),
      product_id: productId,
      location_id: input.locationId,
      movement_type: "SALE",
      quantity_delta: -quantity,
      quantity_on_hand: stock?.quantity_on_hand ?? 0,
      reference: invoiceNumber,
      created_at: createdAt,
      sync_status: "PENDING",
    } as KeyedRecord;
  });
  const updatedCustomers = input.customerId
    ? (await getAllLocal<Customer & KeyedRecord>("customers")).map((customer) =>
        customer.id === input.customerId
          ? {
              ...customer,
              // Any unpaid invoice balance is customer credit, including an
              // amount left unallocated in a mixed/partial payment.
              outstanding_balance: Math.max(0, customer.outstanding_balance + balance),
              visits: customer.visits + 1,
              sync_status: "PENDING",
            }
          : customer,
      )
    : [];
  const localEntries = [
    { store: "bills" as const, value: invoice as unknown as KeyedRecord },
    ...itemRows.map((value) => ({
      store: "invoice_items" as const,
      value: value as unknown as KeyedRecord,
    })),
    ...paymentRows.map((value) => ({
      store: "payments" as const,
      value: value as unknown as KeyedRecord,
    })),
    ...stockRows
      .filter((row) => grouped.has(row.product_id) && row.location_id === input.locationId)
      .map((value) => ({
        store: "inventory_snapshot" as const,
        value: value as unknown as KeyedRecord,
      })),
    ...movements.map((value) => ({ store: "stock_movements" as const, value })),
    ...updatedCustomers
      .filter((customer) => customer.id === input.customerId)
      .map((value) => ({ store: "customers" as const, value: value as unknown as KeyedRecord })),
  ];
  await commitLocalOperation(
    localEntries,
    "invoice.finalize",
    {
      record_id: id,
      invoice,
      items: itemRows,
      payments: paymentRows,
      stock_movements: movements,
    },
    input.locationId,
  );
  triggerBackgroundSync();
  return { invoice_id: id, invoice_number: invoiceNumber, total, paid };
}

export async function addPayment(input: { invoiceId: string; amount: number; mode: string }) {
  const invoice = await getLocal<LocalInvoice & KeyedRecord>("bills", input.invoiceId);
  if (!invoice) throw new Error("Bill not found on this device.");
  const payment = {
    id: localId(),
    invoice_id: invoice.id,
    customer_id: invoice.customer_id,
    amount: input.amount,
    mode: input.mode,
    tendered: input.amount,
    change_given: 0,
    created_at: new Date().toISOString(),
  };
  const paid = invoice.paid_amount + input.amount;
  const updated = {
    ...invoice,
    paid_amount: paid,
    balance_amount: Math.max(invoice.total_amount - paid, 0),
    payment_status: computePaymentStatus(invoice.total_amount, paid),
    sync_status: "PENDING" as const,
  };
  await commitLocalOperation(
    [
      { store: "payments", value: payment as unknown as KeyedRecord },
      { store: "bills", value: updated as unknown as KeyedRecord },
    ],
    "payment.add",
    { record_id: invoice.id, payment, invoice: updated },
    invoice.location_id,
  );
}

export async function logCashTxn(input: {
  sessionId: string | null;
  locationId: string;
  direction: "IN" | "OUT";
  amount: number;
  reason: string;
}) {
  const row: CashTxnRow = {
    id: localId(),
    session_id: input.sessionId,
    location_id: input.locationId,
    direction: input.direction,
    amount: input.amount,
    reason: input.reason,
    created_at: new Date().toISOString(),
  };
  const session = input.sessionId
    ? await getLocal<CashSession & KeyedRecord>("cash_sessions", input.sessionId)
    : undefined;
  const updatedSession = session
    ? {
        ...session,
        cash_in: session.cash_in + (input.direction === "IN" ? input.amount : 0),
        cash_out: session.cash_out + (input.direction === "OUT" ? input.amount : 0),
        sync_status: "PENDING",
      }
    : null;
  const entries: Array<{ store: LocalStoreName; value: KeyedRecord }> = [
    { store: "cash_transactions", value: row as unknown as KeyedRecord },
  ];
  if (updatedSession)
    entries.push({
      store: "cash_sessions" as const,
      value: updatedSession as unknown as KeyedRecord,
    });
  await commitLocalOperation(
    entries,
    "cash.transaction.create",
    { record_id: row.id, transaction: row, session: updatedSession },
    input.locationId,
  );
}

export async function quickAddProduct(input: {
  name: string;
  nameHi?: string | null;
  searchAliases?: string[];
  sku?: string;
  barcode?: string | null;
  priceTiers?: ProductPriceTier[];
  variant?: string | null;
  category?: string | null;
  rackLocation?: string | null;
  salePrice: number;
  minSalePrice?: number;
  purchaseCost: number;
  mrp: number;
  uom: string;
  locationId: string;
  openingQty: number;
  minStock?: number;
  cashierQuickAdd?: boolean;
}): Promise<Product> {
  const sku = input.sku?.trim() || (await generateSku());
  const priceTiers = parsePriceTiers(input.priceTiers);
  const floorPrice = Math.min(input.minSalePrice ?? 0, input.salePrice);
  if (priceTiers.some((tier) => tier.unit_price < floorPrice || tier.unit_price > input.salePrice))
    throw new Error("Quantity prices must be between the minimum allowed price and retail price.");
  const allProducts = await getAllLocal<Product & KeyedRecord>("catalog");
  const barcode = input.barcode?.trim() || barcodeForSku(sku);
  if (allProducts.some((product) => product.barcode?.toLowerCase() === barcode.toLowerCase())) {
    throw new Error("This barcode is already assigned to another product.");
  }
  if (allProducts.some((product) => product.sku?.toLowerCase() === sku.toLowerCase()))
    throw new Error("This SKU already exists.");
  const id = localId();
  const product: Product = {
    id,
    name: input.name.trim(),
    name_hi: input.nameHi ?? null,
    search_aliases: input.searchAliases ?? [],
    sku,
    barcode,
    hsn: null,
    category: input.category || null,
    variant: input.variant || null,
    rack_location: input.rackLocation || null,
    purchase_cost: input.purchaseCost,
    mrp: input.mrp,
    sale_price: input.salePrice,
    price_tiers: priceTiers,
    min_sale_price: floorPrice,
    uom_purchase: input.uom,
    uom_stock: input.uom,
    uom_sale: input.uom,
    conversion_factor: 1,
    min_stock: input.minStock ?? 0,
    is_loose: false,
    enrichment_status: "PENDING",
    preferred_supplier: null,
  };
  const entries: Array<{ store: LocalStoreName; value: KeyedRecord }> = [
    { store: "catalog", value: { ...product, sync_status: "PENDING" } as unknown as KeyedRecord },
  ];
  const movement =
    input.openingQty > 0
      ? await localStockDelta(
          product.id,
          input.locationId,
          input.openingQty,
          "OPENING",
          `SKU ${sku}`,
        )
      : null;
  if (movement) entries.push(...movement.entries);
  await commitLocalOperation(
    entries,
    input.cashierQuickAdd ? "product.quick_add" : "product.create",
    {
      record_id: id,
      product,
      opening_qty: input.openingQty,
      location_id: input.locationId,
      stock_movements: movement ? [movement.movement] : [],
    },
    input.locationId,
  );
  triggerBackgroundSync();
  return product;
}

export async function addCustomer(input: {
  name: string;
  mobile: string | null;
  creditLimit: number;
  ageGroup?: string | null;
  gender?: string | null;
  outstandingBalance?: number;
}): Promise<Customer> {
  const normalizedName = input.name.trim().toLocaleLowerCase("hi-IN");
  const normalizedMobile = input.mobile?.replace(/\D/g, "") || null;
  const duplicate = (await getAllLocal<Customer & KeyedRecord>("customers")).find(
    (customer) =>
      customer.name.trim().toLocaleLowerCase("hi-IN") === normalizedName &&
      (customer.mobile?.replace(/\D/g, "") || null) === normalizedMobile,
  );
  if (duplicate) return duplicate;
  const customer: Customer = {
    id: localId(),
    name: input.name.trim(),
    mobile: input.mobile?.trim() || null,
    age_group: input.ageGroup || null,
    gender: input.gender || null,
    credit_limit: input.creditLimit,
    outstanding_balance: input.outstandingBalance ?? 0,
    visits: 0,
  };
  await commitLocalOperation(
    [
      {
        store: "customers",
        value: { ...customer, sync_status: "PENDING" } as unknown as KeyedRecord,
      },
    ],
    "customer.create",
    { record_id: customer.id, customer },
    null,
  );
  triggerBackgroundSync();
  return customer;
}

export async function updateCustomer(
  customerId: string,
  patch: Partial<Pick<Customer, "name" | "mobile" | "age_group" | "gender" | "credit_limit">>,
) {
  const current = await getLocal<Customer & KeyedRecord>("customers", customerId);
  if (!current) throw new Error("Customer not found on this device.");
  const updated = { ...current, ...patch, sync_status: "PENDING" };
  await commitLocalOperation(
    [{ store: "customers", value: updated as unknown as KeyedRecord }],
    "customer.update",
    { record_id: customerId, customer: updated },
    null,
  );
  triggerBackgroundSync();
}

export async function updateProductProfile(productId: string, patch: Partial<Product>) {
  const current = await getLocal<Product & KeyedRecord>("catalog", productId);
  if (!current) throw new Error("Product not found on this device.");
  const nextSku = patch.sku ?? current.sku;
  const requestedBarcode = patch.barcode?.trim() ?? "";
  const barcodeWasGenerated = current.sku && current.barcode === barcodeForSku(current.sku);
  const nextBarcode =
    barcodeWasGenerated &&
    nextSku !== current.sku &&
    (!requestedBarcode || requestedBarcode === current.barcode)
      ? barcodeForSku(nextSku ?? "")
      : requestedBarcode || current.barcode || (nextSku ? barcodeForSku(nextSku) : null);
  const catalog = await getAllLocal<Product & KeyedRecord>("catalog");
  const duplicateSku = catalog.some(
    (product) => product.id !== productId && product.sku?.toLowerCase() === nextSku?.toLowerCase(),
  );
  if (duplicateSku) throw new Error("This SKU is already assigned to another product.");
  const duplicateBarcode = catalog.some(
    (product) =>
      product.id !== productId && product.barcode?.toLowerCase() === nextBarcode?.toLowerCase(),
  );
  if (duplicateBarcode) throw new Error("This barcode is already assigned to another product.");
  const priceTiers =
    patch.price_tiers === undefined
      ? (current.price_tiers ?? [])
      : parsePriceTiers(patch.price_tiers);
  const minSalePrice = patch.min_sale_price ?? current.min_sale_price;
  const salePrice = patch.sale_price ?? current.sale_price;
  if (priceTiers.some((tier) => tier.unit_price < minSalePrice || tier.unit_price > salePrice))
    throw new Error("Quantity prices must be between the minimum allowed price and retail price.");
  const updated = {
    ...current,
    ...patch,
    sku: nextSku,
    barcode: nextBarcode,
    price_tiers: priceTiers,
    sync_status: "PENDING",
  };
  await commitLocalOperation(
    [{ store: "catalog", value: updated as unknown as KeyedRecord }],
    "product.update",
    { record_id: productId, product: updated },
    null,
  );
  triggerBackgroundSync();
}

export async function saveShortcutTiles(locationId: string, productIds: string[]) {
  const id = `location:${locationId}`;
  const shortcut = {
    id,
    location_id: locationId,
    product_ids: productIds,
    updated_at: new Date().toISOString(),
    sync_status: "PENDING",
  };
  await commitLocalOperation(
    [{ store: "shortcuts", value: shortcut as unknown as KeyedRecord }],
    "shortcut.update",
    { record_id: id, shortcut },
    locationId,
  );
  triggerBackgroundSync();
}

export async function requestIndent(input: {
  fromLocationId: string;
  toLocationId: string;
  productId: string;
  quantity: number;
  notes: string | null;
}) {
  return createTransfer({
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    items: [{ product_id: input.productId, quantity: input.quantity }],
    notes: input.notes,
  });
}

export async function createTransfer(input: {
  fromLocationId: string;
  toLocationId: string;
  items: Array<{ product_id: string; quantity: number }>;
  notes: string | null;
}) {
  if (input.fromLocationId === input.toLocationId)
    throw new Error("Choose two different locations.");
  if (input.items.length === 0 || input.items.some((item) => item.quantity <= 0))
    throw new Error("Transfer quantities must be greater than zero.");
  const transfer: StockTransfer = {
    id: localId(),
    from_location_id: input.fromLocationId,
    to_location_id: input.toLocationId,
    status: "REQUESTED",
    notes: input.notes,
    created_at: new Date().toISOString(),
  };
  const items = input.items.map((item) => ({ id: localId(), transfer_id: transfer.id, ...item }));
  await commitLocalOperation(
    [
      {
        store: "stock_transfers",
        value: { ...transfer, sync_status: "PENDING" } as unknown as KeyedRecord,
      },
      ...items.map((item) => ({
        store: "transfer_items" as const,
        value: item as unknown as KeyedRecord,
      })),
    ],
    "inventory.transfer.create",
    { record_id: transfer.id, transfer, items },
    input.fromLocationId,
  );
  triggerBackgroundSync();
  return transfer;
}

export async function setTransferStatus(transferId: string, status: string) {
  const transfer = await getLocal<StockTransfer & KeyedRecord>("stock_transfers", transferId);
  if (!transfer) throw new Error("Transfer not found on this device.");
  const items = (await getAllLocal<KeyedRecord>("transfer_items")).filter(
    (item) => item["transfer_id"] === transferId,
  );
  const entries: Array<{ store: LocalStoreName; value: KeyedRecord }> = [
    {
      store: "stock_transfers",
      value: { ...transfer, status, sync_status: "PENDING" } as KeyedRecord,
    },
  ];
  const movements: KeyedRecord[] = [];
  if (status === "IN_TRANSIT" && transfer.status === "REQUESTED") {
    for (const item of items) {
      const result = await localStockDelta(
        String(item["product_id"]),
        transfer.from_location_id,
        -Number(item["quantity"]),
        "TRANSFER OUT",
        transferId,
      );
      entries.push(...result.entries);
      movements.push(result.movement as unknown as KeyedRecord);
    }
  }
  await commitLocalOperation(
    entries,
    "inventory.transfer.status",
    { record_id: transferId, transfer: { ...transfer, status }, stock_movements: movements },
    transfer.from_location_id,
  );
  triggerBackgroundSync();
}

export async function receiveTransfer(transferId: string) {
  const transfer = await getLocal<StockTransfer & KeyedRecord>("stock_transfers", transferId);
  if (!transfer) throw new Error("Transfer not found on this device.");
  if (transfer.status === "RECEIVED") return;
  const items = (await getAllLocal<KeyedRecord>("transfer_items")).filter(
    (item) => item["transfer_id"] === transferId,
  );
  const entries: Array<{ store: LocalStoreName; value: KeyedRecord }> = [
    {
      store: "stock_transfers",
      value: { ...transfer, status: "RECEIVED", sync_status: "PENDING" } as KeyedRecord,
    },
  ];
  const movements: KeyedRecord[] = [];
  for (const item of items) {
    if (transfer.status === "REQUESTED") {
      const outgoing = await localStockDelta(
        String(item["product_id"]),
        transfer.from_location_id,
        -Number(item["quantity"]),
        "TRANSFER OUT",
        transferId,
      );
      entries.push(...outgoing.entries);
      movements.push(outgoing.movement as unknown as KeyedRecord);
    }
    const incoming = await localStockDelta(
      String(item["product_id"]),
      transfer.to_location_id,
      Number(item["quantity"]),
      "TRANSFER IN",
      transferId,
    );
    entries.push(...incoming.entries);
    movements.push(incoming.movement as unknown as KeyedRecord);
  }
  await commitLocalOperation(
    entries,
    "inventory.transfer.receive",
    {
      record_id: transferId,
      transfer: { ...transfer, status: "RECEIVED" },
      items,
      stock_movements: movements,
    },
    transfer.to_location_id,
  );
  triggerBackgroundSync();
}

export async function createAdjustment(input: {
  productId: string;
  locationId: string;
  quantity: number;
  reason: string;
  returnable: boolean;
}) {
  if (!Number.isFinite(input.quantity) || input.quantity === 0)
    throw new Error("Adjustment quantity must be non-zero.");
  const delta = -input.quantity;
  const result = await localStockDelta(
    input.productId,
    input.locationId,
    delta,
    "ADJUSTMENT",
    input.reason,
  );
  const product = await getLocal<Product & KeyedRecord>("catalog", input.productId);
  const adjustment = {
    id: localId(),
    product_id: input.productId,
    location_id: input.locationId,
    quantity: input.quantity,
    reason: input.reason,
    returnable_to_vendor: input.returnable,
    cost_loss: Math.max(input.quantity, 0) * (product?.purchase_cost ?? 0),
    created_at: new Date().toISOString(),
  };
  await commitLocalOperation(
    [
      {
        store: "stock_adjustments",
        value: { ...adjustment, sync_status: "PENDING" } as unknown as KeyedRecord,
      },
      ...result.entries,
    ],
    "inventory.adjustment.create",
    { record_id: adjustment.id, adjustment, stock_movement: result.movement },
    input.locationId,
  );
  triggerBackgroundSync();
}

export async function openSession(input: {
  locationId: string;
  openedBy: string;
  openingCash: number;
  openingDenominations?: Record<number, number> | null;
}): Promise<string> {
  const id = localId();
  const session: CashSession = {
    id,
    location_id: input.locationId,
    opened_by: input.openedBy,
    opening_cash: input.openingCash,
    closing_cash: null,
    cash_sales: 0,
    cash_in: 0,
    cash_out: 0,
    status: "OPEN",
    opened_at: new Date().toISOString(),
    closed_at: null,
    opening_denominations: input.openingDenominations
      ? Object.fromEntries(
          Object.entries(input.openingDenominations).map(([key, value]) => [key, Number(value)]),
        )
      : null,
    closing_denominations: null,
  };
  await commitLocalOperation(
    [
      {
        store: "cash_sessions",
        value: { ...session, sync_status: "PENDING" } as unknown as KeyedRecord,
      },
    ],
    "cash.session.open",
    { record_id: id, session },
    input.locationId,
  );
  triggerBackgroundSync();
  return id;
}

export async function closeSession(input: {
  sessionId: string;
  cashIn: number | null;
  cashOut: number | null;
  countedCash: number | null;
  closingDenominations?: Record<number, number> | null;
}): Promise<{ cash_sales: number; expected_cash: number; difference: number }> {
  const session = await getLocal<CashSession & KeyedRecord>("cash_sessions", input.sessionId);
  if (!session || session.status !== "OPEN")
    throw new Error("No open cash session found on this device.");
  const invoices = await getAllLocal<LocalInvoice & KeyedRecord>("bills");
  const payments = await getAllLocal<PaymentRow & KeyedRecord>("payments");
  const invoiceIds = new Set(
    invoices
      .filter(
        (invoice) =>
          invoice.location_id === session.location_id && invoice.created_at >= session.opened_at,
      )
      .map((invoice) => invoice.id),
  );
  const cashSales = payments
    .filter((payment) => invoiceIds.has(payment.invoice_id) && payment.mode === "CASH")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const cashIn = input.cashIn ?? session.cash_in;
  const cashOut = input.cashOut ?? session.cash_out;
  const expected = session.opening_cash + cashSales + cashIn - cashOut;
  const difference = (input.countedCash ?? expected) - expected;
  const updated: CashSession = {
    ...session,
    cash_sales: cashSales,
    cash_in: cashIn,
    cash_out: cashOut,
    closing_cash: input.countedCash ?? expected,
    status: "CLOSED",
    closed_at: new Date().toISOString(),
    closing_denominations: input.closingDenominations
      ? Object.fromEntries(
          Object.entries(input.closingDenominations).map(([key, value]) => [key, Number(value)]),
        )
      : null,
  };
  await commitLocalOperation(
    [
      {
        store: "cash_sessions",
        value: { ...updated, sync_status: "PENDING" } as unknown as KeyedRecord,
      },
    ],
    "cash.session.close",
    { record_id: session.id, session: updated },
    session.location_id,
  );
  triggerBackgroundSync();
  return { cash_sales: cashSales, expected_cash: expected, difference };
}

export function computePaymentStatus(
  total: number,
  paid: number,
): "PAID" | "PARTIALLY_PAID" | "UNPAID" {
  if (paid >= total) return "PAID";
  if (paid > 0) return "PARTIALLY_PAID";
  return "UNPAID";
}

/* ------------------------- stock movement ledger ------------------------- */

export interface StockMovement {
  id: string;
  product_id: string;
  location_id: string;
  movement_type: string;
  quantity_delta: number;
  quantity_on_hand: number;
  reference: string | null;
  created_at: string;
}

/** Full movement register for one location (or all locations). */
export function useStockMovements(locationId: string | null, limit = 400) {
  return useLocalRows<StockMovement & KeyedRecord>(
    "stock_movements",
    ["stock-movements", locationId, limit],
    (movement) => !locationId || movement.location_id === locationId,
  );
}

/** Every movement of one product — used by the per-item history drawer. */
export function useProductMovements(productId: string | null, limit = 200) {
  return useLocalRows<StockMovement & KeyedRecord>(
    "stock_movements",
    ["stock-movements-product", productId, limit],
    (movement) => !productId || movement.product_id === productId,
  );
}

export function useSyncAlerts() {
  return useLocalRows<InventorySyncAlert & KeyedRecord>("sync_alerts", ["sync-alerts"]);
}

/* ----------------------- auto-SKU & legacy stock ------------------------- */

/** Device-scoped offline SKU, counted locally and collision-resistant across devices. */
export async function generateSku(): Promise<string> {
  const d = new Date();
  const deviceId = await getDeviceId();
  const scope = `sku:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const sequence = await nextLocalSequence(scope);
  return `SKU-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${deviceId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase()}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Legacy / opening stock entry: set an item's on-hand quantity to a counted
 * value without re-recording old sales. Creates a single corrective
 * adjustment (delta) that the ledger records as an ADJUSTMENT movement.
 */
export async function legacyStockSet(input: {
  productId: string;
  locationId: string;
  currentQty: number;
  targetQty: number;
}): Promise<void> {
  const delta = input.currentQty - input.targetQty;
  if (delta === 0) return;
  await createAdjustment({
    productId: input.productId,
    locationId: input.locationId,
    quantity: delta,
    reason: "OPENING / CORRECTION",
    returnable: false,
  });
}

/* ----------------------------- denominations ----------------------------- */

export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export function denomTotal(counts: Record<string, number> | null | undefined): number {
  if (!counts) return 0;
  return Object.entries(counts).reduce((s, [v, c]) => s + Number(v) * (Number(c) || 0), 0);
}

/* --------------------------- excel import/export -------------------------- */

export interface SheetData {
  name: string;
  rows: Array<Record<string, unknown>>;
}

/** Write a multi-sheet Excel workbook and trigger a browser download. */
export async function exportSheets(filename: string, sheets: SheetData[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

/** Parse an uploaded .xlsx/.xls/.csv file into sheet name + row objects. */
export async function parseWorkbookFile(file: File): Promise<SheetData[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer());
  return wb.SheetNames.map((n) => ({
    name: n,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[n]!, { defval: null }),
  }));
}

/** Normalize a spreadsheet header for flexible column matching. */
export function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function pickField(row: Record<string, unknown>, candidates: string[]): unknown {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const hit = keys.find((k) => normHeader(k) === cand);
    if (hit != null && row[hit] !== null && row[hit] !== "") return row[hit];
  }
  return null;
}

/* ------------------------------ category tiles --------------------------- */

export const CATEGORY_ICONS: Record<string, string> = {
  Snacks: "🍿",
  FMCG: "🧴",
  Grocery: "🛒",
  Dairy: "🥛",
  Beverages: "🥤",
  "Personal Care": "🧼",
  Cosmetics: "💄",
  Cosmatics: "💄",
  Household: "🧹",
  Spices: "🌶️",
  Pan: "🫖",
  Toffee: "🍬",
  Electrical: "💡",
  "Electrical Lighting": "💡",
  "Electrical Fitting": "🔌",
  Electricals: "💡",
  Stationery: "✏️",
  Stationary: "✏️",
  Toys: "🧸",
  Garments: "👕",
  Plastic: "🪣",
  Metal: "🥄",
  Sports: "🏏",
  Smoking: "🚬",
  Crackers: "🎆",
  General: "📦",
  "General Store": "📦",
  Other: "🛍️",
};

export function categoryIcon(category: string | null | undefined): string {
  if (!category) return "🛍️";
  return CATEGORY_ICONS[category] ?? CATEGORY_ICONS[category.toLowerCase()] ?? "🛍️";
}
