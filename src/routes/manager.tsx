import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Download,
  FileSpreadsheet,
  PackageMinus,
  Tag,
  Upload,
  UserRoundCog,
  Zap,
  CircleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { AppNav } from "@/components/pos/app-nav";
import { DataTable } from "@/components/pos/data-table";
import { WorkbookImporter } from "@/components/pos/workbook-importer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StaffAccessPanel } from "@/components/pos/staff-access-panel";
import {
  createAdjustment,
  createTransfer,
  addCustomer,
  quickAddProduct,
  legacyStockSet,
  inr,
  exportSheets,
  parseWorkbookFile,
  pickField,
  formatPriceTiers,
  parsePriceTiers,
  REASONS,
  receiveTransfer,
  setTransferStatus,
  updateProductProfile,
  updateCustomer,
  matchesSearchFields,
  useStockTransfers,
  useTransferItems,
  useStockAdjustments,
  useCustomers,
  useSales,
  useShortcutTiles,
  saveShortcutTiles,
  useLocations,
  useInventory,
  useProducts,
  useSyncAlerts,
  type Product,
} from "@/lib/pos";
import { canAccessLocation, saveActiveLocation, useAccess } from "@/lib/access";
import { retailApi, userFacingError } from "@/lib/retail-api";
import { refreshLocalReplica } from "@/lib/offline-sync";

