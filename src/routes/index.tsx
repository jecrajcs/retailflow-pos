import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  addCustomer,
  categoryIcon,
  discountFromInput,
  familySummary,
  inr,
  matchesProductSearch,
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

type CustomerMode = "unset" | "chosen" | "walkin";
type HeldBill = {
  id: string;
  customer: Customer | null;
  customerMode: CustomerMode;
  lines: CartLine[];
  discount: number;
  locationId: string;
  businessDate: string;
};

function todayBusinessDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function PosPage() {
  const queryClient = useQueryClient();
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const { data: inventory = [] } = useInventory();
  const { data: customers = [] } = useCustomers();

  const [locationId, setLocationId] = useState("");
  const location = locations.find((l) => l.id === locationId);

  function changeLocation(id: string) {
    if (lines.length > 0 && id !== locationId) {
      toast.warning("Current bill is active", { description: "Hold or finish this bill before changing the store." });
      return;
    }
    setLocationId(id);
    localStorage.setItem(LS_KEY, id);
  }

  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("unset");
  const [barcode, setBarcode] = useState("");
  const [discount, setDiscount] = useState(0);
  const [discountMode, setDiscountMode] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [businessDate, setBusinessDate] = useState(todayBusinessDate);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPrefill, setQuickPrefill] = useState("");
  const [indentProduct, setIndentProduct] = useState<Product | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const custSearchRef = useRef<HTMLInputElement>(null);

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

  /** New bill starts here: clear everything and put focus on the customer search. */
  function startNewBill() {
    setLines([]);
    setCustomer(null);
    setCustomerMode("unset");
    setDiscount(0);
    setBusinessDate(todayBusinessDate());
    setBarcode("");
    setPayOpen(false);
    setTimeout(() => custSearchRef.current?.focus(), 30);
  }

  function resolveCustomer(c: Customer | null) {
    setCustomer(c);
    setCustomerMode(c ? "chosen" : "walkin");
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    setTimeout(() => barcodeRef.current?.focus(), 30);
  }

  function addToCart(product: Product) {
    if (!locationId) {
      toast.error("Select the store first");
      return;
    }
    if (customerMode === "unset") {
      toast.error("Customer pehle chunein", {
        description: "Search, add or pick Walk-in above — then scan items.",
      });
      return;
    }
    if (stockAt(product.id, locationId) <= 0) {
      toast.error("Out of stock at this store", { description: `Choose another store or request a transfer for ${product.name}.` });
      return;
    }
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
    if (quantity > stockAt(productId, locationId)) {
      toast.warning(`Only ${stockAt(productId, locationId)} in stock at this store`);
      quantity = stockAt(productId, locationId);
    }
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
    if (customerMode === "unset") {
      toast.error("Customer pehle chunein");
      return;
    }
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
      setQuickPrefill(barcode.trim());
      setQuickOpen(true);
    }
  }

  function openQuickAdd() {
    if (customerMode === "unset") {
      toast.error("Customer pehle chunein");
      return;
    }
    setQuickPrefill(barcode.trim());
    if (barcode.trim()) setBarcode("");
    setQuickOpen(true);
  }

  function holdCurrentBill() {
    if (customerMode === "unset") {
      toast.error("Choose a customer or Walk-in before holding this bill");
      return;
    }
    setHeldBills((current) => [...current, {
      id: crypto.randomUUID(), customer, customerMode, lines, discount, locationId, businessDate,
    }]);
    startNewBill();
  }

  function switchToHeldBill(id: string) {
    const held = heldBills.find((bill) => bill.id === id);
    if (!held) return;
    if (customerMode !== "unset" && (lines.length > 0 || customer || discount > 0)) {
      setHeldBills((current) => [...current, {
        id: crypto.randomUUID(), customer, customerMode, lines, discount, locationId, businessDate,
      }]);
    }
    setLines(held.lines);
    setCustomer(held.customer);
    setCustomerMode(held.customerMode);
    setDiscount(held.discount);
    setLocationId(held.locationId);
    setBusinessDate(held.businessDate);
    setHeldBills((current) => current.filter((bill) => bill.id !== id));
  }

  const searchResults = useMemo(() => {
    const q = barcode.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((p) => matchesProductSearch(p, q))
      .slice(0, 8);
  }, [barcode, products]);

  /* --------------------------- keyboard shortcuts --------------------------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F1") {
        e.preventDefault();
        if (customerMode === "unset") custSearchRef.current?.focus();
        else barcodeRef.current?.focus();
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
      } else if (e.key === "F5") {
        e.preventDefault();
        startNewBill();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, barcode, customerMode]);

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
    setCustomerMode("unset");
    setDiscount(0);
    setPayOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    void queryClient.invalidateQueries({ queryKey: ["payments-since"] });
    void queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    toast.success(`Bill ${result.invoice_number} saved`);
    setTimeout(() => custSearchRef.current?.focus(), 30);
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

  const tiles = useMemo(() => products.slice(0, 12), [products]);
  const customerUnset = customerMode === "unset";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav active="/" />

      {/* Store selector + New Bill */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Select value={location?.id ?? ""} onValueChange={changeLocation}>
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-info/10 px-1 py-0.5 font-mono text-[10px] text-info">
                    {l.code}
                  </span>
                  {l.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="gap-1.5" onClick={startNewBill}>
          <Plus className="h-4 w-4" /> New Bill
          <span className="rounded border border-primary-foreground/40 px-1 font-mono text-[10px]">F5</span>
        </Button>
        <button
          onClick={() => setCustOpen(true)}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            customerMode === "chosen"
              ? "border-primary/40 bg-primary/5"
              : "border-dashed text-muted-foreground",
          )}
        >
          <UserRound className="h-4 w-4" />
          {customerMode === "chosen" ? customer?.name : customerMode === "walkin" ? "Walk-in customer" : "No customer yet"}
        </button>
      </div>

      {/* Customer-first inline section — the bill cannot start before this is resolved */}
      <div className="border-b bg-muted/40 px-3 py-2">
        {customerUnset ? (
          <InlineCustomerSection
            customers={customers}
            searchRef={custSearchRef}
            onSelect={resolveCustomer}
          />
        ) : (
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserRound className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight">
                  {customer?.name ?? "Walk-in customer"}
                </div>
                <div className="text-xs text-muted-foreground">{customer?.mobile ?? "No mobile"}</div>
              </div>
            </div>
            {customer && (
              <>
                <BannerStat label="Visits" value={String(customer.visits)} />
                <BannerStat label="Age group" value={customer.age_group ?? "—"} />
                <BannerStat label="Gender" value={customer.gender ?? "—"} />
                <BannerStat
                  label="Credit limit"
                  value={customer.credit_limit > 0 ? inr(customer.credit_limit) : "—"}
                />
                {customer.outstanding_balance > 0 ? (
                  <span className="ml-auto flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-sm font-bold text-destructive">
                    <AlertTriangle className="h-4 w-4" /> UDHAR DUE: {inr(customer.outstanding_balance)}
                  </span>
                ) : (
                  <span className="ml-auto flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1.5 text-sm font-semibold text-success">
                    <CheckCircle2 className="h-4 w-4" /> Udhar Clear
                  </span>
                )}
              </>
            )}
            {customerMode === "walkin" && (
              <span className="ml-auto rounded-lg bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground">
                Walk-in — udhar N/A
              </span>
            )}
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
              disabled={customerUnset}
              className={cn(
                "h-11 pl-8 text-base",
                customerUnset && "opacity-50",
                !customerUnset && "ring-2 ring-ring/40",
              )}
              placeholder={
                customerUnset
                  ? "Customer choose karne ke baad scan enable hoga…"
                  : "Scan barcode or type item name / SKU…"
              }
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBarcodeSubmit()}
            />
            {searchResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-popover shadow-md">
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
                      <span className="rounded bg-info/10 px-1 py-0.5 font-mono text-info">{p.rack_location ?? "—"}</span>
                      <span className="font-mono">{p.barcode ?? p.sku ?? "—"}</span>
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

          {/* Cart grid */}
          <div className="flex-1 overflow-y-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-xs uppercase text-muted-foreground">
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
                      {customerUnset
                        ? "Customer choose karein — phir scan ya quick tile se bill shuru karein."
                        : "Scan an item or tap a quick tile to start the bill."}
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
                                    : "bg-info/10 text-info",
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
                          title={
                            lineMax > 0
                              ? `Max ${inr(lineMax)} (min rate ${inr(l.product.min_sale_price)})`
                              : "No discount allowed below floor price"
                          }
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

        {/* Right: quick tiles + totals */}
        <div className="flex w-80 flex-col gap-3">
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Quick items</span>
              <Button variant="outline" size="sm" className="gap-1 border-dashed" onClick={openQuickAdd}>
                <Zap className="h-3.5 w-3.5" /> Quick add
                <span className="rounded border px-1 font-mono text-[10px]">F2</span>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {tiles.map((p) => (
                <button
                  key={p.id}
                  disabled={customerUnset}
                  onClick={() => addToCart(p)}
                  className={cn(
                    "flex items-start gap-1.5 rounded-lg border bg-background px-2 py-1.5 text-left text-xs hover:border-primary/40 hover:bg-accent",
                    customerUnset && "opacity-50",
                  )}
                >
                  <span aria-hidden className="text-sm leading-none">
                    {categoryIcon(p.category)}
                  </span>
                  <span className="min-w-0">
                    <span className="block max-w-32 truncate font-medium">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {inr(p.sale_price)}/{p.uom_sale} · {stockAt(p.id, location?.id)} left
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 shadow-sm">
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
              <div className="flex justify-between border-t pt-2 font-display text-xl font-bold">
                <span>Total</span>
                <span className="tabular-nums">{inr(total)}</span>
              </div>
            </div>
            <Button
              size="lg"
              className="mt-4 h-14 w-full bg-success text-base text-success-foreground hover:bg-success/90"
              disabled={lines.length === 0}
              onClick={() => setPayOpen(true)}
            >
              <span className="rounded border border-success-foreground/40 px-1 font-mono text-xs">F4</span>
              Pay & print ({inr(total)})
            </Button>
          </div>

          {customer && customer.outstanding_balance > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="font-medium text-destructive">⚠️ Udhar due</div>
              <div className="tabular-nums">
                {customer.name}: {inr(customer.outstanding_balance)}
              </div>
            </div>
          )}
          <div className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
              <Plus className="h-3 w-3" /> Shortcuts
            </div>
            F1 scan · F2 quick add · F3 customer · F4 pay · F5 new bill · Enter adds scanned item. Floor
            price (min allowed rate) protects every line and bill discount.
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
        onSelect={(c) => resolveCustomer(c)}
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

/**
 * Inline customer-first picker shown on every new bill: search by name or
 * mobile, add a customer in three fields, or pick Walk-in — no modal.
 */
function InlineCustomerSection({
  customers,
  searchRef,
  onSelect,
}: {
  customers: Customer[];
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (c: Customer | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [ageGroup, setAgeGroup] = useState("Adult");
  const [gender, setGender] = useState("");
  const [busy, setBusy] = useState(false);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.mobile ?? "").includes(q))
      .slice(0, 6);
  }, [customers, search]);

  async function handleAdd() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await addCustomer({
        name: name.trim(),
        mobile: mobile.trim() || null,
        creditLimit: 0,
        ageGroup,
        gender: gender || null,
      });
      onSelect(created);
    } catch (e) {
      toast.error("Could not save customer", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-72 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            autoFocus
            className="pl-8"
            placeholder="Customer ka naam ya mobile search karein…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            setAdding((a) => !a);
            if (!adding) setTimeout(() => document.getElementById("ic-name")?.focus(), 30);
          }}
        >
          <Plus className="h-4 w-4" /> New customer
        </Button>
        <Button
          variant="secondary"
          onClick={() => onSelect(null)}
          className="gap-1.5"
          title="Bill without a registered customer — udhar unavailable"
        >
          <UserRound className="h-4 w-4" /> Walk-in customer
        </Button>
      </div>

      {adding && (
        <div className="mt-2 grid gap-2 rounded-lg border bg-muted/40 p-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label htmlFor="ic-name">Name *</Label>
            <Input
              id="ic-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ic-mobile">Mobile (optional)</Label>
            <Input
              id="ic-mobile"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="10-digit number"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <div className="flex items-end gap-2">
            <Select value={ageGroup} onValueChange={setAgeGroup}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Child", "Teen", "Adult", "Senior"].map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                {["Male", "Female", "Other"].map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAdd} disabled={!name.trim() || busy}>
              Save & start bill
            </Button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-2 grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm hover:border-primary/40 hover:bg-accent"
            >
              <span className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{c.name}</span>
                {c.mobile && <span className="text-xs text-muted-foreground">{c.mobile}</span>}
                {c.visits > 0 && (
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {c.visits} visits
                  </span>
                )}
              </span>
              {c.outstanding_balance > 0 ? (
                <span className="text-xs font-semibold text-destructive">
                  ⚠️ Udhar {inr(c.outstanding_balance)}
                </span>
              ) : (
                <span className="text-[10px] font-medium text-success">Clear</span>
              )}
            </button>
          ))}
        </div>
      )}
      {!adding && results.length === 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Bill customer ke bina start nahi hota — upar se search karein, naya customer add karein, ya
          Walk-in chunein.
        </p>
      )}
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
