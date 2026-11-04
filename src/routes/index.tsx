import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Plus,
  ScanBarcode,
  Search,
  Trash2,
  Truck,
  UserRound,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { AppNav } from "@/components/pos/app-nav";
import { PaymentModal } from "@/components/pos/payment-modal";
import { CustomerDialog } from "@/components/pos/customer-dialog";
import { QuickAddModal } from "@/components/pos/quick-add-modal";
import { IndentDialog } from "@/components/pos/indent-dialog";
import { ReceiptDialog, type ReceiptData } from "@/components/pos/receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  inr,
  maxLineDiscount,
  useCustomers,
  useInventory,
  useLocations,
  useProducts,
  type CartLine,
  type Customer,
  type InvoiceResult,
  type Product,
  type ReceiptPayment,
} from "@/lib/pos";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RetailHub POS — Billing" },
      {
        name: "description",
        content:
          "Fast customer-first POS billing with barcode scanning, rack locations, floor-price protection, split payments, cash tendered and change return.",
      },
      { property: "og:title", content: "RetailHub POS — Billing" },
      {
        property: "og:description",
        content:
          "Fast customer-first POS billing with barcode scanning, rack locations, floor-price protection, split payments, cash tendered and change return.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PosPage,
});

const LS_KEY = "pos-location-id";