export const Route = createFileRoute("/manager")({
  head: () => ({
    meta: [
      { title: "RetailHub POS — Manager" },
      {
        name: "description",
        content: "Catalog enrichment queue, stock transfer requests and damage/expiry write-offs.",
      },
      { property: "og:title", content: "RetailHub POS — Manager" },
      {
        property: "og:description",
        content: "Catalog enrichment queue, stock transfer requests and damage/expiry write-offs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ManagerPage,
});

const LS_KEY = "pos-location-id";

interface TransferItemRow {
  id: string;
  transfer_id: string;
  product_id: string;
  quantity: number;
  products?: { name: string } | null;
}

interface AdjustmentRow {
  id: string;
  product_id: string;
  location_id: string;
  quantity: number;
  reason: string;
  returnable_to_vendor: boolean;
  cost_loss: number;
  created_at: string;
  products?: { name: string } | null;
  locations?: { name: string } | null;
}

function ManagerPage() {
  const queryClient = useQueryClient();
  const { profile } = useAccess();
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const allowedLocations = locations.filter((item) => canAccessLocation(profile, item.id));
  const [locationId, setLocationId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "");
  const location = allowedLocations.find((l) => l.id === locationId) ?? allowedLocations[0];
  const { data: allTransfers = [] } = useStockTransfers();
  const { data: allTransferItems = [] } = useTransferItems();
  const { data: allAdjustments = [] } = useStockAdjustments();
  const { data: customers = [] } = useCustomers();
  const { data: sales = [] } = useSales();
  const { data: shortcutRows = [] } = useShortcutTiles();
  const { data: syncAlerts = [] } = useSyncAlerts();
  const transfers = allTransfers.filter(
    (row) =>
      canAccessLocation(profile, row.from_location_id) ||
      canAccessLocation(profile, row.to_location_id),
  );
  const transferItems: TransferItemRow[] = allTransferItems.map((item) => ({
    ...item,
    products: { name: products.find((product) => product.id === item["product_id"])?.name ?? "?" },
  })) as TransferItemRow[];
  const adjustments: AdjustmentRow[] = allAdjustments
    .filter((row) => canAccessLocation(profile, String(row["location_id"])))
    .map((row) => ({
      ...row,
      products: { name: products.find((product) => product.id === row["product_id"])?.name ?? "—" },
      locations: { name: locations.find((entry) => entry.id === row["location_id"])?.name ?? "—" },
    })) as AdjustmentRow[];

  const locName = (id: string) =>
    canAccessLocation(profile, id)
      ? (locations.find((l) => l.id === id)?.name ?? "—")
      : "Restricted location";

  const statusMut = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "dispatch" | "receive" }) => {
      if (action === "dispatch") await setTransferStatus(id, "IN_TRANSIT");
      else await receiveTransfer(id);
    },
    onSuccess: (_, vars) => {
      toast.success(vars.action === "dispatch" ? "Marked in transit" : "Stock received");
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["transfer-items"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e) =>
      toast.error("Action failed", {
        description: userFacingError(e, "The inventory action could not be completed."),
      }),
  });

  const adjustMut = useMutation({
    mutationFn: createAdjustment,
    onSuccess: () => {
      toast.success("Write-off recorded");
      void queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e) =>
      toast.error("Write-off failed", {
        description: userFacingError(e, "The stock write-off could not be completed."),
      }),
  });

  const totalLoss = useMemo(() => adjustments.reduce((s, a) => s + a.cost_loss, 0), [adjustments]);

  if (profile?.role !== "MANAGER")
    return (
      <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
        <AppNav active="/manager" />
        <main className="m-auto max-w-lg rounded-xl border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">
            {profile?.role === "ADMIN" ? "Use the Admin console" : "Manager access required"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {profile?.role === "ADMIN"
              ? "Network-wide administration has a separate workspace."
              : "This account cannot access store management tools."}
          </p>
          {profile?.role === "ADMIN" && (
            <Button asChild className="mt-4">
              <Link to="/admin">Open Admin console</Link>
            </Button>
          )}
        </main>
      </div>
    );

  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/manager" />
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <SearchableSelect
          className="w-64"
          value={location?.id ?? ""}
          onValueChange={(id) => {
            setLocationId(id);
            saveActiveLocation(id);
          }}
          placeholder="Select store"
          options={allowedLocations.map((l) => ({
            value: l.id,
            label: `${l.name} (${l.type})`,
            keywords: [l.code],
          }))}
        />
      </div>

      <main className="mx-auto min-h-0 w-full max-w-[1200px] flex-1 overflow-y-auto p-3">
        <Tabs defaultValue="enrichment">
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="enrichment" className="gap-1.5">
              <Tag className="h-3.5 w-3.5" /> Catalog Queue
            </TabsTrigger>
            <TabsTrigger value="transfers" className="gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5" /> Stock Transfers
            </TabsTrigger>
            <TabsTrigger value="writeoffs" className="gap-1.5">
              <PackageMinus className="h-3.5 w-3.5" /> Damage / Expiry
            </TabsTrigger>
            <TabsTrigger value="spreadsheets" className="gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Spreadsheets
            </TabsTrigger>
            <TabsTrigger value="customers" className="gap-1.5">
              <UserRoundCog className="h-3.5 w-3.5" /> Customer profiles
            </TabsTrigger>
            <TabsTrigger value="shortcuts" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Cashier shortcuts
            </TabsTrigger>
            {profile?.role === "MANAGER" && (
              <TabsTrigger value="staff" className="gap-1.5">
                <UserRoundCog className="h-3.5 w-3.5" /> Cashier access
              </TabsTrigger>
            )}
            <TabsTrigger value="sync-alerts" className="gap-1.5">
              <CircleAlert className="h-3.5 w-3.5" /> Sync alerts
              {syncAlerts.filter((alert) => !alert.resolved_at).length
                ? ` (${syncAlerts.filter((alert) => !alert.resolved_at).length})`
                : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="enrichment" className="mt-3">
            <EnrichmentQueue
              products={products.filter((p) => p.enrichment_status !== "COMPLETE")}
            />
          </TabsContent>

          <TabsContent value="transfers" className="mt-3 space-y-3">
            <NewTransferCard
              locations={allowedLocations}
              products={products}
              defaultFromId={allowedLocations.find((l) => l.type === "WAREHOUSE")?.id ?? ""}
              onCreated={() => void queryClient.invalidateQueries({ queryKey: ["transfers"] })}
            />
            <DataTable
              rows={transfers}
              getRowId={(row) => row.id}
              searchPlaceholder="Search transfers…"
              emptyMessage="No transfers recorded."
              columns={[
                {
                  id: "created",
                  header: "Created",
                  accessor: (row) => row.created_at,
                  cell: (row) =>
                    new Date(row.created_at).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }),
                },
                {
                  id: "route",
                  header: "Route",
                  accessor: (row) =>
                    `${locName(row.from_location_id)} → ${locName(row.to_location_id)}`,
                },
                {
                  id: "items",
                  header: "Items",
                  accessor: (row) =>
                    transferItems
                      .filter((item) => item.transfer_id === row.id)
                      .map((item) => `${item.products?.name ?? "?"} ×${item.quantity}`)
                      .join(", "),
                },
                {
                  id: "status",
                  header: "Status",
                  accessor: (row) => row.status,
                  cell: (row) => (
                    <Badge
                      variant="outline"
                      className={cn(
                        row.status === "REQUESTED" && "border-amber-500/50 text-amber-600",
                        row.status === "IN_TRANSIT" && "border-blue-500/50 text-blue-600",
                        row.status === "RECEIVED" && "border-success/50 text-success",
                      )}
                    >
                      {row.status}
                    </Badge>
                  ),
                },
                {
                  id: "action",
                  header: "Action",
                  accessor: (row) => row.status,
                  sortable: false,
                  cell: (row) => (
                    <div className="flex gap-1">
                      {row.status === "REQUESTED" &&
                        canAccessLocation(profile, row.from_location_id) && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={statusMut.isPending}
                            onClick={() => statusMut.mutate({ id: row.id, action: "dispatch" })}
                          >
                            Dispatch
                          </Button>
                        )}
                      {row.status === "IN_TRANSIT" &&
                        canAccessLocation(profile, row.to_location_id) && (
                          <Button
                            size="sm"
                            disabled={statusMut.isPending}
                            onClick={() => statusMut.mutate({ id: row.id, action: "receive" })}
                          >
                            Receive
                          </Button>
                        )}
                    </div>
                  ),
                },
              ]}
            />
          </TabsContent>

          <TabsContent value="writeoffs" className="mt-3 space-y-3">
            <NewWriteOffCard
              locations={allowedLocations}
              products={products}
              locationId={location?.id ?? ""}
              busy={adjustMut.isPending}
              onSubmit={(input) => adjustMut.mutate(input)}
            />
            <div className="text-sm text-muted-foreground">
              Total cost loss in last {adjustments.length} write-offs:{" "}
              <b className="text-destructive">{inr(totalLoss)}</b>
            </div>
            <DataTable<AdjustmentRow>
              rows={adjustments}
              getRowId={(row) => row.id}
              searchPlaceholder="Search adjustments…"
              emptyMessage="No stock adjustments recorded."
              columns={[
                {
                  id: "when",
                  header: "When",
                  accessor: (row) => row.created_at,
                  cell: (row) =>
                    new Date(row.created_at).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }),
                },
                { id: "product", header: "Product", accessor: (row) => row.products?.name ?? "—" },
                {
                  id: "location",
                  header: "Location",
                  accessor: (row) => row.locations?.name ?? "—",
                },
                { id: "quantity", header: "Qty", accessor: (row) => row.quantity },
                {
                  id: "reason",
                  header: "Reason",
                  accessor: (row) => row.reason,
                  cell: (row) => <Badge variant="outline">{row.reason}</Badge>,
                },
                {
                  id: "returnable",
                  header: "Returnable",
                  accessor: (row) => (row.returnable_to_vendor ? "Yes" : "No"),
                },
                {
                  id: "cost",
                  header: "Cost loss",
                  accessor: (row) => row.cost_loss,
                  cell: (row) => <span className="text-destructive">{inr(row.cost_loss)}</span>,
                },
              ]}
            />
          </TabsContent>
          <TabsContent value="spreadsheets" className="mt-3 space-y-4">
            <WorkbookImporter locations={allowedLocations} />
            <SpreadsheetTools
              products={products}
              locations={allowedLocations}
              locationId={location?.id ?? ""}
            />
          </TabsContent>
          <TabsContent value="customers" className="mt-3">
            <CustomerManagement customers={customers} />
          </TabsContent>
          <TabsContent value="shortcuts" className="mt-3">
            <ShortcutTileManager
              locations={allowedLocations}
              products={products}
              shortcutRows={shortcutRows}
              defaultLocationId={location?.id ?? ""}
            />
          </TabsContent>
          {profile?.role === "MANAGER" && (
            <TabsContent value="staff" className="mt-3">
              <StaffAccessPanel mode="manager" locations={allowedLocations} />
            </TabsContent>
          )}
          <TabsContent value="sync-alerts" className="mt-3">
            <SyncAlertList
              alerts={syncAlerts.filter((alert) => canAccessLocation(profile, alert.location_id))}
              locations={locations}
              products={products}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SyncAlertList({
  alerts,
  locations,
  products,
}: {
  alerts: Array<{
    id: string;
    operation_id: string;
    product_id: string;
    location_id: string;
    resulting_quantity: number;
    message: string;
    resolved_at: string | null;
    created_at: string;
  }>;
  locations: Array<{ id: string; name: string; code: string }>;
  products: Product[];
}) {
  const { online } = useAccess();
  const activeAlerts = alerts
    .filter((alert) => !alert.resolved_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  async function resolve(alertId: string) {
    try {
      await retailApi<{ ok: boolean }>("/api/resolve-sync-alert", {
        method: "POST",
        json: { alert_id: alertId },
      });
      await refreshLocalReplica();
      toast.success("Alert marked reviewed");
    } catch (error) {
      toast.error("Could not update alert", {
        description: userFacingError(error, "Refresh the alert list and try again."),
      });
    }
  }
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-semibold">Inventory sync discrepancies</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Offline bills stay saved. These alerts flag stock that went below zero when devices
          reconciled their local snapshots.
        </p>
      </div>
      <DataTable
        rows={activeAlerts}
        getRowId={(alert) => alert.id}
        searchPlaceholder="Search product, location or discrepancy…"
        emptyMessage="No unresolved stock sync alerts."
        columns={[
          {
            id: "product",
            header: "Product",
            accessor: (alert) =>
              products.find((product) => product.id === alert.product_id)?.name ??
              "Unknown product",
          },
          {
            id: "location",
            header: "Location",
            accessor: (alert) =>
              locations.find((location) => location.id === alert.location_id)?.name ?? "Location",
          },
          { id: "issue", header: "Discrepancy", accessor: (alert) => alert.message },
          { id: "stock", header: "Server stock", accessor: (alert) => alert.resulting_quantity },
          {
            id: "created",
            header: "Reported",
            accessor: (alert) => alert.created_at,
            cell: (alert) => new Date(alert.created_at).toLocaleString(),
          },
          {
            id: "action",
            header: "",
            accessor: () => "Review",
            sortable: false,
            cell: (alert) => (
              <Button
                variant="outline"
                size="sm"
                disabled={!online}
                onClick={() => void resolve(alert.id)}
              >
                Mark reviewed
              </Button>
            ),
          },
        ]}
      />
    </section>
  );
}

