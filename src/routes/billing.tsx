import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarDays,
  Camera,
  MapPin,
  Plus,
  ScanBarcode,
  Search,
  Trash2,
  Truck,
  UserRound,
  Zap,
  Clock3,
} from "lucide-react";
import { toast } from "sonner";

import { AppNav } from "@/components/pos/app-nav";
import { PaymentModal } from "@/components/pos/payment-modal";
import { CustomerDialog } from "@/components/pos/customer-dialog";
import { QuickAddModal } from "@/components/pos/quick-add-modal";
import { CameraScannerDialog } from "@/components/pos/camera-scanner";
import { IndentDialog } from "@/components/pos/indent-dialog";
import { ReceiptDialog, type ReceiptData } from "@/components/pos/receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { canAccessLocation, saveActiveLocation, useAccess } from "@/lib/access";
import { userFacingError } from "@/lib/retail-api";
import { expiringProductSuggestions } from "@/lib/expiry-alerts";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  useLocationProducts,
  useLocations,
  useProducts,
  usePurchases,
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

function todayBusinessDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function playScanBeep() {
  if (typeof window === "undefined") return;
  const AudioContextClass =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.07);
    oscillator.onended = () => void context.close();
  } catch {
    // Audio feedback is optional when browser audio is unavailable.
  }
}

