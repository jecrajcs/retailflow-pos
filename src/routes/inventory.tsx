import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownAZ, Boxes, ClipboardCheck, Search, Truck } from "lucide-react";
import { toast } from "sonner";

import { AppNav } from "@/components/pos/app-nav";
import { DataTable } from "@/components/pos/data-table";
import { IndentDialog } from "@/components/pos/indent-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import {
  inr,
  countLocationStock,
  matchesProductSearch,
  useInventory,
  useLocationProducts,
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

type ReorderStatus = "OUT" | "REORDER" | "IN" | "COUNT" | "UNASSIGNED";

function reorderStatus(qty: number, minStock: number): ReorderStatus {
  if (qty <= 0) return "OUT";
  if (qty <= minStock) return "REORDER";
  return "IN";
}

const STATUS_META: Record<ReorderStatus, { label: string; className: string }> = {
  IN: { label: "In Stock", className: "bg-success/15 text-success" },
  REORDER: { label: "REORDER NOW", className: "bg-warning/15 text-warning" },
  OUT: { label: "OUT OF STOCK", className: "bg-destructive/15 text-destructive" },
  COUNT: { label: "COUNT REQUIRED", className: "bg-info/10 text-info" },
  UNASSIGNED: { label: "NOT AT THIS LOCATION", className: "bg-muted text-muted-foreground" },
};

function InventoryPage() {
  const { profile } = useAccess();
  const { data: locations = [] } = useLocations();
  const allowedLocations = locations.filter((locationRow) =>
    canAccessLocation(profile, locationRow.id),
  );
  const { data: products = [] } = useProducts();
  const { data: inventory = [] } = useInventory();
  const { data: locationProducts = [] } = useLocationProducts();

  const [locationId, setLocationId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "");
  const location =
    allowedLocations.find((l) => l.id === locationId) ??
    allowedLocations.find((l) => l.type !== "WAREHOUSE") ??
    allowedLocations[0];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ReorderStatus>("ALL");
  const [indentProduct, setIndentProduct] = useState<Product | null>(null);
  const [countProduct, setCountProduct] = useState<Product | null>(null);

  const stockAt = (productId: string, locId: string | undefined) =>
    inventory.find((i) => i.product_id === productId && i.location_id === locId)
      ?.quantity_on_hand ?? 0;

  const productStatus = (product: Product, locId: string | undefined): ReorderStatus => {
    const assignment = locationProducts.find(
      (row) => row.product_id === product.id && row.location_id === locId,
    );
    if (!assignment) return "UNASSIGNED";
    if (assignment.stock_count_status === "AWAITING_COUNT") return "COUNT";
    return reorderStatus(stockAt(product.id, locId), product.min_stock);
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .map((p) => {
        const qty = stockAt(p.id, location?.id);
        const status = productStatus(p, location?.id);
        return { product: p, qty, status };
      })
      .filter((r) => (statusFilter === "ALL" ? true : r.status === statusFilter))
      .filter((r) => {
        if (!q) return true;
        return matchesProductSearch(r.product, q);
      })
      .sort((a, b) => {
        const order = { COUNT: 0, UNASSIGNED: 1, OUT: 2, REORDER: 3, IN: 4 };
        return order[a.status] - order[b.status] || a.product.name.localeCompare(b.product.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, inventory, locationProducts, location?.id, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { OUT: 0, REORDER: 0, IN: 0, COUNT: 0, UNASSIGNED: 0, total: products.length };
    for (const p of products) {
      c[productStatus(p, location?.id)]++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, inventory, locationProducts, location?.id]);

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
            { value: "COUNT", label: `Count required (${counts.COUNT})` },
            { value: "UNASSIGNED", label: `Not assigned (${counts.UNASSIGNED})` },
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
          <StatChip
            label="Count Required"
            value={String(counts.COUNT)}
            icon={ClipboardCheck}
            className="text-info"
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
              accessor: (row: (typeof rows)[number]) => {
                const status = productStatus(row.product, locationRow.id);
                if (status === "UNASSIGNED") return "Not assigned";
                if (status === "COUNT") return "Count pending";
                return stockAt(row.product.id, locationRow.id);
              },
              cell: (row: (typeof rows)[number]) => {
                const status = productStatus(row.product, locationRow.id);
                if (status === "UNASSIGNED")
                  return <span className="text-xs text-muted-foreground">Not assigned</span>;
                if (status === "COUNT")
                  return <span className="text-xs font-medium text-info">Count pending</span>;
                return `${stockAt(row.product.id, locationRow.id)} ${row.product.uom_stock}`;
              },
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
              accessor: (row) => (row.status === "IN" ? "Count" : "Count / Transfer"),
              sortable: false,
              cell: (row) => {
                const otherQty = allowedLocations
                  .filter((entry) => entry.id !== location?.id)
                  .reduce((sum, entry) => sum + stockAt(row.product.id, entry.id), 0);
                return (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setCountProduct(row.product)}
                    >
                      <ClipboardCheck className="h-3 w-3" /> Count
                    </Button>
                    {(row.status === "OUT" || row.status === "REORDER") && (
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
                    )}
                  </div>
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
      <CountStockDialog
        product={countProduct}
        locationId={location?.id ?? ""}
        currentQuantity={countProduct ? stockAt(countProduct.id, location?.id) : 0}
        onClose={() => setCountProduct(null)}
      />
    </div>
  );
}

function CountStockDialog({
  product,
  locationId,
  currentQuantity,
  onClose,
}: {
  product: Product | null;
  locationId: string;
  currentQuantity: number;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (product) setQuantity(String(currentQuantity));
  }, [product, currentQuantity]);

  async function save() {
    if (!product || !locationId || busy) return;
    setBusy(true);
    try {
      await countLocationStock({
        productId: product.id,
        locationId,
        countedQuantity: Number(quantity),
      });
      toast.success(`${product.name} physical count saved`, {
        description: "Stock tracking is now active at this location.",
      });
      onClose();
    } catch (error) {
      toast.error("Could not save stock count", {
        description: error instanceof Error ? error.message : "Review the count and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Count stock at this location</DialogTitle>
          <DialogDescription>
            {product
              ? `${product.name}${product.variant ? ` · ${product.variant}` : ""} · current tracked balance ${currentQuantity} ${product.uom_stock}. Enter the physical quantity on hand.`
              : "Enter a physical count."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="physical-stock-count">
            Physical count ({product?.uom_stock ?? "units"})
          </Label>
          <Input
            id="physical-stock-count"
            type="number"
            min="0"
            step={
              product?.is_loose
                ? String(1 / 10 ** Math.max(0, Math.min(3, product.quantity_precision ?? 0)))
                : "1"
            }
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="0"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || quantity === "" || Number(quantity) < 0}
          >
            {busy ? "Saving…" : "Save physical count"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
