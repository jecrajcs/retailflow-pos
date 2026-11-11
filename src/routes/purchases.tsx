import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileUp, Plus, ScanSearch, ShieldCheck, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { AppNav } from "@/components/pos/app-nav";
import { DataTable } from "@/components/pos/data-table";
import { QuickAddModal } from "@/components/pos/quick-add-modal";
import { itemRowsFromOcr } from "@/lib/purchase-extraction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  inr,
  markPurchaseReviewed,
  matchesProductSearch,
  receivePurchaseReceipt,
  savePurchaseReceipt,
  useLocations,
  useProducts,
  usePurchases,
  type LocalPurchaseReceipt,
  type Product,
} from "@/lib/pos";
import { canAccessLocation, canManage, useAccess } from "@/lib/access";
import { userFacingError } from "@/lib/retail-api";

export const Route = createFileRoute("/purchases")({ component: PurchasesPage });

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `purchase-${Date.now()}`;
}
function today() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dateFromOcr(text: string) {
  const match = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
}

function normalizedHeader(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function excelDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + Math.round(value) * 86400000).toISOString().slice(0, 10);
  }
  const parsedFromText = dateFromOcr(String(value ?? ""));
  if (parsedFromText) return parsedFromText;
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

async function parseExcelPurchase(file: File, products: Product[]) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("The workbook has no sheets to read.");
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const headerIndex = grid.findIndex((cells) => {
    const headers = cells.map(normalizedHeader);
    return (
      headers.some((header) =>
        ["productname", "itemname", "product", "item", "sku", "barcode", "itemcode"].includes(
          header,
        ),
      ) &&
      headers.some((header) => ["qty", "quantity", "qtybought", "receivedqty"].includes(header))
    );
  });
  if (headerIndex < 0)
    throw new Error("Could not find item, quantity, and price columns in this workbook.");
  const headers = (grid[headerIndex] ?? []).map((value) => String(value ?? "").trim());
  const rawRows = grid
    .slice(headerIndex + 1)
    .map((cells) =>
      Object.fromEntries(
        headers.flatMap((header, index) => (header ? [[header, cells[index] ?? null]] : [])),
      ),
    );
  const value = (row: Record<string, unknown>, aliases: string[]) => {
    const entry = Object.entries(row).find(([header]) =>
      aliases.includes(normalizedHeader(header)),
    );
    return entry?.[1] ?? null;
  };
  const number = (input: unknown) => {
    const result = Number(String(input ?? "").replace(/[₹,\s]/g, ""));
    return Number.isFinite(result) ? result : 0;
  };
  const rows = rawRows
    .flatMap((row) => {
      const sku = String(value(row, ["sku", "barcode", "itemcode", "productcode"]) ?? "").trim();
      const name = String(
        value(row, ["productname", "itemname", "product", "item", "description", "particulars"]) ??
          "",
      ).trim();
      const quantity = number(value(row, ["qty", "quantity", "qtybought", "receivedqty", "units"]));
      const amount = number(
        value(row, ["linetotal", "totalpurchaseamt", "amount", "totalamount", "netamount"]),
      );
      const unitCost =
        number(
          value(row, ["unitcost", "landingcost", "purchasecost", "buyprice", "costprice", "rate"]),
        ) || (quantity > 0 ? amount / quantity : 0);
      if ((!sku && !name) || quantity <= 0 || unitCost < 0) return [];
      const product =
        (sku
          ? products.find(
              (candidate) =>
                candidate.sku?.toLowerCase() === sku.toLowerCase() ||
                candidate.barcode?.toLowerCase() === sku.toLowerCase(),
            )
          : undefined) ??
        products.find((candidate) => name && matchesProductSearch(candidate, name));
      const retailPrice =
        number(
          value(row, [
            "retailprice",
            "sellprice",
            "sellingprice",
            "standardsellprice",
            "standardrate",
          ]),
        ) ||
        product?.sale_price ||
        0;
      const sourceTotal = amount > 0 ? amount : quantity * unitCost;
      const resolvedSku = sku || product?.sku || undefined;
      return [
        {
          id: newId(),
          product_id: product?.id ?? "",
          name: name || product?.name || sku,
          quantity,
          unit_cost: unitCost,
          source_total: sourceTotal,
          retail_price: retailPrice,
          uom: String(value(row, ["unit", "uom", "saleunit"]) ?? product?.uom_sale ?? "Pcs").trim(),
          ...(resolvedSku ? { sku: resolvedSku } : {}),
          supplier: String(
            value(row, ["supplier", "suppliername", "vendor", "vendorname"]) ?? "",
          ).trim(),
          invoice: String(
            value(row, ["invoiceno", "invoicenumber", "billno", "billnumber"]) ?? "",
          ).trim(),
          date: excelDate(value(row, ["date", "invoicedate", "billdate"])),
        },
      ];
    })
    .slice(0, 300);
  return { sheetName, rows };
}