function PosPage() {
  const queryClient = useQueryClient();
  const { profile } = useAccess();
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const { data: inventory = [] } = useInventory();
  const { data: locationProducts = [] } = useLocationProducts();
  const { data: customers = [] } = useCustomers();
  const { data: purchases = [] } = usePurchases();
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
  const [customerChoice, setCustomerChoice] = useState<"unset" | "walk-in" | "customer">("unset");
  const [walkIn, setWalkIn] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [barcodeChoices, setBarcodeChoices] = useState<Product[]>([]);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [discountMode, setDiscountMode] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [businessDate, setBusinessDate] = useState(todayBusinessDate);
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPrefill, setQuickPrefill] = useState("");
  const [correctionProduct, setCorrectionProduct] = useState<Product | null>(null);
  const [indentProduct, setIndentProduct] = useState<Product | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const remoteScanHandler = useRef<(code: string) => void>(() => undefined);

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
            const isWalkIn =
              payload.customer?.name?.trim().toLocaleLowerCase() === "walk-in" &&
              !payload.customer.mobile;
            setWalkIn(isWalkIn);
            setCustomerChoice(payload.customer ? (isWalkIn ? "walk-in" : "customer") : "unset");
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
    if (!draftRestored || !locationId || !customer || currentInvoice) return;
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
  }, [draftRestored, locationId, customer, currentInvoice, businessDate, profile]);

  useEffect(() => {
    if (!draftRestored || !locationId || customerChoice !== "unset") return;
    setCustOpen(true);
  }, [draftRestored, locationId, customerChoice]);

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
        customer_mode: customer ? "chosen" : "unset",
        items: lines,
        discount_mode: discountMode,
        discount_input: discount,
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentInvoice, locationId, businessDate, customer, lines, discountMode, discount]);

  const stockAt = useCallback(
    (productId: string, locId: string | undefined) =>
      inventory.find((i) => i.product_id === productId && i.location_id === locId)
        ?.quantity_on_hand ?? 0,
    [inventory],
  );

  const awaitingCount = useCallback(
    (productId: string, locId: string | undefined) =>
      !!locId &&
      locationProducts.some(
        (row) =>
          row.product_id === productId &&
          row.location_id === locId &&
          row.stock_count_status === "AWAITING_COUNT",
      ),
    [locationProducts],
  );

  function stockLabel(productId: string, locId: string | undefined) {
    return awaitingCount(productId, locId)
      ? "Awaiting count"
      : `${stockAt(productId, locId)} in stock`;
  }

  const expiringSuggestions = useMemo(() => {
    const availableProductIds = new Set(
      products
        .filter(
          (product) => stockAt(product.id, locationId) > 0 || awaitingCount(product.id, locationId),
        )
        .map((product) => product.id),
    );
    return expiringProductSuggestions(purchases, products, availableProductIds).slice(0, 6);
  }, [awaitingCount, locationId, products, purchases, stockAt]);

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

  function resolveCustomer(c: Customer | null, isWalkIn = false) {
    setCustomer(c);
    setWalkIn(isWalkIn && !!c);
    setCustomerChoice(c ? (isWalkIn ? "walk-in" : "customer") : "unset");
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    setTimeout(() => barcodeRef.current?.focus(), 30);
  }

  function addToCart(product: Product, allowNewUncounted = false) {
    if (!customer) {
      setCustOpen(true);
      return;
    }
    if (!locationId) {
      toast.error("Select the store first");
      return;
    }
    if (product.review_status === "REJECTED") {
      setCorrectionProduct(product);
      setQuickPrefill("");
      setQuickOpen(true);
      toast.error("This SKU needs a correction before sale.", {
        description: product.review_reason || "Review the item details and resubmit them.",
      });
      return;
    }
    const uncounted = allowNewUncounted || awaitingCount(product.id, locationId);
    if (!uncounted && stockAt(product.id, locationId) <= 0) {
      toast.error("Out of stock at this store", {
        description: `Choose another store or request a transfer for ${product.name}.`,
      });
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        const nextQuantity = existing.quantity + 1;
        if (!uncounted && nextQuantity > stockAt(product.id, locationId)) {
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
    playScanBeep();
  }

  function setQuantity(productId: string, quantity: number) {
    const product = products.find((item) => item.id === productId);
    const precision = product?.is_loose
      ? Math.max(0, Math.min(3, product.quantity_precision ?? 3))
      : 0;
    const scale = 10 ** precision;
    quantity = Math.round(quantity * scale) / scale;
    if (!awaitingCount(productId, locationId) && quantity > stockAt(productId, locationId)) {
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

  function handleBarcodeValue(value: string) {
    const cleanValue = value.trim();
    const q = cleanValue.toLowerCase();
    if (!q) return;
    if (!customer) {
      setCustOpen(true);
      return;
    }
    const codeMatches = products.filter(
      (p) => p.barcode?.toLowerCase() === q || p.sku?.toLowerCase() === q,
    );
    if (codeMatches.length > 1) {
      setBarcodeChoices(codeMatches);
      setBarcode("");
      return;
    }
    const hit = codeMatches[0] ?? products.find((p) => p.name.toLowerCase() === q);
    if (hit) {
      addToCart(hit);
      setBarcode("");
      barcodeRef.current?.focus();
    } else {
      setQuickPrefill(cleanValue);
      setQuickOpen(true);
      setBarcode("");
    }
  }

  remoteScanHandler.current = handleBarcodeValue;

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("retailflow-pos-scanner");
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: unknown; code?: unknown };
      if (message.type === "barcode" && typeof message.code === "string") {
        remoteScanHandler.current(message.code);
      }
    };
    return () => channel.close();
  }, []);

  function handleBarcodeSubmit() {
    handleBarcodeValue(barcode);
  }

  function openQuickAdd() {
    if (!customer) {
      setCustOpen(true);
      return;
    }
    setQuickPrefill(barcode.trim());
    setCorrectionProduct(null);
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
      const cleanValue = barcode.trim().toLowerCase();
      const codeMatches = products.filter(
        (p) => p.barcode?.toLowerCase() === cleanValue || p.sku?.toLowerCase() === cleanValue,
      );
      if (codeMatches.length) {
        handleBarcodeValue(barcode);
        return;
      }
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
    setCustomerChoice("unset");
    setWalkIn(false);
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

  async function saveCurrentBill() {
    if (!currentInvoice) return;
    await saveLocalDraft({
      invoice: {
        ...currentInvoice,
        location_id: locationId || currentInvoice.location_id,
        business_date: businessDate,
      },
      customer,
      customer_mode: customer ? "chosen" : "unset",
      items: lines,
      discount_mode: discountMode,
      discount_input: discount,
    });
  }

  async function holdCurrentBill() {
    if (!currentInvoice || (!lines.length && discount <= 0)) return;
    try {
      await saveCurrentBill();
      setCurrentInvoice(null);
      setLines([]);
      setCustomer(null);
      setCustomerChoice("unset");
      setWalkIn(false);
      setDiscount(0);
      setBarcode("");
    } catch (error) {
      toast.error("Could not hold this bill", {
        description: userFacingError(error, "The current bill could not be saved."),
      });
    }
  }

  async function openHeldBill(invoice: LocalInvoice) {
    if (invoice.id === currentInvoice?.id) return;
    try {
      await saveCurrentBill();
      const payload = await loadLocalDraftPayload(invoice.id);
      if (!payload) throw new Error("The held bill could not be loaded from this device.");
      const isWalkIn =
        payload.customer?.name?.trim().toLocaleLowerCase() === "walk-in" &&
        !payload.customer.mobile;
      setCurrentInvoice(invoice);
      setLocationId(invoice.location_id);
      saveActiveLocation(invoice.location_id);
      setCustomer(payload.customer);
      setCustomerChoice(payload.customer ? (isWalkIn ? "walk-in" : "customer") : "unset");
      setWalkIn(isWalkIn);
      setLines(payload.items);
      setDiscount(payload.discount_input);
      setDiscountMode(payload.discount_mode);
      setBusinessDate(invoice.business_date);
    } catch (error) {
      toast.error("Could not open held bill", {
        description: userFacingError(error, "The held bill could not be loaded."),
      });
    }
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
            customer ? "border-primary/40 bg-primary/5" : "border-dashed text-muted-foreground",
          )}
        >
          <UserRound className="h-4 w-4" />
          {customer?.name || customer?.mobile || "Select customer"}
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

      {sales.some(
        (invoice) => invoice.status === "DRAFT" && canAccessLocation(profile, invoice.location_id),
      ) && (
        <div className="flex items-center gap-2 overflow-x-auto border-b bg-muted/20 px-3 py-1.5">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Bills</span>
          {sales
            .filter(
              (invoice) =>
                invoice.status === "DRAFT" && canAccessLocation(profile, invoice.location_id),
            )
            .map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                onClick={() => void openHeldBill(invoice)}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 text-xs",
                  invoice.id === currentInvoice?.id
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "bg-background hover:bg-accent",
                )}
              >
                {invoice.invoice_number}
                {invoice.id === currentInvoice?.id ? " · Current" : ""}
              </button>
            ))}
          {currentInvoice && (lines.length > 0 || discount > 0) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void holdCurrentBill()}
            >
              Hold current bill
            </Button>
          )}
        </div>
      )}

      {customer && expiringSuggestions.length > 0 && (
        <section
          aria-label="Products to suggest before expiry"
          className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/5 px-3 py-2"
        >
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-warning">
            <Clock3 className="h-3.5 w-3.5" />
            Near expiry · suggest
          </span>
          {expiringSuggestions.map(({ product, quantity, expiresOn }) => (
            <button
              key={product.id}
              type="button"
              onClick={() => addToCart(product)}
              className="rounded-md border border-warning/30 bg-background px-2.5 py-1 text-left text-xs hover:bg-warning/10"
              title={`${quantity} received in expiring lots; store stock ${stockAt(product.id, locationId) || "awaiting count"}`}
            >
              <span className="font-medium">{product.name}</span>
              {product.variant && (
                <span className="text-muted-foreground"> · {product.variant}</span>
              )}
              <span className="block text-[10px] text-muted-foreground">
                Expires {new Date(`${expiresOn}T00:00:00`).toLocaleDateString("en-IN")}
              </span>
            </button>
          ))}
        </section>
      )}

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row lg:gap-4">
        {/* Left: scan + cart */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start gap-2">
            <div className="relative min-w-0 flex-1">
              <ScanBarcode className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                ref={barcodeRef}
                disabled={!locationId || !customer}
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
                          {stockLabel(p.id, location?.id)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 gap-2"
              disabled={!locationId || !customer}
              onClick={() => setCameraOpen(true)}
              aria-label="Scan using this device camera"
            >
              <Camera className="h-4 w-4" /> <span className="hidden sm:inline">Camera</span>
            </Button>
            <Button asChild variant="ghost" className="h-11 shrink-0 px-2 text-xs">
              <Link to="/scanner">Pair phone</Link>
            </Button>
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
                                title={`${loc.name}: ${stockLabel(l.product.id, loc.id)}`}
                              >
                                {loc.code}{" "}
                                {awaitingCount(l.product.id, loc.id) ? "count pending" : q}
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
                            step={
                              l.product.is_loose
                                ? String(
                                    1 /
                                      10 **
                                        Math.max(0, Math.min(3, l.product.quantity_precision ?? 3)),
                                  )
                                : "1"
                            }
                            min="0"
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

          {customer && !walkIn && customer.outstanding_balance > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="font-medium text-destructive">⚠️ Udhar due</div>
              <div className="tabular-nums">
                {customer.name || customer.mobile}: {inr(customer.outstanding_balance)}
              </div>
            </div>
          )}
          <div className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
              <Plus className="h-3 w-3" /> Shortcuts
            </div>
            F1 scan · F2 quick add · F3 customer · F4 pay · Enter adds the selected item.
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
          <Button
            size="lg"
            className="h-11 min-w-32 bg-success text-success-foreground hover:bg-success/90 sm:min-w-44"
            disabled={lines.length === 0 || !locationId || !customer}
            onClick={() => setPayOpen(true)}
          >
            Pay · {inr(total)}
          </Button>
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
        walkIn={walkIn}
        upiVpa={location?.upi_vpa ?? null}
        upiPayeeName={location?.name ?? "RetailFlow Store"}
        onPaid={handlePaid}
      />
      <CustomerDialog
        open={custOpen}
        onOpenChange={setCustOpen}
        onSelect={(c, isWalkIn) => resolveCustomer(c, !!isWalkIn)}
      />
      <Dialog
        open={barcodeChoices.length > 1}
        onOpenChange={(open) => {
          if (!open) setBarcodeChoices([]);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose the matching SKU</DialogTitle>
            <DialogDescription>
              This code matches multiple products. Select the intended item before adding it.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {barcodeChoices.map((product) => (
              <button
                key={product.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-accent"
                onClick={() => {
                  setBarcodeChoices([]);
                  addToCart(product);
                  barcodeRef.current?.focus();
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{product.name}</span>
                  {product.variant && (
                    <span className="block text-xs text-muted-foreground">{product.variant}</span>
                  )}
                  <span className="block font-mono text-xs text-muted-foreground">
                    SKU {product.sku ?? "—"} · Barcode {product.barcode ?? "—"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold">{inr(product.sale_price)}</span>
                  <span className="text-xs text-muted-foreground">
                    {stockLabel(product.id, location?.id)} in stock
                  </span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <QuickAddModal
        open={quickOpen}
        onOpenChange={(open) => {
          setQuickOpen(open);
          if (!open) setCorrectionProduct(null);
        }}
        locationId={location?.id ?? ""}
        prefill={quickPrefill}
        correctionProduct={correctionProduct}
        managerMode={profile?.role !== "CASHIER"}
        onAdded={(p) => {
          addToCart(p, true);
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
      <CameraScannerDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onScan={handleBarcodeValue}
      />
    </div>
  );
}