function SpreadsheetTools({
  products,
  locations,
  locationId,
}: {
  products: Product[];
  locations: Array<{ id: string; name: string; code: string; type: string }>;
  locationId: string;
}) {
  const { data: inventory = [] } = useInventory();
  const { data: customers = [] } = useCustomers();
  const { data: sales = [] } = useSales();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"products" | "customers" | "stock">("products");
  const [busy, setBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewName, setPreviewName] = useState("");
  const [rowIssues, setRowIssues] = useState<Array<{ row: number; issue: string }>>([]);

  async function downloadTemplate(template: "products" | "customers" | "stock") {
    const examples: Record<typeof template, Record<string, unknown>> = {
      products: {
        name: "Sample item",
        name_hi: "नमूना सामान",
        search_aliases: "sample|namuna",
        sku: "SKU-001",
        barcode: "8900000000000",
        category: "Grocery",
        variant: "1kg",
        hsn: "",
        purchase_cost: 50,
        mrp: 75,
        sale_price: 70,
        min_sale_price: 60,
        price_tiers: "Small:6:68; Medium:12:64",
        min_stock: 5,
        uom_purchase: "Pcs",
        uom_stock: "Pcs",
        uom_sale: "Pcs",
        rack_location: "Rack S1",
      },
      customers: {
        name: "Customer name",
        mobile: "",
        age_group: "Adult",
        gender: "",
        credit_limit: 0,
        outstanding_balance: 0,
        visits: 0,
      },
      stock: { sku: "SKU-001", location_code: "OUTLET1", quantity_on_hand: 10 },
    };
    try {
      await exportSheets(`retailhub-${template}-template.xlsx`, [
        { name: template, rows: [examples[template]] },
      ]);
    } catch (error) {
      toast.error("Template download failed", {
        description: userFacingError(error, "Check the spreadsheet and try importing it again."),
      });
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const sheets = await parseWorkbookFile(file);
      const rows = sheets.flatMap((sheet) => sheet.rows);
      setPreviewRows(rows);
      setPreviewName(file.name);
      setRowIssues(validateRows(rows));
      toast.success(`${rows.length} rows ready to review`, {
        description: "Nothing is imported until you confirm the preview.",
      });
    } catch (error) {
      toast.error("Spreadsheet import failed", {
        description: userFacingError(
          error,
          "Check the file format and required columns, then try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  const validateRows = useCallback(
    (rows: Array<Record<string, unknown>>) => {
      const issues: Array<{ row: number; issue: string }> = [];
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        if (kind === "products") {
          const name = String(pickField(row, ["name", "productname", "item"]) ?? "").trim();
          const sku = String(pickField(row, ["sku", "productsku"]) ?? "").trim();
          const barcode = String(pickField(row, ["barcode", "ean"]) ?? "").trim();
          if (!name) issues.push({ row: index + 2, issue: "Product name is required." });
          if (!(Number(pickField(row, ["saleprice", "sellingprice"])) > 0))
            issues.push({ row: index + 2, issue: "Sale price must be greater than zero." });
          try {
            const tiers = parsePriceTiers(
              pickField(row, ["pricetiers", "quantitytiers", "wholesaleprices"]),
            );
            const retailPrice = Number(pickField(row, ["saleprice", "sellingprice"])) || 0;
            const floorPrice = Number(pickField(row, ["minsaleprice", "floorprice"])) || 0;
            if (tiers.some((tier) => tier.unit_price < floorPrice || tier.unit_price > retailPrice))
              issues.push({
                row: index + 2,
                issue: "Quantity prices must be between minimum allowed price and retail price.",
              });
          } catch (error) {
            issues.push({
              row: index + 2,
              issue: userFacingError(error, "Enter valid quantity prices."),
            });
          }
          const duplicate = products.some(
            (product) =>
              (sku && product.sku?.toLowerCase() === sku.toLowerCase()) ||
              (barcode && product.barcode === barcode),
          );
          const fingerprint = sku
            ? `sku:${sku.toLowerCase()}`
            : barcode
              ? `barcode:${barcode}`
              : "";
          if (duplicate || (fingerprint && seen.has(fingerprint)))
            issues.push({ row: index + 2, issue: "Duplicate SKU or barcode." });
          if (fingerprint) seen.add(fingerprint);
        } else if (kind === "customers") {
          const name = String(pickField(row, ["name", "customername"]) ?? "").trim();
          const mobile = String(pickField(row, ["mobile", "phone", "phonenumber"]) ?? "").trim();
          if (!name) issues.push({ row: index + 2, issue: "Customer name is required." });
          const duplicate = customers.some(
            (customer) =>
              customer.name.trim().toLowerCase() === name.toLowerCase() &&
              (customer.mobile ?? "") === mobile,
          );
          const fingerprint = `${name.toLowerCase()}|${mobile}`;
          if ((mobile && duplicate) || (mobile && seen.has(fingerprint)))
            issues.push({
              row: index + 2,
              issue:
                "Exact customer name and phone already exist. Different family members sharing a phone are allowed.",
            });
          if (mobile) seen.add(fingerprint);
        } else {
          const sku = String(pickField(row, ["sku", "productsku", "barcode"]) ?? "").trim();
          const code = String(pickField(row, ["locationcode", "location"]) ?? "").trim();
          const product = products.find(
            (item) => item.sku?.toLowerCase() === sku.toLowerCase() || item.barcode === sku,
          );
          const target =
            locations.find(
              (item) => item.code.toLowerCase() === code.toLowerCase() || item.id === code,
            ) ?? locations.find((item) => item.id === locationId);
          const quantity = Number(
            pickField(row, ["quantityonhand", "quantity", "openingstock", "stock"]),
          );
          if (!product)
            issues.push({ row: index + 2, issue: "SKU/barcode does not match a product." });
          if (!target) issues.push({ row: index + 2, issue: "Location code is unknown." });
          if (!Number.isFinite(quantity) || quantity < 0)
            issues.push({ row: index + 2, issue: "Quantity must be zero or greater." });
          const fingerprint = product && target ? `${product.id}:${target.id}` : "";
          if (fingerprint && seen.has(fingerprint))
            issues.push({ row: index + 2, issue: "Duplicate product/location stock row." });
          if (fingerprint) seen.add(fingerprint);
        }
      });
      return issues;
    },
    [kind, products, customers, locations, locationId],
  );

  useEffect(() => {
    if (previewRows.length) setRowIssues(validateRows(previewRows));
  }, [previewRows, validateRows]);

  async function confirmImport() {
    if (!previewRows.length || busy) return;
    setBusy(true);
    const invalidRows = new Set(rowIssues.map((issue) => issue.row - 2));
    let imported = 0;
    const failures: string[] = [];
    try {
      for (let index = 0; index < previewRows.length; index++) {
        if (invalidRows.has(index)) continue;
        const row = previewRows[index]!;
        try {
          if (kind === "products") {
            const name = String(pickField(row, ["name", "productname", "item"]) ?? "").trim();
            const aliases = String(pickField(row, ["searchaliases", "aliases"]) ?? "")
              .split(/[|,;]/)
              .map((value) => value.trim())
              .filter(Boolean);
            await quickAddProduct({
              name,
              nameHi: String(pickField(row, ["namehi", "hindiname"]) ?? "") || null,
              searchAliases: aliases,
              ...(String(pickField(row, ["sku", "productsku"]) ?? "")
                ? { sku: String(pickField(row, ["sku", "productsku"])) }
                : {}),
              barcode: String(pickField(row, ["barcode", "ean"]) ?? "") || null,
              variant: String(pickField(row, ["variant", "size"]) ?? "") || null,
              category: String(pickField(row, ["category"]) ?? "") || null,
              rackLocation: String(pickField(row, ["racklocation", "rack"]) ?? "") || null,
              salePrice: Number(pickField(row, ["saleprice", "sellingprice"])),
              priceTiers: parsePriceTiers(
                pickField(row, ["pricetiers", "quantitytiers", "wholesaleprices"]),
              ),
              minSalePrice: Number(pickField(row, ["minsaleprice", "floorprice"])) || 0,
              purchaseCost: Number(pickField(row, ["purchasecost", "cost"])) || 0,
              mrp: Number(pickField(row, ["mrp"])) || 0,
              uom: String(pickField(row, ["uomstock", "uom"]) ?? "Pcs"),
              minStock: Number(pickField(row, ["minstock", "reorderlevel"])) || 0,
              locationId,
              openingQty: 0,
            });
          } else if (kind === "customers") {
            await addCustomer({
              name: String(pickField(row, ["name", "customername"]) ?? "").trim(),
              mobile: String(pickField(row, ["mobile", "phone", "phonenumber"]) ?? "") || null,
              ageGroup: String(pickField(row, ["agegroup"]) ?? "") || null,
              gender: String(pickField(row, ["gender"]) ?? "") || null,
              creditLimit: Number(pickField(row, ["creditlimit"])) || 0,
              outstandingBalance:
                Number(pickField(row, ["outstandingbalance", "udhar", "due"])) || 0,
            });
          } else {
            const sku = String(pickField(row, ["sku", "productsku", "barcode"]) ?? "").trim();
            const product = products.find(
              (item) => item.sku?.toLowerCase() === sku.toLowerCase() || item.barcode === sku,
            )!;
            const code = String(pickField(row, ["locationcode", "location"]) ?? "").trim();
            const target =
              locations.find(
                (item) => item.code.toLowerCase() === code.toLowerCase() || item.id === code,
              ) ?? locations.find((item) => item.id === locationId)!;
            const quantity = Number(
              pickField(row, ["quantityonhand", "quantity", "openingstock", "stock"]),
            );
            const currentQty =
              inventory.find(
                (entry) => entry.product_id === product.id && entry.location_id === target.id,
              )?.quantity_on_hand ?? 0;
            await legacyStockSet({
              productId: product.id,
              locationId: target.id,
              currentQty,
              targetQty: quantity,
            });
          }
          imported++;
        } catch (error) {
          failures.push(`Row ${index + 2}: ${userFacingError(error, "Check the row values.")}`);
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      ]);
      toast.success(`${imported} ${kind} rows imported locally`, {
        description: `${rowIssues.length} rows skipped during validation.${failures.length ? ` ${failures.length} row operations failed.` : ""}`,
      });
      setPreviewRows([]);
      setPreviewName("");
      setRowIssues([]);
    } finally {
      setBusy(false);
    }
  }

  async function exportRegister(type: "stock" | "reorder" | "sales" | "products" | "customers") {
    try {
      if (type === "products") {
        const rows = products.map((product) => ({
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          name_hi: product.name_hi,
          search_aliases: (product.search_aliases ?? []).join("|"),
          category: product.category,
          variant: product.variant,
          hsn: product.hsn,
          purchase_cost: product.purchase_cost,
          mrp: product.mrp,
          sale_price: product.sale_price,
          min_sale_price: product.min_sale_price,
          price_tiers: formatPriceTiers(product.price_tiers),
          min_stock: product.min_stock,
          uom_purchase: product.uom_purchase,
          uom_stock: product.uom_stock,
          uom_sale: product.uom_sale,
          rack_location: product.rack_location,
        }));
        await exportSheets("retailhub-products.xlsx", [{ name: "Products", rows }]);
        return;
      }
      if (type === "customers") {
        const rows = customers.map((customer) => ({
          name: customer.name,
          mobile: customer.mobile,
          age_group: customer.age_group,
          gender: customer.gender,
          credit_limit: customer.credit_limit,
          outstanding_balance: customer.outstanding_balance,
          visits: customer.visits,
        }));
        await exportSheets("retailhub-customers.xlsx", [{ name: "Customers", rows }]);
        return;
      }
      if (type === "sales") {
        const rows = sales
          .filter(
            (sale) =>
              locations.some((location) => location.id === sale.location_id) &&
              sale.status === "COMPLETED",
          )
          .map((sale) => ({
            invoice_number: sale.invoice_number,
            business_date: sale.business_date,
            created_at: sale.created_at,
            outlet: locations.find((location) => location.id === sale.location_id)?.name,
            customer:
              customers.find((customer) => customer.id === sale.customer_id)?.name ?? "Walk-in",
            cashier: sale.cashier_name,
            total_amount: sale.total_amount,
            discount_amount: sale.discount_amount,
            paid_amount: sale.paid_amount,
            balance_amount: sale.balance_amount,
            payment_status: sale.payment_status,
            sync_status: sale.sync_status,
          }));
        await exportSheets("retailhub-sales-register.xlsx", [{ name: "Sales", rows }]);
        return;
      }
      const rows = products
        .flatMap((product) =>
          locations.map((location) => ({
            sku: product.sku,
            name: product.name,
            rack_location: product.rack_location,
            location: location.name,
            location_code: location.code,
            quantity_on_hand:
              inventory.find(
                (row) => row.product_id === product.id && row.location_id === location.id,
              )?.quantity_on_hand ?? 0,
            min_stock: product.min_stock,
            reorder_status:
              (inventory.find(
                (row) => row.product_id === product.id && row.location_id === location.id,
              )?.quantity_on_hand ?? 0) <= 0
                ? "OUT OF STOCK"
                : (inventory.find(
                      (row) => row.product_id === product.id && row.location_id === location.id,
                    )?.quantity_on_hand ?? 0) <= product.min_stock
                  ? "REORDER NOW"
                  : "IN STOCK",
          })),
        )
        .filter((row) => type !== "reorder" || row.reorder_status !== "IN STOCK");
      await exportSheets(
        type === "stock" ? "retailhub-stock-register.xlsx" : "retailhub-reorder-list.xlsx",
        [{ name: type === "stock" ? "Stock Register" : "Reorder", rows }],
      );
    } catch (error) {
      toast.error("Export failed", {
        description: userFacingError(error, "The report could not be prepared. Try again."),
      });
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">Spreadsheet import & export</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download a template, fill it in Excel or CSV, then upload the completed file.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["products", "customers", "stock"] as const).map((template) => (
          <div
            key={template}
            className="flex items-center justify-between gap-2 rounded-md border p-3"
          >
            <span className="capitalize">{template === "stock" ? "Opening stock" : template}</span>
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate(template)}>
              <Download className="h-4 w-4" /> Template
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <SearchableSelect
          className="w-48"
          value={kind}
          onValueChange={(value) => setKind(value as typeof kind)}
          options={[
            { value: "products", label: "Products" },
            { value: "customers", label: "Customers" },
            { value: "stock", label: "Opening stock" },
          ]}
        />
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          <Upload className="h-4 w-4" /> {busy ? "Importing…" : "Upload spreadsheet"}
          <input
            className="sr-only"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {previewRows.length > 0 && (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Preview: {previewName}</h3>
              <p className="text-xs text-muted-foreground">
                {previewRows.length} rows · {rowIssues.length} validation warnings · repeated family
                phone numbers remain separate customers
              </p>
            </div>
            <Button
              onClick={() => void confirmImport()}
              disabled={busy || rowIssues.length >= previewRows.length}
            >
              {busy
                ? "Importing locally…"
                : `Import ${previewRows.length - rowIssues.length} valid rows`}
            </Button>
          </div>
          {rowIssues.length > 0 && (
            <div className="max-h-36 space-y-1 overflow-auto rounded-lg border bg-background p-2 text-xs text-destructive">
              {rowIssues.map((issue, index) => (
                <p key={`${issue.row}-${index}`}>
                  Row {issue.row}: {issue.issue}
                </p>
              ))}
            </div>
          )}
          <DataTable<Record<string, unknown>>
            rows={previewRows.map((row, index) => ({ ...row, __preview_row: index + 2 }))}
            getRowId={(row) => String(row["__preview_row"])}
            searchPlaceholder="Search preview rows…"
            emptyMessage="No preview rows match this search."
            tableHeightClass="max-h-48"
            columns={[
              {
                id: "row",
                header: "Row",
                accessor: (row) => Number(row["__preview_row"] ?? 0),
              },
              ...Object.keys(previewRows[0] ?? {})
                .slice(0, 6)
                .map((key) => ({
                  id: key,
                  header: key,
                  accessor: (row: Record<string, unknown>) => row[key] ?? "",
                })),
            ]}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" onClick={() => void exportRegister("stock")}>
          <Download className="h-4 w-4" /> Stock register
        </Button>
        <Button variant="outline" onClick={() => void exportRegister("reorder")}>
          <Download className="h-4 w-4" /> Reorder list
        </Button>
        <Button variant="outline" onClick={() => void exportRegister("sales")}>
          <Download className="h-4 w-4" /> Daily sales register
        </Button>
        <Button variant="outline" onClick={() => void exportRegister("products")}>
          <Download className="h-4 w-4" /> Product master
        </Button>
        <Button variant="outline" onClick={() => void exportRegister("customers")}>
          <Download className="h-4 w-4" /> Customer master
        </Button>
      </div>
    </section>
  );
}

function CustomerManagement({
  customers,
}: {
  customers: Array<{
    id: string;
    name: string;
    mobile: string | null;
    credit_limit: number;
    outstanding_balance: number;
    age_group: string | null;
    gender: string | null;
    visits?: number;
    segment?: string | null;
  }>;
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<
    Record<string, { name?: string; mobile?: string; credit_limit?: string }>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function save(customer: (typeof customers)[number]) {
    const patch = drafts[customer.id];
    if (!patch) return;
    setSavingId(customer.id);
    try {
      await updateCustomer(customer.id, {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.mobile !== undefined ? { mobile: patch.mobile.trim() || null } : {}),
        ...(patch.credit_limit !== undefined
          ? { credit_limit: Number(patch.credit_limit) || 0 }
          : {}),
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[customer.id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer profile saved on this device");
    } catch (error) {
      toast.error("Could not save customer", {
        description: userFacingError(error, "Check the customer details and try again."),
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-4">
      <div>
        <h2 className="font-semibold">Customer profiles</h2>
        <p className="text-sm text-muted-foreground">
          Phone numbers may be shared by family members; profile balances remain member-specific.
        </p>
      </div>
      <DataTable<(typeof customers)[number]>
        rows={customers}
        getRowId={(customer) => customer.id}
        searchPlaceholder="Search customer, phone or segment…"
        emptyMessage="No customer records found."
        tableHeightClass="max-h-[60dvh]"
        columns={[
          {
            id: "name",
            header: "Customer",
            accessor: (customer) => customer.name,
            cell: (customer) => (
              <Input
                aria-label={`Customer name ${customer.name}`}
                value={drafts[customer.id]?.name ?? customer.name}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [customer.id]: { ...current[customer.id], name: event.target.value },
                  }))
                }
              />
            ),
          },
          {
            id: "mobile",
            header: "Mobile",
            accessor: (customer) => customer.mobile ?? "",
            cell: (customer) => (
              <Input
                aria-label={`Mobile for ${customer.name}`}
                value={drafts[customer.id]?.mobile ?? customer.mobile ?? ""}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [customer.id]: { ...current[customer.id], mobile: event.target.value },
                  }))
                }
                placeholder="Phone optional"
              />
            ),
          },
          { id: "segment", header: "Segment", accessor: (customer) => customer.segment ?? "—" },
          {
            id: "credit_limit",
            header: "Credit limit",
            accessor: (customer) => customer.credit_limit,
            cell: (customer) => (
              <Input
                aria-label={`Credit limit for ${customer.name}`}
                type="number"
                min="0"
                className="w-28"
                value={drafts[customer.id]?.credit_limit ?? customer.credit_limit}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [customer.id]: { ...current[customer.id], credit_limit: event.target.value },
                  }))
                }
              />
            ),
          },
          {
            id: "due",
            header: "Outstanding",
            accessor: (customer) => customer.outstanding_balance,
            cell: (customer) => inr(customer.outstanding_balance),
          },
          { id: "visits", header: "Visits", accessor: (customer) => customer.visits ?? 0 },
          {
            id: "save",
            header: "",
            accessor: () => "Save",
            sortable: false,
            cell: (customer) => (
              <Button
                size="sm"
                disabled={!drafts[customer.id] || savingId === customer.id}
                onClick={() => void save(customer)}
              >
                {savingId === customer.id ? "Saving…" : "Save"}
              </Button>
            ),
          },
        ]}
      />
    </section>
  );
}