function PosPage() {
  const queryClient = useQueryClient();
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const { data: inventory = [] } = useInventory();
  const { data: customers = [] } = useCustomers();

  const [locationId, setLocationId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "");
  const location = locations.find((l) => l.id === locationId) ?? locations[0];

  useEffect(() => {
    const first = locations[0];
    if (!locationId && first) setLocationId(first.id);
  }, [locationId, locations]);

  function changeLocation(id: string) {
    setLocationId(id);
    localStorage.setItem(LS_KEY, id);
  }

  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [barcode, setBarcode] = useState("");
  const [discount, setDiscount] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPrefill, setQuickPrefill] = useState("");
  const [indentProduct, setIndentProduct] = useState<Product | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const stockAt = useCallback(
    (productId: string, locId: string | undefined) =>
      inventory.find((i) => i.product_id === productId && i.location_id === locId)?.quantity_on_hand ?? 0,
    [inventory],
  );

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.quantity * l.unit_price - l.discount, 0),
    [lines],
  );
  const total = Math.max(subtotal - discount, 0);
  /** Floor-price protection: qty × min allowed rate across the bill. */
  const minTotal = useMemo(
    () =>
      lines.reduce(
        (s, l) => s + l.quantity * (l.product.min_sale_price > 0 ? l.product.min_sale_price : 0),
        0,
      ),
    [lines],
  );
  const maxBillDiscount = Math.max(subtotal - minTotal, 0);

  function addToCart(product: Product) {
    // Customer-first: a new bill always starts with picking the customer.
    if (lines.length === 0 && !customer) setCustOpen(true);
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          unit_price: product.sale_price,
          uom: product.uom_sale,
          discount: 0,
        },
      ];
    });
  }

  function setQuantity(productId: string, quantity: number) {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.product.id !== productId)
        : prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l)),
    );
  }

  function setLineDiscount(productId: string, value: number) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.product.id !== productId) return l;
        const max = maxLineDiscount(l.unit_price, l.quantity, l.product.min_sale_price);
        if (value > max + 0.001) {
          toast.warning("Floor price protection", {
            description: `Max discount on this line is ${inr(max)} (min allowed rate ${inr(
              l.product.min_sale_price,
            )}).`,
          });
          return { ...l, discount: max };
        }
        return { ...l, discount: Math.max(value, 0) };
      }),
    );
  }

  function handleBarcodeSubmit() {
    const q = barcode.trim().toLowerCase();
    if (!q) return;
    const hit =
      products.find((p) => p.barcode?.toLowerCase() === q || p.sku?.toLowerCase() === q) ??
      products.find((p) => p.name.toLowerCase() === q);
    if (hit) {
      addToCart(hit);
      setBarcode("");
      barcodeRef.current?.focus();
    } else {
      toast.error("Item not found", {
        description: "Press F2 to quick-add it — name & barcode are pre-filled from what you typed.",
      });
    }
  }

  function openQuickAdd() {
    setQuickPrefill(barcode.trim());
    if (barcode.trim()) setBarcode("");
    setQuickOpen(true);
  }

  const searchResults = useMemo(() => {
    const q = barcode.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [barcode, products]);

  /* --------------------------- keyboard shortcuts --------------------------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F1") {
        e.preventDefault();
        barcodeRef.current?.focus();
      } else if (e.key === "F2") {
        e.preventDefault();
        openQuickAdd();
      } else if (e.key === "F3") {
        e.preventDefault();
        setCustOpen(true);
      } else if (e.key === "F4") {
        e.preventDefault();
        if (lines.length > 0) setPayOpen(true);
        else toast.error("Bill is empty");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, barcode]);

  function handlePaid(result: InvoiceResult, payments: ReceiptPayment[]) {
    setReceipt({
      invoiceNumber: result.invoice_number,
      locationName: location?.name ?? "Store",
      customerName: customer?.name ?? null,
      lines: lines.map((l) => ({
        name: l.product.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        uom: l.uom,
        total: l.quantity * l.unit_price - l.discount,
      })),
      subtotal,
      discount,
      total,
      payments,
      createdAt: new Date().toISOString(),
    });
    setLines([]);
    setCustomer(null);
    setDiscount(0);
    setPayOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    void queryClient.invalidateQueries({ queryKey: ["payments-since"] });
    void queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
    toast.success(`Bill ${result.invoice_number} saved`);
    barcodeRef.current?.focus();
  }

  const lowStockIds = useMemo(
    () =>
      new Set(
        inventory
          .filter(
            (i) =>
              i.location_id === location?.id &&
              (products.find((p) => p.id === i.product_id)?.min_stock ?? 0) > i.quantity_on_hand,
          )
          .map((i) => i.product_id),
      ),
    [inventory, location?.id, products],
  );

  const tiles = useMemo(() => products.slice(0, 10), [products]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav active="/" />

      {/* Store selector + customer chip */}
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Select value={location?.id ?? ""} onValueChange={changeLocation}>
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
        <button
          onClick={() => setCustOpen(true)}
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            customer ? "border-primary/40 bg-primary/5" : "border-dashed text-muted-foreground",
          )}
        >
          <UserRound className="h-4 w-4" />
          {customer ? customer.name : "Walk-in customer"}
        </button>
        <div className="ml-auto text-xs text-muted-foreground">
          <span className="rounded border px-1.5 py-0.5 font-mono">F1</span> scan ·{" "}
          <span className="rounded border px-1.5 py-0.5 font-mono">F2</span> quick add ·{" "}
          <span className="rounded border px-1.5 py-0.5 font-mono">F3</span> customer ·{" "}
          <span className="rounded border px-1.5 py-0.5 font-mono">F4</span> pay
        </div>
      </div>

      {/* Customer banner — demographics + udhar alert */}
      <div className="border-b bg-muted/30 px-3 py-2">
        {customer ? (
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border bg-card px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserRound className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight">{customer.name}</div>
                <div className="text-xs text-muted-foreground">{customer.mobile ?? "No mobile"}</div>
              </div>
            </div>
            <BannerStat label="Visits" value={String(customer.visits)} />
            <BannerStat label="Age group" value={customer.age_group ?? "—"} />
            <BannerStat label="Gender" value={customer.gender ?? "—"} />
            <BannerStat label="Credit limit" value={customer.credit_limit > 0 ? inr(customer.credit_limit) : "—"} />
            {customer.outstanding_balance > 0 ? (
              <span className="ml-auto flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-sm font-bold text-destructive">
                <AlertTriangle className="h-4 w-4" /> UDHAR DUE: {inr(customer.outstanding_balance)}
              </span>
            ) : (
              <span className="ml-auto flex items-center gap-1.5 rounded-md bg-success/10 px-3 py-1.5 text-sm font-semibold text-success">
                <CheckCircle2 className="h-4 w-4" /> Udhar Clear
              </span>
            )}
          </div>
        ) : (
          <div className="mx-auto flex max-w-[1600px] items-center gap-2 text-xs text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" />
            New bill = customer first. Add the first item or press{" "}
            <span className="rounded border px-1 font-mono">F3</span> to pick a customer — or choose Walk-in.
          </div>
        )}
      </div>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 p-3">
        {/* Left: scan + cart */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="relative">
            <ScanBarcode className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={barcodeRef}
              autoFocus
              className="h-11 pl-8 text-base"
              placeholder="Scan barcode or type item name / SKU…"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBarcodeSubmit()}
            />
            {searchResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addToCart(p);
                      setBarcode("");
                      barcodeRef.current?.focus();
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      {p.name}
                      {p.variant && <span className="text-xs text-muted-foreground">{p.variant}</span>}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">{p.rack_location ?? "—"}</span>
                      <span>{p.barcode ?? p.sku ?? "—"}</span>
                      <b className="text-foreground">{inr(p.sale_price)}</b>
                      <span className={cn(stockAt(p.id, location?.id) <= p.min_stock && "text-destructive")}>
                        {stockAt(p.id, location?.id)} {p.uom_stock}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quick tiles */}
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="gap-1.5 border-dashed" onClick={openQuickAdd}>
              <Zap className="h-3.5 w-3.5" /> Quick add{" "}
              <span className="rounded border px-1 font-mono text-[10px]">F2</span>
            </Button>
            {tiles.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="flex flex-col items-start rounded-md border bg-card px-2.5 py-1.5 text-left text-xs hover:border-primary/40 hover:bg-accent"
              >
                <span className="max-w-36 truncate font-medium">{p.name}</span>
                <span className="text-muted-foreground">
                  {inr(p.sale_price)}/{p.uom_sale} · {stockAt(p.id, location?.id)}
                </span>
              </button>
            ))}
          </div>

          {/* Cart grid */}
          <div className="flex-1 overflow-y-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/70 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-left">Rack</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2 text-center">Qty</th>
                  <th className="px-2 py-2 text-right">Disc</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      Scan an item or tap a quick tile to start the bill.
                    </td>
                  </tr>
                )}
                {lines.map((l) => {
                  const stock = stockAt(l.product.id, location?.id);
                  const lineMax = maxLineDiscount(l.unit_price, l.quantity, l.product.min_sale_price);
                  return (
                    <tr key={l.product.id} className="border-t">
                      <td className="px-3 py-1.5">
                        <div className="font-medium">
                          {l.product.name}
                          {l.product.variant && (
                            <span className="ml-1.5 text-xs text-muted-foreground">{l.product.variant}</span>
                          )}
                        </div>
                        {/* Multi-location stock badge + 1-click indent */}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {locations.map((loc) => {
                            const q = stockAt(l.product.id, loc.id);
                            return (
                              <span
                                key={loc.id}
                                className={cn(
                                  "rounded px-1 py-0.5 font-mono text-[10px]",
                                  loc.id === location?.id
                                    ? stock <= l.product.min_stock
                                      ? "bg-destructive/15 text-destructive"
                                      : "bg-success/15 text-success"
                                    : "bg-muted text-muted-foreground",
                                )}
                                title={`${loc.name}: ${q} ${l.product.uom_stock}`}
                              >
                                {loc.code} {q}
                              </span>
                            );
                          })}
                          <button
                            onClick={() => setIndentProduct(l.product)}
                            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-primary hover:bg-accent"
                            title="Request stock from warehouse"
                          >
                            <Truck className="h-3 w-3" /> indent
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {l.product.rack_location ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{inr(l.unit_price)}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => setQuantity(l.product.id, l.quantity - 1)}
                          >
                            −
                          </Button>
                          <Input
                            type="number"
                            step="0.5"
                            className="h-6 w-14 px-1 text-center text-xs tabular-nums"
                            value={l.quantity}
                            onChange={(e) => setQuantity(l.product.id, Number(e.target.value) || 0)}
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => setQuantity(l.product.id, l.quantity + 1)}
                          >
                            +
                          </Button>
                          <span className="w-10 text-[10px] text-muted-foreground">{l.uom}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          className="h-6 w-20 text-right text-xs tabular-nums"
                          value={l.discount || ""}
                          onChange={(e) => setLineDiscount(l.product.id, Number(e.target.value) || 0)}
                          title={lineMax > 0 ? `Max ${inr(lineMax)} (min rate ${inr(l.product.min_sale_price)})` : "No discount allowed below floor price"}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        {inr(l.quantity * l.unit_price - l.discount)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => setQuantity(l.product.id, 0)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: totals */}
        <div className="flex w-80 flex-col gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items</span>
                <span className="tabular-nums">{lines.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{inr(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Discount</span>
                <Input
                  type="number"
                  className="h-7 w-24 text-right tabular-nums"
                  value={discount || ""}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    if (v > maxBillDiscount) {
                      toast.warning("Floor price protection", {
                        description: `Max bill discount is ${inr(maxBillDiscount)}.`,
                      });
                      setDiscount(maxBillDiscount);
                    } else setDiscount(Math.max(v, 0));
                  }}
                />
              </div>
              <div className="flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total</span>
                <span className="tabular-nums">{inr(total)}</span>
              </div>
            </div>
            <Button
              className="mt-4 h-12 w-full text-base"
              disabled={lines.length === 0}
              onClick={() => setPayOpen(true)}
            >
              <span className="rounded border border-primary-foreground/40 px-1 font-mono text-xs">F4</span>{" "}
              Pay & print ({inr(total)})
            </Button>
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() => {
                setLines([]);
                setDiscount(0);
                toast.info("Bill cleared");
              }}
            >
              Clear bill
            </Button>
          </div>
          {customer && customer.outstanding_balance > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="font-medium text-destructive">⚠️ Udhar due</div>
              <div className="tabular-nums">
                {customer.name}: {inr(customer.outstanding_balance)}
              </div>
            </div>
          )}
          <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
              <Plus className="h-3 w-3" /> Shortcuts
            </div>
            F1 scan · F2 quick add (pre-fills what you typed) · F3 customer · F4 pay · Enter adds scanned
            item. Line discount stops at the item's min allowed rate; bill discount stops at the floor-price
            total.
          </div>
        </div>
      </main>

      <PaymentModal
        open={payOpen}
        onOpenChange={setPayOpen}
        locationId={location?.id ?? ""}
        lines={lines}
        subtotal={subtotal}
        discount={discount}
        onDiscountChange={setDiscount}
        minTotal={minTotal}
        customer={customer}
        onPickCustomer={() => setCustOpen(true)}
        onPaid={handlePaid}
      />
      <CustomerDialog
        open={custOpen}
        onOpenChange={setCustOpen}
        onSelect={(c) => setCustomer(c)}
      />
      <QuickAddModal
        open={quickOpen}
        onOpenChange={setQuickOpen}
        locationId={location?.id ?? ""}
        prefill={quickPrefill}
        onAdded={(p) => {
          addToCart(p);
          barcodeRef.current?.focus();
        }}
      />
      <IndentDialog
        open={!!indentProduct}
        onOpenChange={(o) => !o && setIndentProduct(null)}
        product={indentProduct}
        locationId={location?.id ?? ""}
        locations={locations}
      />
      <ReceiptDialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)} data={receipt} />
    </div>
  );
}

function BannerStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
