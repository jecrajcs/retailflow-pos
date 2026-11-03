import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, PackageMinus, Tag } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppNav } from "@/components/pos/app-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  createAdjustment,
  createTransfer,
  inr,
  REASONS,
  receiveTransfer,
  setTransferStatus,
  useLocations,
  useProducts,
  type Product,
  type StockTransfer,
} from "@/lib/pos";

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
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const [locationId, setLocationId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "");
  const location = locations.find((l) => l.id === locationId) ?? locations[0];

  const { data: transfers = [] } = useQuery<StockTransfer[]>({
    queryKey: ["transfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_transfers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as StockTransfer[];
    },
  });

  const { data: transferItems = [] } = useQuery<TransferItemRow[]>({
    queryKey: ["transfer-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_transfer_items")
        .select("*, products(name)");
      if (error) throw error;
      return data as TransferItemRow[];
    },
  });

  const { data: adjustments = [] } = useQuery<AdjustmentRow[]>({
    queryKey: ["adjustments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_adjustments")
        .select("*, products(name), locations(name)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as AdjustmentRow[];
    },
  });

  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "—";

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
    onError: (e) => toast.error("Action failed", { description: String(e) }),
  });

  const adjustMut = useMutation({
    mutationFn: createAdjustment,
    onSuccess: () => {
      toast.success("Write-off recorded");
      void queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e) => toast.error("Write-off failed", { description: String(e) }),
  });

  const totalLoss = useMemo(
    () => adjustments.reduce((s, a) => s + a.cost_loss, 0),
    [adjustments],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav active="/manager" />
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Select
          value={location?.id ?? ""}
          onValueChange={(id) => {
            setLocationId(id);
            localStorage.setItem(LS_KEY, id);
          }}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} ({l.type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <main className="mx-auto w-full max-w-[1200px] flex-1 p-3">
        <Tabs defaultValue="enrichment">
          <TabsList>
            <TabsTrigger value="enrichment" className="gap-1.5">
              <Tag className="h-3.5 w-3.5" /> Catalog Queue
            </TabsTrigger>
            <TabsTrigger value="transfers" className="gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5" /> Stock Transfers
            </TabsTrigger>
            <TabsTrigger value="writeoffs" className="gap-1.5">
              <PackageMinus className="h-3.5 w-3.5" /> Damage / Expiry
            </TabsTrigger>
          </TabsList>

          <TabsContent value="enrichment" className="mt-3">
            <EnrichmentQueue products={products.filter((p) => p.enrichment_status !== "COMPLETE")} />
          </TabsContent>

          <TabsContent value="transfers" className="mt-3 space-y-3">
            <NewTransferCard
              locations={locations}
              products={products}
              defaultFromId={locations.find((l) => l.type === "WAREHOUSE")?.id ?? ""}
              onCreated={() => void queryClient.invalidateQueries({ queryKey: ["transfers"] })}
            />
            <section className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No transfers yet. POS indents land here.
                      </TableCell>
                    </TableRow>
                  )}
                  {transfers.map((t) => {
                    const items = transferItems.filter((i) => i.transfer_id === t.id);
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs">
                          {new Date(t.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                        <TableCell className="text-xs">
                          {locName(t.from_location_id)} → {locName(t.to_location_id)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {items
                            .map((i) => `${i.products?.name ?? "?"} ×${i.quantity}`)
                            .join(", ") || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              t.status === "REQUESTED" && "border-amber-500/50 text-amber-600",
                              t.status === "IN_TRANSIT" && "border-blue-500/50 text-blue-600",
                              t.status === "RECEIVED" && "border-success/50 text-success",
                            )}
                          >
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {t.status === "REQUESTED" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={statusMut.isPending}
                              onClick={() => statusMut.mutate({ id: t.id, action: "dispatch" })}
                            >
                              Dispatch
                            </Button>
                          )}
                          {t.status === "IN_TRANSIT" && (
                            <Button
                              size="sm"
                              disabled={statusMut.isPending}
                              onClick={() => statusMut.mutate({ id: t.id, action: "receive" })}
                            >
                              Receive
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          </TabsContent>

          <TabsContent value="writeoffs" className="mt-3 space-y-3">
            <NewWriteOffCard
              locations={locations}
              products={products}
              locationId={location?.id ?? ""}
              busy={adjustMut.isPending}
              onSubmit={(input) => adjustMut.mutate(input)}
            />
            <div className="text-sm text-muted-foreground">
              Total cost loss in last {adjustments.length} write-offs:{" "}
              <b className="text-destructive">{inr(totalLoss)}</b>
            </div>
            <section className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Returnable</TableHead>
                    <TableHead className="text-right">Cost loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No write-offs recorded.
                      </TableCell>
                    </TableRow>
                  )}
                  {adjustments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">
                        {new Date(a.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                      <TableCell>{a.products?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs">{a.locations?.name ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{a.quantity}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.reason}</Badge>
                      </TableCell>
                      <TableCell>{a.returnable_to_vendor ? "Yes" : "No"}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">
                        {inr(a.cost_loss)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/* ------------------------------ Enrichment ------------------------------ */

function EnrichmentQueue({ products }: { products: Product[] }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  const saveMut = useMutation({
    mutationFn: async (p: Product) => {
      const d = drafts[p.id] ?? {};
      const { error } = await supabase
        .from("products")
        .update({
          barcode: d["barcode"] ?? p.barcode ?? null,
          sku: d["sku"] ?? p.sku ?? null,
          hsn: d["hsn"] ?? p.hsn ?? null,
          purchase_cost: Number(d["purchase_cost"] ?? p.purchase_cost),
          mrp: Number(d["mrp"] ?? p.mrp),
          sale_price: Number(d["sale_price"] ?? p.sale_price),
          uom_purchase: d["uom_purchase"] ?? p.uom_purchase,
          uom_stock: d["uom_stock"] ?? p.uom_stock,
          uom_sale: d["uom_sale"] ?? p.uom_sale,
          min_stock: Number(d["min_stock"] ?? p.min_stock),
          enrichment_status: "COMPLETE",
        })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product completed");
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast.error("Save failed", { description: String(e) }),
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
    <section className="overflow-x-auto rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-sm font-medium">
        {products.length} item(s) pending enrichment
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Barcode</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>HSN</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>MRP</TableHead>
            <TableHead>Sale</TableHead>
            <TableHead>UOM</TableHead>
            <TableHead>Min</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="text-xs font-medium">{p.name}</TableCell>
              {(["barcode", "sku", "hsn"] as const).map((k) => (
                <TableCell key={k}>
                  <Input
                    className="h-7 w-28 text-xs"
                    value={field(p, k) === "null" ? "" : field(p, k)}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], [k]: e.target.value } }))
                    }
                  />
                </TableCell>
              ))}
              {(["purchase_cost", "mrp", "sale_price"] as const).map((k) => (
                <TableCell key={k}>
                  <Input
                    type="number"
                    className="h-7 w-20 text-right text-xs"
                    value={field(p, k)}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], [k]: e.target.value } }))
                    }
                  />
                </TableCell>
              ))}
              <TableCell>
                <Select
                  value={field(p, "uom_stock")}
                  onValueChange={(v) =>
                    setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], uom_stock: v, uom_sale: v, uom_purchase: v } }))
                  }
                >
                  <SelectTrigger className="h-7 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["UNIT", "KG", "LITRE", "PKT", "BAG", "PIECE"].map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  className="h-7 w-16 text-right text-xs"
                  value={field(p, "min_stock")}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], min_stock: e.target.value } }))
                  }
                />
              </TableCell>
              <TableCell>
                <Button size="sm" onClick={() => saveMut.mutate(p)} disabled={saveMut.isPending}>
                  Complete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
  const [lines, setLines] = useState<Array<{ product_id: string; quantity: number; name: string }>>([]);
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
      toast.error("Could not create transfer", { description: String(e) });
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
          <Select value={fromId} onValueChange={setFromId}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>To</Label>
          <Select value={toId} onValueChange={setToId}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Destination" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Item</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Pick product" />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Qty</Label>
          <Input type="number" className="w-20" value={qty} onChange={(e) => setQty(e.target.value)} />
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
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Pick product" />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Location</Label>
          <Select value={effectiveLoc} onValueChange={setLocId}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Qty</Label>
          <Input type="number" className="w-20" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
