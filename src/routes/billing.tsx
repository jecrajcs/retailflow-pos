import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarDays,
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { canAccessLocation, saveActiveLocation, useAccess } from "@/lib/access";
import { userFacingError } from "@/lib/retail-api";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  categoryIcon,
  createLocalDraft,
  discountFromInput,
  getProductPrice,
  inr,
  loadLocalDraftPayload,
  matchesProductSearch,
  maxLineDiscount,
  saveLocalDraft,
  voidLocalDraft,
  useCustomers,
  useInventory,
  useLocations,
  useProducts,
  useSales,
  useShortcutTiles,
  type CartLine,
  type Customer,
  type LocalInvoice,
  type InvoiceResult,
  type Product,
  type ReceiptPayment,
} from "@/lib/pos";

export const Route = createFileRoute("/billing")({
  head: () => ({
    meta: [
      { title: "RetailHub POS — Billing" },
      {
        name: "description",
        content:
          "POS billing with barcode scanning, customer lookup, quantity pricing, split payments and cash reconciliation.",
      },
      { property: "og:title", content: "RetailHub POS — Billing" },
      {
        property: "og:description",
        content:
          "POS billing with barcode scanning, customer lookup, quantity pricing, split payments and cash reconciliation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PosPage,
});

const LS_KEY = "pos-location-id";

type CustomerMode = "chosen" | "walkin";

function todayBusinessDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function PosPage() {
  const queryClient = useQueryClient();
  const { profile } = useAccess();
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const { data: inventory = [] } = useInventory();
  const { data: customers = [] } = useCustomers();
  const salesQuery = useSales();
  const sales = useMemo(() => salesQuery.data ?? [], [salesQuery.data]);
  const { data: shortcutRows = [] } = useShortcutTiles();
  const allowedLocations = locations.filter(
    (candidate) => candidate.is_active && canAccessLocation(profile, candidate.id),
  );

  const [locationId, setLocationId] = useState("");
  const location = allowedLocations.find((l) => l.id === locationId);
  const [currentInvoice, setCurrentInvoice] = useState<LocalInvoice | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    if (locationId || !allowedLocations.length) return;
    const savedLocationId = localStorage.getItem(LS_KEY);
    const selected =
      allowedLocations.find((candidate) => candidate.id === savedLocationId) ??
      (allowedLocations.length === 1 ? allowedLocations[0] : undefined);
    if (selected) {
      setLocationId(selected.id);
      saveActiveLocation(selected.id);
    }
  }, [allowedLocations, locationId]);

  function changeLocation(id: string) {
    if (!canAccessLocation(profile, id)) {
      toast.error("Your account is not assigned to this location.");
      return;
    }
    if ((lines.length > 0 || discount > 0) && id !== locationId) {
      toast.warning("Current bill is active", {
        description: "Complete this bill before changing the store.",
      });
      return;
    }
    setLocationId(id);
    saveActiveLocation(id);
    if (currentInvoice && currentInvoice.location_id !== id) void voidLocalDraft(currentInvoice.id);
    if (id !== locationId) {
      setCurrentInvoice(null);
    }
  }

  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("walkin");
  const [barcode, setBarcode] = useState("");
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [discountMode, setDiscountMode] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [businessDate, setBusinessDate] = useState(todayBusinessDate);
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPrefill, setQuickPrefill] = useState("");
  const [indentProduct, setIndentProduct] = useState<Product | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draftRestored || salesQuery.isLoading) return;
    let active = true;
    const storedLocation = localStorage.getItem(LS_KEY);
    const existing = sales
      .filter(
        (invoice) =>
          invoice.status === "DRAFT" &&
          canAccessLocation(profile, invoice.location_id) &&
          (!storedLocation || invoice.location_id === storedLocation),
      )
      .sort((a, b) =>
        (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at),
      )[0];
    void (async () => {
      try {
        if (existing) {
          const payload = await loadLocalDraftPayload(existing.id);
          if (!active) return;
          if (payload) {
            setCurrentInvoice(existing);
            setLocationId(existing.location_id);
            setCustomer(payload.customer);
            setCustomerMode(payload.customer_mode === "chosen" ? "chosen" : "walkin");
            setLines(payload.items);
            setDiscount(payload.discount_input);
            setDiscountMode(payload.discount_mode);
            setBusinessDate(existing.business_date);
          }
        }
      } catch (error) {
        toast.error("Could not restore the previous bill", {
          description: userFacingError(error, "The bill could not be loaded from this device."),
        });
      } finally {
        if (active) setDraftRestored(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [sales, draftRestored, profile, salesQuery.isLoading]);

  useEffect(() => {
    if (!draftRestored || !locationId || currentInvoice) return;
    let active = true;
    void createLocalDraft(locationId, businessDate, profile?.user_id, profile?.display_name)
      .then((invoice) => {
        if (active) setCurrentInvoice(invoice);
        else void voidLocalDraft(invoice.id);
      })
      .catch((error) =>
        toast.error("Could not start a local bill", {
          description: userFacingError(error, "Please refresh the page and try again."),
        }),
      );
    return () => {
      active = false;
    };
  }, [draftRestored, locationId, currentInvoice, businessDate, profile]);

  useEffect(() => {
    if (!currentInvoice) return;
    const invoice = {
      ...currentInvoice,
      location_id: locationId || currentInvoice.location_id,
      business_date: businessDate,
    };
    const timer = window.setTimeout(() => {
      void saveLocalDraft({
        invoice,
        customer,
        customer_mode: customerMode,
        items: lines,
        discount_mode: discountMode,
        discount_input: discount,
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    currentInvoice,
    locationId,
    businessDate,
    customer,
    customerMode,
    lines,
    discountMode,
    discount,
  ]);

  const stockAt = useCallback(
    (productId: string, locId: string | undefined) =>
      inventory.find((i) => i.product_id === productId && i.location_id === locId)
        ?.quantity_on_hand ?? 0,
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
  const discountEntryValue =
    discountMode === "PERCENT" && subtotal > 0
      ? ((discount / subtotal) * 100).toFixed(2)
      : discount || "";

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
    if (stockAt(product.id, locationId) <= 0) {
      toast.error("Out of stock at this store", {
        description: `Choose another store or request a transfer for ${product.name}.`,
      });
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        const nextQuantity = existing.quantity + 1;
        if (nextQuantity > stockAt(product.id, locationId)) {
          toast.warning(`Only ${stockAt(product.id, locationId)} in stock at this store`);
          return prev;
        }
        return prev.map((l) => {
          if (l.product.id !== product.id) return l;
          const quantity = nextQuantity;
          const { unitPrice } = getProductPrice(product, quantity);
          return {
            ...l,
            quantity,
            unit_price: unitPrice,
            discount: Math.min(
              l.discount,
              maxLineDiscount(unitPrice, quantity, product.min_sale_price),
            ),
          };
        });
      }
      const { unitPrice } = getProductPrice(product, 1);
      return [
        ...prev,
        {
          product,
          quantity: 1,
          unit_price: unitPrice,
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
        : prev.map((l) => {
            if (l.product.id !== productId) return l;
            const { unitPrice } = getProductPrice(l.product, quantity);
            return {
              ...l,
              quantity,
              unit_price: unitPrice,
              discount: Math.min(
                l.discount,
                maxLineDiscount(unitPrice, quantity, l.product.min_sale_price),
              ),
            };
          }),
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
      setQuickPrefill(barcode.trim());
      setQuickOpen(true);
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
    return products.filter((p) => matchesProductSearch(p, q)).slice(0, 8);
  }, [barcode, products]);

  useEffect(() => setActiveProductIndex(0), [barcode]);

  function handleProductKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && searchResults.length) {
      event.preventDefault();
      setActiveProductIndex((index) => Math.min(index + 1, searchResults.length - 1));
    } else if (event.key === "ArrowUp" && searchResults.length) {
      event.preventDefault();
      setActiveProductIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults[activeProductIndex];
      if (result) {
        addToCart(result);
        setBarcode("");
        barcodeRef.current?.focus();
      } else handleBarcodeSubmit();
    } else if (event.key === "Escape") {
      setBarcode("");
    }
  }

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
    setCustomerMode("walkin");
    setDiscount(0);
    setBusinessDate(todayBusinessDate());
    setPayOpen(false);
    setCurrentInvoice(null);
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    void queryClient.invalidateQueries({ queryKey: ["payments-since"] });
    void queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    toast.success(`Bill ${result.invoice_number} saved`);
    setTimeout(() => barcodeRef.current?.focus(), 30);
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

  const tiles = useMemo(() => {
    const configured = shortcutRows.find((row) => row["location_id"] === locationId);
    const configuredIds = configured?.["product_ids"];
    const ids = Array.isArray(configuredIds)
      ? configuredIds.filter((id): id is string => typeof id === "string")
      : [];
    if (!ids.length) return products.slice(0, 12);
    const byId = new Map(products.map((product) => [product.id, product]));
    return ids
      .flatMap((id) => {
        const product = byId.get(id);
        return product ? [product] : [];
      })
      .slice(0, 16);
  }, [products, shortcutRows, locationId]);
  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/billing" />

      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <SearchableSelect
          className="w-60"
          value={locationId}
          onValueChange={changeLocation}
          placeholder="Select billing store…"
          searchPlaceholder="Search outlet or code…"
          options={allowedLocations.map((l) => ({
            value: l.id,
            label: `${l.code} · ${l.name}`,
            keywords: [l.type, l.address ?? ""],
          }))}
        />
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
          {customerMode === "chosen" ? customer?.name : "Walk-in"}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Bill date</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarDays className="h-4 w-4" />{" "}
                {format(new Date(`${businessDate}T12:00:00`), "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={new Date(`${businessDate}T12:00:00`)}
                onSelect={(date) => {
                  if (!date) return;
                  setBusinessDate(
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
                  );
                }}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row lg:gap-4">
        {/* Left: scan + cart */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="relative">
            <ScanBarcode className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={barcodeRef}
              disabled={!locationId}
              className={cn("h-11 pl-8 text-base", "ring-2 ring-ring/40")}
              placeholder={
                !locationId ? "Select a store to scan items" : "Scan barcode or search items…"
              }
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={handleProductKeyDown}
            />
            {searchResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-popover shadow-md">
                {searchResults.map((p, index) => (
                  <button
                    key={p.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addToCart(p);
                      setBarcode("");
                      barcodeRef.current?.focus();
                    }}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent",
                      activeProductIndex === index && "bg-accent",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>
                        {p.name}
                        {p.name_hi && (
                          <span className="ml-1 text-muted-foreground">{p.name_hi}</span>
                        )}
                      </span>
                      {p.variant && (
                        <span className="text-xs text-muted-foreground">{p.variant}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="rounded bg-info/10 px-1 py-0.5 font-mono text-info">
                        {p.rack_location ?? "—"}
                      </span>
                      <span className="font-mono">{p.barcode ?? p.sku ?? "—"}</span>
                      <b className="text-foreground">{inr(p.sale_price)}</b>
                      <span
                        className={cn(
                          stockAt(p.id, location?.id) <= p.min_stock && "text-destructive",
                        )}
                      >
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
                {lines.map((l) => {
                  const stock = stockAt(l.product.id, location?.id);
                  const lineMax = maxLineDiscount(
                    l.unit_price,
                    l.quantity,
                    l.product.min_sale_price,
                  );
                  return (
                    <tr key={l.product.id} className="border-t">
                      <td className="px-3 py-1.5">
                        <div className="font-medium">
                          {l.product.name}
                          {l.product.variant && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {l.product.variant}
                            </span>
                          )}
                        </div>
                        {/* Multi-location stock badge + 1-click indent */}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {allowedLocations.map((loc) => {
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
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {inr(l.unit_price)}
                        {getProductPrice(l.product, l.quantity).tier && (
                          <span className="block text-[10px] text-primary">
                            {getProductPrice(l.product, l.quantity).tier?.label ?? "Quantity price"}
                          </span>
                        )}
                      </td>
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
                          onChange={(e) =>
                            setLineDiscount(l.product.id, Number(e.target.value) || 0)
                          }
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
        <div className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto lg:w-80 lg:shrink-0">
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                Quick items
              </span>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 border-dashed"
                onClick={openQuickAdd}
              >
                <Zap className="h-3.5 w-3.5" /> Quick add
                <span className="rounded border px-1 font-mono text-[10px]">F2</span>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {tiles.map((p) => (
                <button
                  key={p.id}
                  disabled={!locationId}
                  onClick={() => addToCart(p)}
                  className={cn(
                    "flex items-start gap-1.5 rounded-lg border bg-background px-2 py-1.5 text-left text-xs hover:border-primary/40 hover:bg-accent",
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
                <div className="flex items-center gap-1">
                  <SearchableSelect
                    className="h-7 w-20"
                    value={discountMode}
                    onValueChange={(value) => setDiscountMode(value as "AMOUNT" | "PERCENT")}
                    options={[
                      { value: "AMOUNT", label: "₹" },
                      { value: "PERCENT", label: "%" },
                    ]}
                  />
                  <Input
                    type="number"
                    className="h-7 w-24 text-right tabular-nums"
                    value={discountEntryValue}
                    onChange={(e) => {
                      const value = discountFromInput(
                        subtotal,
                        Number(e.target.value) || 0,
                        discountMode,
                      );
                      if (value > maxBillDiscount) {
                        toast.warning("Floor price protection", {
                          description: `Maximum allowed bill discount is ${inr(maxBillDiscount)}.`,
                        });
                        setDiscount(maxBillDiscount);
                      } else setDiscount(value);
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between border-t pt-2 font-display text-xl font-bold">
                <span>Total</span>
                <span className="tabular-nums">{inr(total)}</span>
              </div>
            </div>
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
            F1 scan · F2 quick add · F3 customer · F4 pay · Enter adds scanned item. Floor price
            (min allowed rate) protects every line and bill discount.
          </div>
        </div>
      </main>

      <div className="sticky bottom-0 z-30 border-t bg-card/95 px-3 py-2 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] text-muted-foreground sm:text-xs">
              {currentInvoice?.invoice_number ?? ""}
            </div>
            <div className="font-display text-lg font-bold tabular-nums sm:text-xl">
              {inr(total)}
            </div>
          </div>
          <div className="hidden items-center gap-1 text-[10px] text-muted-foreground md:flex">
            <span className="rounded border px-1 font-mono">F1</span> scan{" "}
            <span className="rounded border px-1 font-mono">F2</span> add{" "}
            <span className="rounded border px-1 font-mono">F3</span> customer{" "}
            <span className="rounded border px-1 font-mono">F4</span> pay
          </div>
          <Button
            size="lg"
            className="h-11 min-w-32 bg-success text-success-foreground hover:bg-success/90 sm:min-w-44"
            disabled={lines.length === 0 || !locationId}
            onClick={() => setPayOpen(true)}
          >
            Pay · {inr(total)}
          </Button>
        </div>
        <div className="mx-auto mt-1 flex max-w-[1600px] items-center justify-center gap-2 border-t pt-1 text-[9px] text-muted-foreground md:hidden">
          <span>F1 scan</span>
          <span>F2 add</span>
          <span>F3 customer</span>
          <span>F4 pay</span>
        </div>
      </div>

      <PaymentModal
        open={payOpen}
        onOpenChange={setPayOpen}
        locationId={location?.id ?? ""}
        draftId={currentInvoice?.id}
        invoiceNumber={currentInvoice?.invoice_number}
        cashierId={profile?.user_id}
        cashierName={profile?.display_name}
        lines={lines}
        subtotal={subtotal}
        discount={discount}
        onDiscountChange={setDiscount}
        businessDate={businessDate}
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
        managerMode={profile?.role !== "CASHIER"}
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
        locations={allowedLocations}
      />
      <ReceiptDialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)} data={receipt} />
    </div>
  );
}