function ShortcutTileManager({
  locations,
  products,
  shortcutRows,
  defaultLocationId,
}: {
  locations: Array<{ id: string; name: string; code: string }>;
  products: Product[];
  shortcutRows: Array<Record<string, unknown>>;
  defaultLocationId: string;
}) {
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLocationId(defaultLocationId), [defaultLocationId]);
  useEffect(() => {
    const saved = shortcutRows.find((row) => row["location_id"] === locationId);
    const productIds = saved?.["product_ids"];
    setSelectedIds(
      Array.isArray(productIds)
        ? productIds.filter((id): id is string => typeof id === "string")
        : [],
    );
  }, [locationId, shortcutRows]);
  async function save() {
    if (!locationId) return;
    setSaving(true);
    try {
      await saveShortcutTiles(locationId, selectedIds.slice(0, 16));
      toast.success("Cashier shortcuts saved locally");
    } catch (error) {
      toast.error("Could not save shortcuts", {
        description: userFacingError(error, "Refresh the shortcuts and try again."),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-4">
      <div>
        <h2 className="font-semibold">Cashier quick tiles</h2>
        <p className="text-sm text-muted-foreground">
          Choose up to 16 products for a specific outlet. The POS will display these tiles in the
          saved order.
        </p>
      </div>
      <SearchableSelect
        value={locationId}
        onValueChange={setLocationId}
        placeholder="Choose location"
        options={locations.map((location) => ({
          value: location.id,
          label: `${location.code} · ${location.name}`,
        }))}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{selectedIds.length}/16 selected</p>
        <Button onClick={() => void save()} disabled={saving || !locationId}>
          {saving ? "Saving…" : "Save shortcuts"}
        </Button>
      </div>
      <DataTable<Product>
        rows={products}
        getRowId={(product) => product.id}
        searchPlaceholder="Search English, Hindi, SKU or alias…"
        emptyMessage="No catalog items match this search."
        tableHeightClass="max-h-[55dvh]"
        columns={[
          {
            id: "item",
            header: "Item",
            accessor: (product) =>
              `${product.name} ${product.name_hi ?? ""} ${product.sku ?? ""} ${product.barcode ?? ""} ${(product.search_aliases ?? []).join(" ")}`,
            cell: (product) => (
              <span className="font-medium">
                {product.name}
                {product.name_hi ? (
                  <span className="ml-1 block text-xs text-muted-foreground">
                    {product.name_hi}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            id: "sku",
            header: "SKU / Barcode",
            accessor: (product) => product.sku ?? product.barcode ?? "",
          },
          {
            id: "order",
            header: "Tile order",
            accessor: (product) => selectedIds.indexOf(product.id),
            cell: (product) => {
              const selected = selectedIds.includes(product.id);
              return (
                <Button
                  variant={selected ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (!selected && selectedIds.length >= 16) {
                      toast.error("Cashier quick tiles are limited to 16 products.");
                      return;
                    }
                    setSelectedIds((current) =>
                      selected
                        ? current.filter((id) => id !== product.id)
                        : [...current, product.id],
                    );
                  }}
                >
                  {selected ? `Selected ${selectedIds.indexOf(product.id) + 1}` : "Add tile"}
                </Button>
              );
            },
          },
        ]}
      />
    </section>
  );
}

/* ------------------------------ Enrichment ------------------------------ */

function EnrichmentQueue({ products }: { products: Product[] }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  const saveMut = useMutation({
    mutationFn: async (p: Product) => {
      const d = drafts[p.id] ?? {};
      await updateProductProfile(p.id, {
        name: d["name"] ?? p.name,
        name_hi: d["name_hi"] ?? p.name_hi ?? null,
        search_aliases: (d["search_aliases"] ?? (p.search_aliases ?? []).join(","))
          .split(/[|,;]/)
          .map((value) => value.trim())
          .filter(Boolean),
        barcode: d["barcode"] ?? p.barcode ?? null,
        sku: d["sku"] ?? p.sku ?? null,
        hsn: d["hsn"] ?? p.hsn ?? null,
        purchase_cost: Number(d["purchase_cost"] ?? p.purchase_cost),
        mrp: Number(d["mrp"] ?? p.mrp),
        sale_price: Number(d["sale_price"] ?? p.sale_price),
        price_tiers: parsePriceTiers(d["price_tiers"] ?? formatPriceTiers(p.price_tiers)),
        uom_purchase: d["uom_purchase"] ?? p.uom_purchase,
        uom_stock: d["uom_stock"] ?? p.uom_stock,
        uom_sale: d["uom_sale"] ?? p.uom_sale,
        min_stock: Number(d["min_stock"] ?? p.min_stock),
        enrichment_status: "COMPLETE",
      });
    },
    onSuccess: () => {
      toast.success("Product completed");
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) =>
      toast.error("Save failed", {
        description: userFacingError(e, "The product changes could not be saved."),
      }),
  });

  if (products.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        Catalog queue is clear — every product is enriched.
      </div>
    );
  }

  const field = (p: Product, key: keyof Product) =>
    drafts[p.id]?.[key] ?? String((p[key] as string | number | boolean | null) ?? "");

  return (
    <section className="space-y-2 rounded-lg border bg-card p-3">
      <div className="text-sm font-medium">{products.length} item(s) pending enrichment</div>
      <DataTable<Product>
        rows={products}
        getRowId={(product) => product.id}
        searchPlaceholder="Search catalog items…"
        emptyMessage="No products need enrichment."
        columns={[
          {
            id: "item",
            header: "Item",
            accessor: (product) => product.name,
            cell: (product) => <span className="text-xs font-medium">{product.name}</span>,
          },
          {
            id: "identity",
            header: "Hindi name / aliases",
            accessor: (product) =>
              `${product.name_hi ?? ""} ${(product.search_aliases ?? []).join(" ")}`,
            cell: (p) => (
              <div className="min-w-48 space-y-1">
                <Input
                  aria-label="Hindi product name"
                  className="h-7 w-40 text-xs"
                  placeholder="Hindi name"
                  value={field(p, "name_hi")}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], name_hi: e.target.value } }))
                  }
                />
                <Input
                  aria-label="Search aliases"
                  className="h-7 w-40 text-xs"
                  placeholder="aliases, separated by comma"
                  value={field(p, "search_aliases")}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [p.id]: { ...d[p.id], search_aliases: e.target.value },
                    }))
                  }
                />
              </div>
            ),
          },
          ...(["barcode", "sku", "hsn"] as const).map((k) => ({
            id: k,
            header: k.toUpperCase(),
            accessor: (p: Product) => p[k] ?? "",
            cell: (p: Product) => (
              <Input
                className="h-7 w-28 text-xs"
                value={field(p, k) === "null" ? "" : field(p, k)}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], [k]: e.target.value } }))
                }
              />
            ),
          })),
          ...(["purchase_cost", "mrp", "sale_price"] as const).map((k) => ({
            id: k,
            header: k === "purchase_cost" ? "Cost" : k === "mrp" ? "MRP" : "Sale",
            accessor: (p: Product) => p[k],
            cell: (p: Product) => (
              <Input
                type="number"
                className="h-7 w-20 text-right text-xs"
                value={field(p, k)}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], [k]: e.target.value } }))
                }
              />
            ),
          })),
          {
            id: "tiers",
            header: "Wholesale tiers",
            accessor: (p) => formatPriceTiers(p.price_tiers),
            cell: (p) => (
              <Input
                aria-label={`Quantity prices for ${p.name}`}
                className="h-7 w-28 text-xs"
                value={drafts[p.id]?.["price_tiers"] ?? formatPriceTiers(p.price_tiers)}
                onChange={(event) =>
                  setDrafts((d) => ({
                    ...d,
                    [p.id]: { ...d[p.id], price_tiers: event.target.value },
                  }))
                }
                placeholder="Small:6:68; Medium:12:64; Large:24:60"
                title="Pack tier:minimum quantity:unit price; threshold comes from this SKU’s packaging"
              />
            ),
          },
          {
            id: "uom",
            header: "UOM",
            accessor: (p) => p.uom_stock,
            cell: (p) => (
              <SearchableSelect
                className="h-7 w-20 text-xs"
                value={field(p, "uom_stock")}
                onValueChange={(value) =>
                  setDrafts((drafts) => ({
                    ...drafts,
                    [p.id]: {
                      ...drafts[p.id],
                      uom_stock: value,
                      uom_sale: value,
                      uom_purchase: value,
                    },
                  }))
                }
                options={["UNIT", "KG", "LITRE", "PKT", "BAG", "PIECE"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            ),
          },
          {
            id: "minimum",
            header: "Min",
            accessor: (p) => p.min_stock,
            cell: (p) => (
              <Input
                type="number"
                className="h-7 w-16 text-right text-xs"
                value={field(p, "min_stock")}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], min_stock: e.target.value } }))
                }
              />
            ),
          },
          {
            id: "complete",
            header: "",
            accessor: () => "Complete",
            sortable: false,
            cell: (p) => (
              <Button size="sm" onClick={() => saveMut.mutate(p)} disabled={saveMut.isPending}>
                Complete
              </Button>
            ),
          },
        ]}
      />
    </section>
  );
}

