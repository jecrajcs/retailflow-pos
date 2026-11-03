import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  purchase_cost: number;
  mrp: number;
  sale_price: number;
  uom_purchase: string;
  uom_stock: string;
  uom_sale: string;
  conversion_factor: number;
  min_stock: number;
  is_loose: boolean;
  enrichment_status: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string | null;
  age_group: string | null;
  gender: string | null;
  credit_limit: number;
  outstanding_balance: number;
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
}

export interface CartLine {
  product: Product;
  quantity: number;
  unit_price: number;
  uom: string;
  discount: number;
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
        .select("id, invoice_id, amount, mode, created_at, invoices!inner(location_id)")
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
  payments: Array<{ amount: number; mode: string }>;
}): Promise<InvoiceResult> {
  const { data, error } = await supabase.rpc("create_pos_invoice", {
    p_location_id: input.locationId,
    p_customer_id: input.customerId,
    p_discount: input.discount,
    p_items: input.items,
    p_payments: input.payments,
  });
  if (error) throw error;
  return data as InvoiceResult;
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

export async function quickAddProduct(input: {
  name: string;
  salePrice: number;
  purchaseCost: number;
  mrp: number;
  uom: string;
  locationId: string;
  openingQty: number;
}): Promise<Product> {
  const { data, error } = await supabase
    .from("products")
    .insert({
      name: input.name,
      purchase_cost: input.purchaseCost,
      mrp: input.mrp,
      sale_price: input.salePrice,
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
}): Promise<Customer> {
  const { data, error } = await supabase
    .from("customers")
    .insert({
      name: input.name,
      mobile: input.mobile || null,
      credit_limit: input.creditLimit,
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
}): Promise<string> {
  const { data, error } = await supabase.rpc("open_cash_session", {
    p_location_id: input.locationId,
    p_opened_by: input.openedBy,
    p_opening_cash: input.openingCash,
  });
  if (error) throw error;
  return data as string;
}

export async function closeSession(input: {
  sessionId: string;
  cashIn: number;
  cashOut: number;
  countedCash: number | null;
}): Promise<{ cash_sales: number; expected_cash: number; difference: number }> {
  const { data, error } = await supabase.rpc("close_cash_session", {
    p_session_id: input.sessionId,
    p_cash_in: input.cashIn,
    p_cash_out: input.cashOut,
    p_counted_cash: input.countedCash,
  });
  if (error) throw error;
  return data as { cash_sales: number; expected_cash: number; difference: number };
}

export function computePaymentStatus(total: number, paid: number): "PAID" | "PARTIALLY_PAID" | "UNPAID" {
  if (paid >= total) return "PAID";
  if (paid > 0) return "PARTIALLY_PAID";
  return "UNPAID";
}