function PurchasesPage() {
  const { profile } = useAccess();
  const queryClient = useQueryClient();
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const { data: receipts = [] } = usePurchases();
  const warehouses = locations.filter(
    (location) =>
      location.type.toUpperCase() === "WAREHOUSE" && canAccessLocation(profile, location.id),
  );
  const accessibleWarehouseIds = new Set(warehouses.map((location) => location.id));
  const visibleReceipts = receipts.filter((receipt) =>
    accessibleWarehouseIds.has(receipt.warehouse_location_id),
  );
  const [receiptId, setReceiptId] = useState(newId);
  const [supplier, setSupplier] = useState("");
  const [supplierInvoice, setSupplierInvoice] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [attachment, setAttachment] = useState<Blob | null>(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [items, setItems] = useState<LocalPurchaseReceipt["items"]>([]);
  const [quickAddIndex, setQuickAddIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<LocalPurchaseReceipt["status"]>("DRAFT");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");

  const total = useMemo(
    () =>
      items.reduce((sum, item) => sum + (item.source_total ?? item.quantity * item.unit_cost), 0),
    [items],
  );

  function openReceipt(receipt: LocalPurchaseReceipt) {
    setReceiptId(receipt.id);
    setSupplier(receipt.supplier_name);
    setSupplierInvoice(receipt.supplier_invoice_number);
    setInvoiceDate(receipt.invoice_date);
    setWarehouseId(receipt.warehouse_location_id);
    setAttachment(receipt.attachment ?? null);
    setAttachmentName(receipt.attachment_name ?? "");
    setOcrText(receipt.ocr_text ?? "");
    setItems(receipt.items ?? []);
    setStatus(receipt.status);
  }

  async function processInvoice(file: File) {
    setAttachment(file);
    setAttachmentName(file.name);
    setWorking(true);
    setProgress("Loading local OCR…");
    let cleanupWorker: (() => Promise<unknown>) | undefined;
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng+hin", undefined, {
        workerPath: "/assets/tesseract/worker.min.js",
        corePath: "/assets/tesseract/tesseract-core-simd-lstm.wasm.js",
        langPath: "/assets/tesseract/lang-data",
        cacheMethod: "write",
        logger: (message) =>
          setProgress(
            message.status === "recognizing text"
              ? `Reading invoice… ${Math.round((message.progress ?? 0) * 100)}%`
              : message.status,
          ),
      });
      cleanupWorker = () => worker.terminate();
      let output = "";
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/assets/pdf.worker.min.mjs";
        const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
          .promise;
        const pageLimit = Math.min(document.numPages, 5);
        for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
          setProgress(`Reading page ${pageNumber} of ${pageLimit} locally…`);
          const page = await document.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not prepare a local PDF page for OCR.");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const result = await worker.recognize(canvas);
          output += `\n--- Page ${pageNumber} ---\n${result.data.text}`;
        }
        document.cleanup();
      } else {
        const result = await worker.recognize(file);
        output = result.data.text;
      }
      setOcrText(output.trim());
      const invoiceNumberMatch = output.match(
        /(?:invoice|bill|inv)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i,
      );
      if (invoiceNumberMatch?.[1] && !supplierInvoice.trim())
        setSupplierInvoice(invoiceNumberMatch[1]);
      const explicitSupplier = output.match(/(?:supplier|vendor|from)\s*[:#-]\s*([^\r\n]+)/i)?.[1];
      const supplierCandidate =
        explicitSupplier?.trim() ||
        output
          .split(/\r?\n/)
          .map((line) => line.replace(/\s+/g, " ").trim())
          .find(
            (line) =>
              line.length >= 3 &&
              line.length <= 80 &&
              !/(invoice|bill|gstin|gst no|phone|mobile|date|tax invoice|\bqty\b|quantity|rate|cost|amount|mrp|sku|barcode)/i.test(
                line,
              ),
          );
      if (supplierCandidate && !supplier.trim()) setSupplier(supplierCandidate);
      const detectedDate = dateFromOcr(output);
      if (detectedDate) setInvoiceDate(detectedDate);
      const extractedItems = itemRowsFromOcr(output, products);
      if (extractedItems.length) setItems(extractedItems);
      setProgress("Local OCR complete. Verify each field before saving.");
      toast.success("Invoice read on this device", {
        description: `${extractedItems.length} possible item rows extracted. Review every field and product match.`,
      });
    } catch (error) {
      setProgress("OCR could not read this file. You can still enter the invoice manually.");
      toast.error("Local OCR failed", {
        description: userFacingError(
          error,
          "Try checking the invoice details and network connection.",
        ),
      });
    } finally {
      await cleanupWorker?.().catch(() => undefined);
      setWorking(false);
    }
  }

  async function processWorkbook(file: File) {
    setAttachment(file);
    setAttachmentName(file.name);
    setWorking(true);
    setProgress("Reading invoice workbook locally…");
    try {
      const parsed = await parseExcelPurchase(file, products);
      if (!parsed.rows.length)
        throw new Error("No purchase item rows with a valid quantity were found.");
      const metadata =
        parsed.rows.find((row) => row.supplier || row.invoice || row.date) ?? parsed.rows[0]!;
      if (metadata.supplier && !supplier.trim()) setSupplier(metadata.supplier);
      if (metadata.invoice && !supplierInvoice.trim()) setSupplierInvoice(metadata.invoice);
      if (metadata.date) setInvoiceDate(metadata.date);
      setItems(
        parsed.rows.map(({ supplier: _supplier, invoice: _invoice, date: _date, ...item }) => item),
      );
      setOcrText(
        `Excel sheet: ${parsed.sheetName}\nRows extracted: ${parsed.rows.length}\nReview item matches, quantities, source totals, and prices before saving.`,
      );
      setProgress("Excel details prefilled. Review each item before saving.");
      toast.success("Purchase workbook read on this device", {
        description: `${parsed.rows.length} item rows extracted. New SKUs can be created from their purchase lines.`,
      });
    } catch (error) {
      setProgress("Workbook could not be read. You can still enter the invoice manually.");
      toast.error("Could not read purchase workbook", {
        description: userFacingError(error, "Check the workbook headers and try again."),
      });
    } finally {
      setWorking(false);
    }
  }

  function startNew() {
    setReceiptId(newId());
    setSupplier("");
    setSupplierInvoice("");
    setInvoiceDate(today());
    setWarehouseId(warehouses[0]?.id ?? "");
    setAttachment(null);
    setAttachmentName("");
    setOcrText("");
    setItems([]);
    setStatus("DRAFT");
    setProgress("");
  }

  async function saveDraft(): Promise<boolean> {
    if (!supplier.trim() || !supplierInvoice.trim() || !warehouseId) {
      toast.error("Supplier, supplier invoice number, and warehouse are required.");
      return false;
    }
    setWorking(true);
    try {
      const receipt: LocalPurchaseReceipt = {
        id: receiptId,
        supplier_name: supplier.trim(),
        supplier_invoice_number: supplierInvoice.trim(),
        invoice_date: invoiceDate,
        warehouse_location_id: warehouseId,
        attachment,
        attachment_name: attachmentName,
        ocr_text: ocrText,
        status,
        created_at:
          receipts.find((row) => row.id === receiptId)?.created_at ?? new Date().toISOString(),
        sync_status: "LOCAL",
        items: items.map((item) => ({
          ...item,
          id: item.id ?? newId(),
          source_total: item.source_total ?? item.quantity * item.unit_cost,
        })),
        source_total: items.reduce(
          (sum, item) => sum + (item.source_total ?? item.quantity * item.unit_cost),
          0,
        ),
      };
      await savePurchaseReceipt(receipt);
      void queryClient.invalidateQueries({ queryKey: ["purchases"] });
      toast.success("Purchase draft saved on this device");
      return true;
    } catch (error) {
      toast.error("Could not save purchase", {
        description: userFacingError(
          error,
          "The purchase could not be saved. Check the details and try again.",
        ),
      });
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function approve() {
    setWorking(true);
    try {
      const saved = await saveDraft();
      if (!saved) {
        setWorking(false);
        return;
      }
      await markPurchaseReviewed(receiptId, profile?.display_name ?? "Manager");
      setStatus("REVIEWED");
      void queryClient.invalidateQueries({ queryKey: ["purchases"] });
      toast.success("Purchase approved for warehouse receiving");
    } catch (error) {
      toast.error("Review failed", {
        description: userFacingError(
          error,
          "The purchase could not be reviewed. Refresh and try again.",
        ),
      });
    } finally {
      setWorking(false);
    }
  }

  async function receive() {
    setWorking(true);
    try {
      await receivePurchaseReceipt(receiptId, profile?.display_name ?? "Manager");
      setStatus("RECEIVED");
      void queryClient.invalidateQueries({ queryKey: ["purchases"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Warehouse stock updated locally");
    } catch (error) {
      toast.error("Could not receive stock", {
        description: userFacingError(
          error,
          "The stock could not be received. Refresh and try again.",
        ),
      });
    } finally {
      setWorking(false);
    }
  }

  const quickAddItem = quickAddIndex === null ? undefined : items[quickAddIndex];

  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/purchases" />
      <QuickAddModal
        open={quickAddIndex !== null}
        onOpenChange={(open) => {
          if (!open) setQuickAddIndex(null);
        }}
        locationId={warehouseId}
        prefill={quickAddItem?.name ?? ""}
        {...(quickAddItem?.sku ? { prefillSku: quickAddItem.sku } : {})}
        {...(quickAddItem?.retail_price !== undefined
          ? { prefillRetailPrice: quickAddItem.retail_price }
          : {})}
        {...(quickAddItem ? { prefillPurchaseCost: quickAddItem.unit_cost } : {})}
        {...(quickAddItem?.uom ? { prefillUom: quickAddItem.uom } : {})}
        managerMode
        context="purchase"
        onAdded={(product) => {
          if (quickAddIndex !== null)
            setItems((current) =>
              current.map((row, index) =>
                index === quickAddIndex
                  ? {
                      ...row,
                      product_id: product.id,
                      name: product.name,
                      unit_cost: row.unit_cost || product.purchase_cost,
                      retail_price: product.sale_price,
                      uom: product.uom_sale,
                      ...(product.sku ? { sku: product.sku } : {}),
                    }
                  : row,
              ),
            );
          setQuickAddIndex(null);
          void queryClient.invalidateQueries({ queryKey: ["products"] });
        }}
      />
      {!canManage(profile) ? (
        <main className="m-auto max-w-lg rounded-xl border bg-card p-6 text-center">
          <h1 className="font-semibold">Manager access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Supplier invoices, OCR review and warehouse receiving are limited to managers.
          </p>
        </main>
      ) : (
        <main className="mx-auto grid min-h-0 w-full max-w-[1500px] flex-1 gap-4 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_340px] sm:p-5">
          <section className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Central warehouse receiving</p>
              <h1 className="text-2xl font-bold">Purchases</h1>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Warehouse className="h-5 w-5" /> Supplier invoice
                </CardTitle>
                <CardDescription>
                  PDF/image processing runs in this browser. The file is never sent to an OCR
                  provider.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Field label="Supplier">
                    <Input
                      value={supplier}
                      onChange={(event) => setSupplier(event.target.value)}
                      placeholder="Supplier name"
                    />
                  </Field>
                  <Field label="Supplier invoice #">
                    <Input
                      value={supplierInvoice}
                      onChange={(event) => setSupplierInvoice(event.target.value)}
                      placeholder="Required for duplicate check"
                    />
                  </Field>
                  <Field label="Invoice date">
                    <Input
                      type="date"
                      value={invoiceDate}
                      onChange={(event) => setInvoiceDate(event.target.value)}
                    />
                  </Field>
                  <Field label="Receive into">
                    <SearchableSelect
                      value={warehouseId}
                      onValueChange={setWarehouseId}
                      placeholder="Choose warehouse"
                      options={warehouses.map((warehouse) => ({
                        value: warehouse.id,
                        label: warehouse.name,
                        keywords: [warehouse.code],
                      }))}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-3">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                    <FileUp className="h-4 w-4" /> Add PDF / photo
                    <input
                      hidden
                      type="file"
                      accept="application/pdf,image/*"
                      disabled={working}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void processInvoice(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                    {attachmentName || "Or enter invoice details manually"}
                  </span>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <FileSpreadsheet className="h-4 w-4" /> Add Excel invoice
                    <input
                      hidden
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      disabled={working}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void processWorkbook(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {working && (
                    <Badge variant="secondary">
                      <ScanSearch className="mr-1 h-3 w-3" />
                      {progress || "Working…"}
                    </Badge>
                  )}
                </div>
                {!working && progress && (
                  <p className="text-xs text-muted-foreground">{progress}</p>
                )}
                {ocrText && (
                  <Field label="Local OCR text · review and correct">
                    <Textarea
                      value={ocrText}
                      onChange={(event) => setOcrText(event.target.value)}
                      className="min-h-24 font-mono text-xs"
                    />
                  </Field>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">Items to receive</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setItems((current) => [
                          ...current,
                          { id: newId(), product_id: "", quantity: 1, unit_cost: 0 },
                        ])
                      }
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add item
                    </Button>
                  </div>
                  {!items.length && (
                    <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                      OCR is a draft. Add or match catalog items and check quantities/costs before
                      review.
                    </p>
                  )}
                  {items.map((item, index) => (
                    <div
                      key={`${receiptId}:${index}`}
                      className="grid gap-2 rounded-xl border p-2 sm:grid-cols-[minmax(0,1fr)_100px_130px_auto]"
                    >
                      <div className="min-w-0 space-y-1">
                        {item.name && (
                          <p className="mb-1 truncate text-[10px] text-muted-foreground">
                            {item.sku ? `${item.sku} · ` : ""}
                            {item.name}
                            {item.retail_price ? ` · Sell ${inr(item.retail_price)}` : ""}
                          </p>
                        )}
                        <SearchableSelect
                          value={item.product_id || "unmatched"}
                          onValueChange={(productId) =>
                            setItems((current) =>
                              current.map((row, rowIndex) => {
                                if (rowIndex !== index) return row;
                                const matchedProduct = products.find(
                                  (product) => product.id === productId,
                                );
                                const name = matchedProduct?.name;
                                return {
                                  ...row,
                                  product_id: productId === "unmatched" ? "" : productId,
                                  ...(matchedProduct?.sku ? { sku: matchedProduct.sku } : {}),
                                  ...(matchedProduct
                                    ? {
                                        retail_price: matchedProduct.sale_price,
                                        uom: matchedProduct.uom_sale,
                                        ...(name ? { name } : {}),
                                      }
                                    : {}),
                                };
                              }),
                            )
                          }
                          placeholder="Match catalog product"
                          searchPlaceholder="Search SKU, English/Hindi name…"
                          options={[
                            { value: "unmatched", label: "Choose a product…" },
                            ...products.map((product) => ({
                              value: product.id,
                              label: `${product.name}${product.name_hi ? ` · ${product.name_hi}` : ""} · ${product.sku ?? product.barcode ?? "No SKU"}`,
                              keywords: [
                                product.name_hi ?? "",
                                ...(product.search_aliases ?? []),
                                product.sku ?? "",
                                product.barcode ?? "",
                              ],
                            })),
                          ]}
                        />
                        {!item.product_id && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7"
                            disabled={!warehouseId || working}
                            onClick={() => setQuickAddIndex(index)}
                          >
                            <Plus className="mr-1 h-3 w-3" />
                            Add new SKU
                          </Button>
                        )}
                      </div>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        aria-label="Quantity"
                        value={item.quantity}
                        onChange={(event) =>
                          setItems((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, quantity: Number(event.target.value) || 0 }
                                : row,
                            ),
                          )
                        }
                      />
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label="Unit cost"
                        value={item.unit_cost}
                        onChange={(event) =>
                          setItems((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, unit_cost: Number(event.target.value) || 0 }
                                : row,
                            ),
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setItems((current) => current.filter((_, rowIndex) => rowIndex !== index))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <span className="font-semibold">Invoice items total: {inr(total)}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => void saveDraft()} disabled={working}>
                      Save draft
                    </Button>
                    {status === "DRAFT" && (
                      <Button
                        onClick={() => void approve()}
                        disabled={
                          working || items.length === 0 || items.some((item) => !item.product_id)
                        }
                      >
                        Manager review & approve
                      </Button>
                    )}
                    {status === "REVIEWED" && (
                      <Button onClick={() => void receive()} disabled={working}>
                        <ShieldCheck className="mr-2 h-4 w-4" /> Receive warehouse stock
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
          <aside className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Purchase queue</h2>
              <Button size="sm" variant="ghost" onClick={startNew}>
                New
              </Button>
            </div>
            <DataTable<LocalPurchaseReceipt>
              rows={visibleReceipts}
              getRowId={(receipt) => receipt.id}
              resetKey={warehouses.map((warehouse) => warehouse.id).join(":")}
              searchPlaceholder="Search supplier, invoice or status…"
              emptyMessage={
                receipts.length
                  ? "No purchase receipts are assigned to these warehouses."
                  : "No purchase receipts found on this device."
              }
              tableHeightClass="max-h-[55dvh]"
              columns={[
                {
                  id: "supplier",
                  header: "Supplier",
                  accessor: (receipt) => receipt.supplier_name || "Supplier",
                },
                {
                  id: "invoice",
                  header: "Invoice",
                  accessor: (receipt) => receipt.supplier_invoice_number,
                },
                {
                  id: "date",
                  header: "Date",
                  accessor: (receipt) => receipt.invoice_date,
                },
                {
                  id: "items",
                  header: "Lines",
                  accessor: (receipt) => receipt.items.length,
                },
                {
                  id: "status",
                  header: "Status",
                  accessor: (receipt) => receipt.status,
                  cell: (receipt) => (
                    <Badge
                      variant={
                        receipt.status === "RECEIVED"
                          ? "outline"
                          : receipt.status === "REVIEWED"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {receipt.status}
                    </Badge>
                  ),
                },
                {
                  id: "open",
                  header: "",
                  accessor: () => "Open",
                  sortable: false,
                  cell: (receipt) => (
                    <Button
                      size="sm"
                      variant={receipt.id === receiptId ? "default" : "outline"}
                      onClick={() => openReceipt(receipt)}
                    >
                      Open
                    </Button>
                  ),
                },
              ]}
            />
            {warehouses.length === 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
                <p>No active location is marked as a warehouse yet.</p>
                {profile?.role === "ADMIN" ? (
                  <Button asChild size="sm" variant="outline" className="mt-2">
                    <Link to="/admin">Add or activate a warehouse</Link>
                  </Button>
                ) : (
                  <p className="mt-1">Ask an Admin to add or activate a warehouse location.</p>
                )}
              </div>
            )}
          </aside>
        </main>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
