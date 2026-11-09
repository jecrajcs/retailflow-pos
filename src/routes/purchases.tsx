import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp, Plus, ScanSearch, ShieldCheck, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { AppNav } from "@/components/pos/app-nav";
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

function itemRowsFromOcr(text: string, products: Product[]) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 4)
    .flatMap((line) => {
      const numbers = [...line.matchAll(/(?:₹|rs\.?\s*)?([0-9][0-9,]*(?:\.\d{1,3})?)/gi)];
      if (numbers.length < 2) return [];
      const quantityToken = numbers[numbers.length - 2];
      const costToken = numbers[numbers.length - 1];
      const quantity = Number(quantityToken?.[1]?.replace(/,/g, ""));
      const unitCost = Number(costToken?.[1]?.replace(/,/g, ""));
      const cutAt = quantityToken?.index ?? -1;
      const name =
        cutAt > 0
          ? line
              .slice(0, cutAt)
              .replace(/[|:;#]+/g, " ")
              .trim()
          : "";
      if (
        !name ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitCost) ||
        unitCost <= 0
      )
        return [];
      const match = products.find((product) => matchesProductSearch(product, name));
      return [{ product_id: match?.id ?? "", name, quantity, unit_cost: unitCost }];
    })
    .slice(0, 100);
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
  const [receiptId, setReceiptId] = useState(newId);
  const [supplier, setSupplier] = useState("");
  const [supplierInvoice, setSupplierInvoice] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [attachment, setAttachment] = useState<Blob | null>(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [items, setItems] = useState<LocalPurchaseReceipt["items"]>([]);
  const [status, setStatus] = useState<LocalPurchaseReceipt["status"]>("DRAFT");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0),
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
      const supplierCandidate = output
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .find(
          (line) =>
            line.length >= 3 &&
            line.length <= 80 &&
            !/(invoice|bill|gstin|gst no|phone|mobile|date|tax invoice)/i.test(line),
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
        items,
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

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AppNav active="/purchases" />
      {!canManage(profile) ? (
        <main className="m-auto max-w-lg rounded-xl border bg-card p-6 text-center">
          <h1 className="font-semibold">Manager access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Supplier invoices, OCR review and warehouse receiving are limited to managers.
          </p>
        </main>
      ) : (
        <main className="mx-auto grid w-full max-w-[1500px] flex-1 gap-4 p-3 lg:grid-cols-[minmax(0,1fr)_340px] sm:p-5">
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
                          { product_id: "", quantity: 1, unit_cost: 0 },
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
                      <div className="min-w-0">
                        {item.name && (
                          <p className="mb-1 truncate text-[10px] text-muted-foreground">
                            OCR: {item.name}
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
                                  ...(name ? { name } : {}),
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
            {receipts
              .slice()
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((receipt) => (
                <button
                  key={receipt.id}
                  onClick={() => openReceipt(receipt)}
                  className={`w-full rounded-xl border p-3 text-left hover:bg-accent/40 ${receipt.id === receiptId ? "border-primary" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <b className="truncate">{receipt.supplier_name || "Supplier"}</b>
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
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {receipt.supplier_invoice_number} · {receipt.invoice_date}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {receipt.items.length} item rows · {receipt.attachment_name ?? "manual entry"}
                  </span>
                </button>
              ))}
            {!receipts.length && (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                Drafts remain on this device until sync is available.
              </p>
            )}
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
