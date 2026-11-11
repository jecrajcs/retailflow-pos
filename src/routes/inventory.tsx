import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownAZ, Boxes, Search, Truck } from "lucide-react";

import { AppNav } from "@/components/pos/app-nav";
import { DataTable } from "@/components/pos/data-table";
import { IndentDialog } from "@/components/pos/indent-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import {
  inr,
  matchesProductSearch,
  useInventory,
  useLocations,
  useProducts,
  type Product,
} from "@/lib/pos";
import { canAccessLocation, saveActiveLocation, useAccess } from "@/lib/access";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "RetailHub POS — Inventory" },
      {
        name: "description",
        content:
          "Full catalog stock across warehouse and outlets — rack locations, min stock limits, reorder status and one-click transfer requests.",
      },
      { property: "og:title", content: "RetailHub POS — Inventory" },
      {
        property: "og:description",
        content:
          "Full catalog stock across warehouse and outlets — rack locations, min stock limits, reorder status and one-click transfer requests.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InventoryPage,
});

const LS_KEY = "pos-location-id";

type ReorderStatus = "OUT" | "REORDER" | "IN";

function reorderStatus(qty: number, minStock: number): ReorderStatus {
  if (qty <= 0) return "OUT";
  if (qty <= minStock) return "REORDER";
  return "IN";
}

const STATUS_META: Record<ReorderStatus, { label: string; className: string }> = {
  IN: { label: "In Stock", className: "bg-success/15 text-success" },
  REORDER: { label: "REORDER NOW", className: "bg-warning/15 text-warning" },
  OUT: { label: "OUT OF STOCK", className: "bg-destructive/15 text-destructive" },
};

function InventoryPage() {
  const { profile } = useAccess();
  const { data: locations = [] } = useLocations();
  const allowedLocations = locations.filter((locationRow) =>
    canAccessLocation(profile, locationRow.id),
  );
  const { data: products = [] } = useProducts();
  const { data: inventory = [] } = useInventory();

  const [locationId, setLocationId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "");
  const location =
    allowedLocations.find((l) => l.id === locationId) ??
    allowedLocations.find((l) => l.type !== "WAREHOUSE") ??
    allowedLocations[0];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ReorderStatus>("ALL");
  const [indentProduct, setIndentProduct] = useState<Product | null>(null);

  const stockAt = (productId: string, locId: string | undefined) =>
    inventory.find((i) => i.product_id === productId && i.location_id === locId)
      ?.quantity_on_hand ?? 0;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .map((p) => {
        const qty = stockAt(p.id, location?.id);
        const status = reorderStatus(qty, p.min_stock);
        return { product: p, qty, status };
      })
      .filter((r) => (statusFilter === "ALL" ? true : r.status === statusFilter))
      .filter((r) => {
        if (!q) return true;
        return matchesProductSearch(r.product, q);
      })
      .sort((a, b) => {
        const order = { OUT: 0, REORDER: 1, IN: 2 };
        return order[a.status] - order[b.status] || a.product.name.localeCompare(b.product.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, inventory, location?.id, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { OUT: 0, REORDER: 0, IN: 0, total: products.length };
    for (const p of products) {
      c[reorderStatus(stockAt(p.id, location?.id), p.min_stock)]++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, inventory, location?.id]);

  function pickLocation(id: string) {
    setLocationId(id);
    saveActiveLocation(id);
  }

  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/inventory" />

      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <SearchableSelect
          className="w-64"
          value={location?.id ?? ""}
          onValueChange={pickLocation}
          placeholder="Viewing stock of…"
          options={allowedLocations.map((l) => ({
            value: l.id,
            label: `${l.name} (${l.type})`,
            keywords: [l.code, l.address ?? ""],
          }))}
        />
        <div className="relative min-w-64 flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search SKU, name, barcode, rack…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SearchableSelect
          className="w-44"
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
          options={[
            { value: "ALL", label: `All items (${products.length})` },
            { value: "IN", label: `In Stock (${counts.IN})` },
            { value: "REORDER", label: `Reorder Now (${counts.REORDER})` },
            { value: "OUT", label: `Out of Stock (${counts.OUT})` },
          ]}
        />
      </div>

      <main className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          <StatChip label="Total SKUs" value={String(products.length)} icon={Boxes} />
          <StatChip
            label="In Stock"
            value={String(counts.IN)}
            icon={ArrowDownAZ}
            className="text-success"
          />
          <StatChip
            label="Reorder Now"
            value={String(counts.REORDER)}
            icon={AlertTriangle}
            className="text-warning"
          />
          <StatChip
            label="Out of Stock"
            value={String(counts.OUT)}
            icon={AlertTriangle}
            className="text-destructive"
          />
        </div>

        <DataTable
          rows={rows}
          getRowId={(row) => row.product.id}
          searchable={false}
          resetKey={`${location?.id ?? ""}:${statusFilter}:${search}`}
          emptyMessage="No inventory records match these filters."
          columns={[
            {
              id: "item",
              header: "Item",
              accessor: (row) => row.product.name,
              cell: (row) => (
                <span className="font-medium">
                  {row.product.name}
                  {row.product.variant ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {row.product.variant}
                    </span>
                  ) : null}
                  <span className="block text-[11px] text-muted-foreground">
                    {row.product.category ?? "Uncategorized"} · MRP {inr(row.product.mrp)} · Sell{" "}
                    {inr(row.product.sale_price)}/{row.product.uom_sale}
                  </span>
                </span>
              ),
            },
            { id: "sku", header: "SKU", accessor: (row) => row.product.sku ?? "" },
            { id: "rack", header: "Rack", accessor: (row) => row.product.rack_location ?? "" },
            ...allowedLocations.map((locationRow) => ({
              id: `stock-${locationRow.id}`,
              header: locationRow.code,
              accessor: (row: (typeof rows)[number]) => stockAt(row.product.id, locationRow.id),
            })),
            { id: "minimum", header: "Min", accessor: (row) => row.product.min_stock },
            {
              id: "status",
              header: "Status",
              accessor: (row) => STATUS_META[row.status].label,
              cell: (row) => (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    STATUS_META[row.status].className,
                  )}
                >
                  {STATUS_META[row.status].label}
                </span>
              ),
            },
            {
              id: "action",
              header: "Action",
              accessor: (row) => (row.status === "IN" ? "OK" : "Transfer"),
              sortable: false,
              cell: (row) => {
                if (row.status === "IN")
                  return <span className="text-xs text-muted-foreground">OK</span>;
                const otherQty = allowedLocations
                  .filter((entry) => entry.id !== location?.id)
                  .reduce((sum, entry) => sum + stockAt(row.product.id, entry.id), 0);
                return (
                  <Button
                    size="sm"
                    variant={row.status === "OUT" ? "default" : "outline"}
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setIndentProduct(row.product)}
                    title={
                      otherQty > 0
                        ? `Other locations hold ${otherQty} ${row.product.uom_stock}`
                        : "No stock at other locations — reorder from vendor"
                    }
                  >
                    <Truck className="h-3 w-3" /> Transfer
                  </Button>
                );
              },
            },
          ]}
        />
      </main>

      <IndentDialog
        open={!!indentProduct}
        onOpenChange={(o) => !o && setIndentProduct(null)}
        product={indentProduct}
        locationId={location?.id ?? ""}
        locations={locations}
      />
    </div>
  );
}

function StatChip({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  icon: typeof Boxes;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