/* ------------------------------ Transfers ------------------------------ */

function NewTransferCard({
  locations,
  products,
  defaultFromId,
  onCreated,
}: {
  locations: Array<{ id: string; name: string; type: string }>;
  products: Product[];
  defaultFromId: string;
  onCreated: () => void;
}) {
  const [fromId, setFromId] = useState(defaultFromId);
  const [toId, setToId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ product_id: string; quantity: number; name: string }>>(
    [],
  );
  const [busy, setBusy] = useState(false);

  function addLine() {
    const p = products.find((x) => x.id === productId);
    if (!p || !(Number(qty) > 0)) return;
    setLines((prev) => [...prev, { product_id: p.id, quantity: Number(qty), name: p.name }]);
    setProductId("");
    setQty("");
  }

  async function submit() {
    if (!fromId || !toId || lines.length === 0 || busy) return;
    setBusy(true);
    try {
      await createTransfer({
        fromLocationId: fromId,
        toLocationId: toId,
        notes: notes.trim() || null,
        items: lines.map(({ product_id, quantity }) => ({ product_id, quantity })),
      });
      toast.success("Transfer created");
      setLines([]);
      setNotes("");
      onCreated();
    } catch (e) {
      toast.error("Could not create transfer", {
        description: userFacingError(
          e,
          "Check the source, destination, and quantities, then try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm font-medium">New stock transfer</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>From</Label>
          <SearchableSelect
            className="w-52"
            value={fromId}
            onValueChange={setFromId}
            placeholder="Source"
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
        </div>
        <div className="space-y-1">
          <Label>To</Label>
          <SearchableSelect
            className="w-52"
            value={toId}
            onValueChange={setToId}
            placeholder="Destination"
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Item</Label>
          <SearchableSelect
            className="w-56"
            value={productId}
            onValueChange={setProductId}
            placeholder="Pick product"
            options={products.map((product) => ({
              value: product.id,
              label: `${product.name}${product.name_hi ? ` · ${product.name_hi}` : ""} · ${product.sku ?? product.barcode ?? "No SKU"}`,
              keywords: [
                ...(product.search_aliases ?? []),
                product.sku ?? "",
                product.barcode ?? "",
              ],
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Qty</Label>
          <Input
            type="number"
            className="w-20"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={addLine}>
          Add
        </Button>
      </div>
      {lines.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lines.map((l, i) => (
            <span
              key={i}
              className="flex items-center gap-1 rounded border bg-muted/40 px-2 py-0.5 text-xs"
            >
              {l.name} ×{l.quantity}
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="tr-notes">Notes</Label>
          <Input
            id="tr-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional note"
          />
        </div>
        <Button onClick={submit} disabled={busy || !toId || lines.length === 0}>
          Create transfer
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ Write-offs ------------------------------ */

function NewWriteOffCard({
  locations,
  products,
  locationId,
  busy,
  onSubmit,
}: {
  locations: Array<{ id: string; name: string }>;
  products: Product[];
  locationId: string;
  busy: boolean;
  onSubmit: (input: {
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
    returnable: boolean;
  }) => void;
}) {
  const [productId, setProductId] = useState("");
  const [locId, setLocId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<string>("SPOILAGE");
  const [returnable, setReturnable] = useState(false);

  const product = products.find((p) => p.id === productId);
  const effectiveLoc = locId || locationId;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm font-medium">Record damage / expiry write-off</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>Item</Label>
          <SearchableSelect
            className="w-56"
            value={productId}
            onValueChange={setProductId}
            placeholder="Pick product"
            options={products.map((item) => ({
              value: item.id,
              label: `${item.name}${item.name_hi ? ` · ${item.name_hi}` : ""} · ${item.sku ?? item.barcode ?? "No SKU"}`,
              keywords: [...(item.search_aliases ?? []), item.sku ?? "", item.barcode ?? ""],
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Location</Label>
          <SearchableSelect
            className="w-52"
            value={effectiveLoc}
            onValueChange={setLocId}
            placeholder="Location"
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Qty</Label>
          <Input
            type="number"
            className="w-20"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Reason</Label>
          <SearchableSelect
            className="w-32"
            value={reason}
            onValueChange={setReason}
            options={REASONS.map((reasonOption) => ({ value: reasonOption, label: reasonOption }))}
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-xs">
          <Checkbox checked={returnable} onCheckedChange={(v) => setReturnable(!!v)} />
          Returnable to vendor
        </label>
        <Button
          disabled={!productId || !effectiveLoc || !(Number(qty) > 0) || busy}
          onClick={() =>
            onSubmit({
              productId,
              locationId: effectiveLoc,
              quantity: Number(qty),
              reason,
              returnable,
            })
          }
        >
          Write off ({product && qty ? inr(Number(qty) * product.purchase_cost) : "₹0.00"})
        </Button>
      </div>
    </div>
  );
}
