import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { StaffAccessProfile } from "@/lib/retail-auth.server";

export type RetailRow = Record<string, unknown>;

type DataApiQuery = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}> & {
  range: (from: number, to: number) => DataApiQuery;
};

type DataApi = {
  from: (table: string) => {
    select: (columns?: string) => DataApiQuery;
  };
};

const REMOTE_TABLES = [
  "products",
  "customers",
  "inventory",
  "invoices",
  "invoice_items",
  "payments",
  "stock_movements",
  "cashier_shortcuts",
  "cash_drawer_sessions",
  "purchase_receipts",
  "purchase_receipt_items",
  "cash_transactions",
  "stock_transfers",
  "stock_transfer_items",
  "stock_adjustments",
  "inventory_sync_alerts",
] as const;

type PublicInvoiceQuery = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}> & {
  eq: (column: string, value: string) => PublicInvoiceQuery;
};

type PublicOverviewClient = {
  from: (table: "invoices") => {
    select: (columns: string) => PublicInvoiceQuery;
  };
};

export function businessDateInIndia(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function summarizePublicInvoices(rows: unknown, businessDate: string) {
  const completedInvoices = Array.isArray(rows)
    ? rows.filter(
        (row) =>
          row !== null &&
          typeof row === "object" &&
          "invoice_status" in row &&
          row.invoice_status === "COMPLETED" &&
          "business_date" in row &&
          row.business_date === businessDate,
      )
    : [];
  const salesTotal = completedInvoices.reduce((sum, invoice) => {
    const amount =
      invoice !== null && typeof invoice === "object" && "total_amount" in invoice
        ? Number(invoice.total_amount)
        : 0;
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  return {
    business_date: businessDate,
    completed_bills: completedInvoices.length,
    sales_total: Math.round(salesTotal * 100) / 100,
  };
}

export async function loadPublicOverview(
  client: PublicOverviewClient = supabaseAdmin as unknown as PublicOverviewClient,
  now = new Date(),
) {
  const businessDate = businessDateInIndia(now);
  const { data, error } = await client
    .from("invoices")
    .select("total_amount,invoice_status,business_date")
    .eq("invoice_status", "COMPLETED")
    .eq("business_date", businessDate);
  if (error) throw new Error(`Could not load public dashboard totals: ${error.message}`);
  return summarizePublicInvoices(data, businessDate);
}

export function projectStaffSensitiveTables(
  products: RetailRow[],
  customers: RetailRow[],
  role: StaffAccessProfile["role"],
) {
  if (role !== "CASHIER") return { products, customers };

  return {
    products: products.map(
      ({ purchase_cost: _purchaseCost, preferred_supplier: _supplier, ...product }) => product,
    ),
    customers: customers.map(
      ({ age_group: _ageGroup, gender: _gender, visits: _visits, notes: _notes, ...customer }) =>
        customer,
    ),
  };
}

async function selectAll(table: string): Promise<RetailRow[]> {
  const client = supabaseAdmin as unknown as DataApi;
  const rows: RetailRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Could not load ${table}: ${error.message}`);
    const page = Array.isArray(data) ? (data as RetailRow[]) : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function locationIsVisible(
  profile: StaffAccessProfile,
  locationId: unknown,
  allowedLocations: Set<string>,
) {
  const id = typeof locationId === "string" ? locationId : "";
  return profile.role === "ADMIN" || allowedLocations.has(id);
}

export async function loadAuthorizedSnapshot(profile: StaffAccessProfile) {
  const [locations, ...tableRows] = await Promise.all([
    selectAll("locations"),
    ...REMOTE_TABLES.map((table) => selectAll(table)),
  ]);
  const rowsByTable = new Map<string, RetailRow[]>(
    REMOTE_TABLES.map((table, index) => [table, tableRows[index] ?? []]),
  );
  const allowedLocations = new Set(
    profile.role === "ADMIN"
      ? locations.filter((row) => row["is_active"] !== false).map((row) => String(row["id"]))
      : profile.location_ids,
  );
  const visibleLocations = locations.filter(
    (row) => row["is_active"] !== false && locationIsVisible(profile, row["id"], allowedLocations),
  );
  const invoices = (rowsByTable.get("invoices") ?? []).filter((row) =>
    locationIsVisible(profile, row["location_id"], allowedLocations),
  );
  const invoiceIds = new Set(invoices.map((row) => String(row["id"])));
  const transfers = (rowsByTable.get("stock_transfers") ?? []).filter(
    (row) =>
      locationIsVisible(profile, row["from_location_id"], allowedLocations) ||
      locationIsVisible(profile, row["to_location_id"], allowedLocations),
  );
  const transferIds = new Set(transfers.map((row) => String(row["id"])));
  const receipts =
    profile.role === "ADMIN" || profile.role === "MANAGER"
      ? (rowsByTable.get("purchase_receipts") ?? []).filter((row) =>
          locationIsVisible(profile, row["warehouse_location_id"], allowedLocations),
        )
      : [];
  const receiptIds = new Set(receipts.map((row) => String(row["id"])));
  const purchases = profile.role === "ADMIN" || profile.role === "MANAGER";
  const { products, customers } = projectStaffSensitiveTables(
    rowsByTable.get("products") ?? [],
    rowsByTable.get("customers") ?? [],
    profile.role,
  );
  const tables: Record<string, RetailRow[]> = {
    locations: visibleLocations,
    products,
    customers,
    inventory: (rowsByTable.get("inventory") ?? []).filter((row) =>
      locationIsVisible(profile, row["location_id"], allowedLocations),
    ),
    invoices,
    invoice_items: (rowsByTable.get("invoice_items") ?? []).filter((row) =>
      invoiceIds.has(String(row["invoice_id"])),
    ),
    payments: (rowsByTable.get("payments") ?? []).filter((row) =>
      invoiceIds.has(String(row["invoice_id"])),
    ),
    stock_movements: (rowsByTable.get("stock_movements") ?? []).filter((row) =>
      locationIsVisible(profile, row["location_id"], allowedLocations),
    ),
    cashier_shortcuts: (rowsByTable.get("cashier_shortcuts") ?? []).filter((row) =>
      locationIsVisible(profile, row["location_id"], allowedLocations),
    ),
    cash_drawer_sessions: (rowsByTable.get("cash_drawer_sessions") ?? []).filter((row) =>
      locationIsVisible(profile, row["location_id"], allowedLocations),
    ),
    purchase_receipts: receipts,
    purchase_receipt_items: purchases
      ? (rowsByTable.get("purchase_receipt_items") ?? []).filter((row) =>
          receiptIds.has(String(row["receipt_id"])),
        )
      : [],
    cash_transactions: (rowsByTable.get("cash_transactions") ?? []).filter((row) =>
      locationIsVisible(profile, row["location_id"], allowedLocations),
    ),
    stock_transfers: transfers,
    stock_transfer_items: (rowsByTable.get("stock_transfer_items") ?? []).filter((row) =>
      transferIds.has(String(row["transfer_id"])),
    ),
    stock_adjustments:
      profile.role === "ADMIN" || profile.role === "MANAGER"
        ? (rowsByTable.get("stock_adjustments") ?? []).filter((row) =>
            locationIsVisible(profile, row["location_id"], allowedLocations),
          )
        : [],
    inventory_sync_alerts:
      profile.role === "ADMIN" || profile.role === "MANAGER"
        ? (rowsByTable.get("inventory_sync_alerts") ?? []).filter((row) =>
            locationIsVisible(profile, row["location_id"], allowedLocations),
          )
        : [],
  };
  return { tables };
}

export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof Response) return error;
  if (error instanceof SyntaxError) {
    return jsonResponse(
      { error: "Some request details were invalid. Review them and try again." },
      400,
    );
  }

  if (error instanceof Error && error.name === "AuthConfigurationError") {
    console.error("RetailFlow staff authentication is not configured.", error);
    return jsonResponse(
      {
        error: "Staff sign-in is temporarily unavailable. Please contact your store administrator.",
      },
      503,
    );
  }

  if (error instanceof Error && error.name === "SupabaseServerConfigurationError") {
    console.error("RetailFlow server database configuration is incomplete.", error);
    return jsonResponse(
      { error: "RetailFlow services are temporarily unavailable. Please try again later." },
      503,
    );
  }

  console.error(error);
  return jsonResponse({ error: fallback }, 500);
}

export function asRecord(value: unknown): RetailRow | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RetailRow)
    : null;
}
