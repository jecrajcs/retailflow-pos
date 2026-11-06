import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

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
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  category: string | null;
  variant: string | null;
  rack_location: string | null;
  purchase_cost: number;
  mrp: number;
  sale_price: number;
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

export interface StockTransfer {
  id: string;
  from_location_id: string;
  to_location_id: string;
  status: string;
  notes: string | null;
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
  "₹" + (Number(n) || 0).toLocaleString("en-IN", {
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
  "Pcs", "Kg", "Meter", "Pouch", "Pack", "Roll", "Jar", "Box", "Bottle",
  "Unit", "Litre", "PKT", "BAG",
] as const;

export const CATEGORIES = [
  "FMCG", "Grocery", "Snacks", "Dairy", "Beverages", "Personal Care",
  "Cosmetics", "Household", "Spices", "Pan", "Toffee", "Other",
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

export function useLocations() {
  return useQuery<Location[]>({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Location[];
    },
  });
}

export function useProducts() {
  return useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
}

export interface InventoryRow {
  product_id: string;
  location_id: string;
  quantity_on_hand: number;
  reserved_qty: number;
}

export function useInventory() {
  return useQuery<InventoryRow[]>({
    queryKey: ["inventory"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory").select("*");
      if (error) throw error;
      return (data ?? []) as InventoryRow[];
    },
  });
}

export function useCustomers() {
  return useQuery<Customer[]>({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
  });
}

/** Cash in/out events at one location since a timestamp. */
export function useCashTransactions(locationId: string | null, since: string | null) {
  return useQuery<CashTxnRow[]>({
    enabled: !!locationId && !!since,
    queryKey: ["cash-transactions", locationId, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("location_id", locationId!)
        .gte("created_at", since!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as CashTxnRow[];
    },
  });
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
}

export function useInvoiceItems(invoiceId: string | null) {
  return useQuery<InvoiceItemRow[]>({
    enabled: !!invoiceId,
    queryKey: ["invoice-items", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_items")
        .select("*, products(name)")
        .eq("invoice_id", invoiceId!);
      if (error) throw error;
      return (data ?? []) as InvoiceItemRow[];
    },
  });
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
  return useQuery<PaymentRow[]>({
    enabled: !!locationId && !!since,
    queryKey: ["payments-since", locationId, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, invoice_id, amount, mode, tendered, change_given, created_at, invoices!inner(location_id)")
        .eq("invoices.location_id", locationId!)
        .gte("created_at", since!);
      if (error) throw error;
      return (data ?? []) as PaymentRow[];
    },
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

export async function createPosInvoice(input: {
  locationId: string;
  customerId: string | null;
  discount: number;
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
  const { data, error } = await supabase.rpc("create_pos_invoice", {
    p_location_id: input.locationId,
    p_customer_id: (input.customerId ?? null) as unknown as string,
    p_discount: input.discount,
    p_items: input.items,
    p_payments: input.payments as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as InvoiceResult;
}

export async function addPayment(input: {
  invoiceId: string;
  amount: number;
  mode: string;
}) {
  const { error } = await supabase.rpc("add_payment", {
    p_invoice_id: input.invoiceId,
    p_amount: input.amount,
    p_mode: input.mode,
  });
  if (error) throw error;
}

export async function logCashTxn(input: {
  sessionId: string | null;
  locationId: string;
  direction: "IN" | "OUT";
  amount: number;
  reason: string;
}) {
  const { error } = await supabase.rpc("log_cash_txn", {
    p_session_id: (input.sessionId ?? null) as unknown as string,
    p_location_id: input.locationId,
    p_direction: input.direction,
    p_amount: input.amount,
    p_reason: input.reason,
  });
  if (error) throw error;
}

export async function quickAddProduct(input: {
  name: string;
  sku?: string;
  barcode?: string | null;
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
}): Promise<Product> {
  const sku = input.sku ?? (await generateSku());
  const { data, error } = await supabase
    .from("products")
    .insert({
      name: input.name,
      sku,
      barcode: input.barcode || null,
      variant: input.variant || null,
      category: input.category || null,
      rack_location: input.rackLocation || null,
      purchase_cost: input.purchaseCost,
      mrp: input.mrp,
      sale_price: input.salePrice,
      min_sale_price: input.minSalePrice ?? 0,
      uom_sale: input.uom,
      uom_stock: input.uom,
      uom_purchase: input.uom,
      enrichment_status: "PENDING",
    })
    .select()
    .single();
  if (error) throw error;
  const product = data as Product;
  if (input.openingQty > 0) {
    await supabase.from("inventory").insert({
      product_id: product.id,
      location_id: input.locationId,
      quantity_on_hand: input.openingQty,
    });
  }
  return product;
}

export async function addCustomer(input: {
  name: string;
  mobile: string | null;
  creditLimit: number;
  ageGroup?: string | null;
  gender?: string | null;
}): Promise<Customer> {
  const { data, error } = await supabase
    .from("customers")
    .insert({
      name: input.name,
      mobile: input.mobile || null,
      credit_limit: input.creditLimit,
      age_group: input.ageGroup || null,
      gender: input.gender || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Customer;
}

export async function requestIndent(input: {
  fromLocationId: string;
  toLocationId: string;
  productId: string;
  quantity: number;
  notes: string | null;
}) {
  const { data, error } = await supabase
    .from("stock_transfers")
    .insert({
      from_location_id: input.fromLocationId,
      to_location_id: input.toLocationId,
      status: "REQUESTED",
      notes: input.notes,
    })
    .select()
    .single();
  if (error) throw error;
  const transfer = data as StockTransfer;
  const { error: itemError } = await supabase.from("stock_transfer_items").insert({
    transfer_id: transfer.id,
    product_id: input.productId,
    quantity: input.quantity,
  });
  if (itemError) throw itemError;
  return transfer;
}

export async function createTransfer(input: {
  fromLocationId: string;
  toLocationId: string;
  items: Array<{ product_id: string; quantity: number }>;
  notes: string | null;
}) {
  const { data, error } = await supabase
    .from("stock_transfers")
    .insert({
      from_location_id: input.fromLocationId,
      to_location_id: input.toLocationId,
      status: "REQUESTED",
      notes: input.notes,
    })
    .select()
    .single();
  if (error) throw error;
  const transfer = data as StockTransfer;
  const { error: itemError } = await supabase
    .from("stock_transfer_items")
    .insert(input.items.map((i) => ({ ...i, transfer_id: transfer.id })));
  if (itemError) throw itemError;
  return transfer;
}

export async function setTransferStatus(transferId: string, status: string) {
  const { error } = await supabase
    .from("stock_transfers")
    .update({ status })
    .eq("id", transferId);
  if (error) throw error;
}

export async function receiveTransfer(transferId: string) {
  const { error } = await supabase.rpc("receive_stock_transfer", {
    p_transfer_id: transferId,
  });
  if (error) throw error;
}

export async function createAdjustment(input: {
  productId: string;
  locationId: string;
  quantity: number;
  reason: string;
  returnable: boolean;
}) {
  const { error } = await supabase.rpc("create_stock_adjustment", {
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_returnable: input.returnable,
  });
  if (error) throw error;
}

export async function openSession(input: {
  locationId: string;
  openedBy: string;
  openingCash: number;
  openingDenominations?: Record<number, number> | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("open_cash_session", {
    p_location_id: input.locationId,
    p_opened_by: input.openedBy,
    p_opening_cash: input.openingCash,
    p_opening_denominations: (input.openingDenominations ?? null) as unknown as Json,
  });
  if (error) throw error;
  return data as string;
}

export async function closeSession(input: {
  sessionId: string;
  cashIn: number | null;
  cashOut: number | null;
  countedCash: number | null;
  closingDenominations?: Record<number, number> | null;
}): Promise<{ cash_sales: number; expected_cash: number; difference: number }> {
  const { data, error } = await supabase.rpc("close_cash_session", {
    p_session_id: input.sessionId,
    p_cash_in: (input.cashIn ?? null) as unknown as number,
    p_cash_out: (input.cashOut ?? null) as unknown as number,
    p_counted_cash: (input.countedCash ?? null) as unknown as number,
    p_closing_denominations: (input.closingDenominations ?? null) as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as { cash_sales: number; expected_cash: number; difference: number };
}

export function computePaymentStatus(total: number, paid: number): "PAID" | "PARTIALLY_PAID" | "UNPAID" {
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
  return useQuery<StockMovement[]>({
    enabled: !!locationId,
    queryKey: ["stock-movements", locationId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*, products(name), locations(name)")
        .eq("location_id", locationId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as StockMovement[];
    },
  });
}

/** Every movement of one product — used by the per-item history drawer. */
export function useProductMovements(productId: string | null, limit = 200) {
  return useQuery<StockMovement[]>({
    enabled: !!productId,
    queryKey: ["stock-movements-product", productId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*, locations(name)")
        .eq("product_id", productId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as StockMovement[];
    },
  });
}

/* ----------------------- auto-SKU & legacy stock ------------------------- */

/** SKU-YYMMDD-XXX, counted from today's existing quick-add SKUs. */
export async function generateSku(): Promise<string> {
  const d = new Date();
  const prefix = `SKU-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}-`;
  const { count, error } = await supabase
    .from("products")
    .select("sku", { count: "exact", head: true })
    .like("sku", `${prefix}%`);
  if (error) throw error;
  return `${prefix}${String((count ?? 0) + 1).padStart(3, "0")}`;
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
export function exportSheets(filename: string, sheets: SheetData[]) {
  const XLSX = (globalThis as { XLSXLib?: typeof import("xlsx") }).XLSXLib;
  if (!XLSX) throw new Error("xlsx missing");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

/** Parse an uploaded .xlsx/.xls/.csv file into sheet name + row objects. */
export async function parseWorkbookFile(file: File): Promise<SheetData[]> {
  const XLSX = (globalThis as { XLSXLib?: typeof import("xlsx") }).XLSXLib;
  if (!XLSX) throw new Error("xlsx missing");
  const wb = XLSX.read(await file.arrayBuffer());
  return wb.SheetNames.map((n) => ({
    name: n,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null }),
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
