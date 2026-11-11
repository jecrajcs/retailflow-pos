import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Barcode, Check, CircleX, Plus, Printer, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { AppNav } from "@/components/pos/app-nav";
import { BarcodePreview } from "@/components/pos/barcode-preview";
import { DataTable, type DataTableColumn } from "@/components/pos/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { canAccessLocation, saveActiveLocation, useAccess } from "@/lib/access";
import { refreshLocalReplica } from "@/lib/offline-sync";
import { barcodeForSku, useBarcodeCandidates, useLocationProducts, useLocations, useProducts, type BarcodeCandidate, type Product } from "@/lib/pos";
import { retailApi, userFacingError } from "@/lib/retail-api";

export const Route = createFileRoute("/barcodes")({ component: BarcodeReviewPage });

type CandidateRow = BarcodeCandidate & { productName: string; sku: string; locationName: string };

function BarcodeReviewPage() {
  const { profile } = useAccess();
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const { data: assignments = [] } = useLocationProducts();
  const { data: candidates = [] } = useBarcodeCandidates();
  const allowedLocations = locations.filter((location) => canAccessLocation(profile, location.id));
  const [locationId, setLocationId] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("pos-location-id") ?? "");
  const location = allowedLocations.find((item) => item.id === locationId) ?? allowedLocations[0];
  const [productId, setProductId] = useState("");
  const [barcodeType, setBarcodeType] = useState<"MANUFACTURER" | "INTERNAL">("MANUFACTURER");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejecting, setRejecting] = useState<CandidateRow | null>(null);
  const [reason, setReason] = useState("");

  const assignedProductIds = useMemo(() => new Set(assignments.filter((row) => row.location_id === location?.id).map((row) => row.product_id)), [assignments, location?.id]);
  const eligibleProducts = products.filter((product) => assignedProductIds.has(product.id));
  const selectedProduct = eligibleProducts.find((product) => product.id === productId);
  const pendingCandidates: CandidateRow[] = candidates
    .filter((candidate) => candidate.status === "PENDING" && candidate.location_id === location?.id)
    .map((candidate) => {
      const product = products.find((item) => item.id === candidate.product_id);
      return {
        ...candidate,
        productName: product?.name ?? "Unknown SKU",
        sku: product?.sku ?? "—",
        locationName: locations.find((item) => item.id === candidate.location_id)?.name ?? "—",
      };
    });

  async function reviewCandidate(candidate: CandidateRow, status: "VERIFIED" | "REJECTED", reviewReason = "") {
    setSaving(true);
    try {
      await retailApi("/api/barcode-candidate", {
        method: "POST",
        json: {
          candidate_id: candidate.id,
          status,
          barcode_type: status === "VERIFIED" ? "MANUFACTURER" : "",
          reason: reviewReason,
        },
      });
      await refreshLocalReplica();
      toast.success(status === "VERIFIED" ? "Manufacturer barcode verified" : "Barcode candidate rejected");
      setRejecting(null);
      setReason("");
    } catch (error) {
      toast.error("Barcode review failed", { description: userFacingError(error, "Could not save this barcode review.") });
    } finally {
      setSaving(false);
    }
  }

  async function assignBarcode() {
    if (!location || !selectedProduct || !code.trim()) return;
    setSaving(true);
    try {
      await retailApi("/api/barcode-candidate", {
        method: "POST",
        json: {
          action: "assign",
          product_id: selectedProduct.id,
          location_id: location.id,
          code: code.trim(),
          barcode_type: barcodeType,
        },
      });
      await refreshLocalReplica();
      toast.success(barcodeType === "INTERNAL" ? "Internal barcode generated and assigned" : "Barcode assigned to SKU");
      setProductId("");
      setCode("");
    } catch (error) {
      toast.error("Could not assign barcode", { description: userFacingError(error, "Check the SKU, location and barcode.") });
    } finally {
      setSaving(false);
    }
  }

  const columns: DataTableColumn<CandidateRow>[] = [
    { id: "product", header: "Product / SKU", accessor: (row) => `${row.productName} ${row.sku}`, cell: (row) => <div className="min-w-36"><div className="font-medium">{row.productName}</div><div className="font-mono text-xs text-muted-foreground">{row.sku}</div></div> },
    { id: "code", header: "Scanned code", accessor: (row) => row.code, cell: (row) => <span className="font-mono">{row.code}</span> },
    { id: "location", header: "Location", accessor: (row) => row.locationName },
    { id: "captured", header: "Captured", accessor: (row) => row.created_at, cell: (row) => new Date(row.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
    { id: "actions", header: "Review", accessor: () => "", sortable: false, cell: (row) => <div className="flex gap-1"><Button size="sm" onClick={() => void reviewCandidate(row, "VERIFIED")} disabled={saving}><Check className="mr-1 h-3.5 w-3.5" />Verify</Button><Button size="sm" variant="outline" onClick={() => { setRejecting(row); setReason(""); }}><CircleX className="mr-1 h-3.5 w-3.5" />Reject</Button></div> },
  ];

  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/barcodes" />
      <main className="mx-auto min-h-0 w-full max-w-[1500px] flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><ScanBarcode className="h-4 w-4" /> Barcode operations</p><h1 className="mt-1 text-2xl font-bold">Barcode review and labels</h1><p className="mt-1 text-sm text-muted-foreground">Verify manufacturer codes or print clearly marked RetailFlow internal labels.</p></div>
          <SearchableSelect className="w-64" value={location?.id ?? ""} onValueChange={(id) => { setLocationId(id); saveActiveLocation(id); }} placeholder="Select location" options={allowedLocations.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} />
        </header>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Barcode className="h-5 w-5" /> Assign a product barcode</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_1fr_auto] md:items-end">
            <div className="space-y-1"><Label>SKU at {location?.name ?? "location"}</Label><SearchableSelect value={productId} onValueChange={(value) => { setProductId(value); const product = eligibleProducts.find((item) => item.id === value); if (barcodeType === "INTERNAL" && product?.sku) setCode(barcodeForSku(product.sku)); }} placeholder="Search product or SKU…" searchPlaceholder="Search name, SKU or barcode…" options={eligibleProducts.map((product) => ({ value: product.id, label: `${product.name} · ${product.sku ?? "No SKU"}`, keywords: [product.barcode ?? "", product.variant ?? ""] }))} /></div>
            <div className="space-y-1"><Label>Barcode type</Label><SearchableSelect value={barcodeType} onValueChange={(value) => { const next = value as typeof barcodeType; setBarcodeType(next); if (next === "INTERNAL" && selectedProduct?.sku) setCode(barcodeForSku(selectedProduct.sku)); }} options={[{ value: "MANUFACTURER", label: "Manufacturer barcode" }, { value: "INTERNAL", label: "RetailFlow internal label" }]} /></div>
            <div className="space-y-1"><Label htmlFor="assigned-barcode">{barcodeType === "INTERNAL" ? "Generated internal code" : "Barcode value"}</Label><Input id="assigned-barcode" value={code} readOnly={barcodeType === "INTERNAL"} onChange={(event) => setCode(event.target.value)} placeholder={barcodeType === "INTERNAL" ? "Choose a SKU to generate" : "Scan or enter manufacturer barcode"} /></div>
            <Button onClick={() => void assignBarcode()} disabled={saving || !selectedProduct || !code.trim()}><Plus className="mr-1.5 h-4 w-4" /> Assign</Button>
            {barcodeType === "INTERNAL" && code && <div className="md:col-span-4"><div className="mb-1 text-xs text-muted-foreground">Internal barcode · not a GS1-issued retail GTIN</div><BarcodePreview value={code} caption={`${selectedProduct?.name ?? "Product"} · RetailFlow internal`} /></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Scanned codes awaiting verification <Badge variant="secondary" className="ml-2">{pendingCandidates.length}</Badge></CardTitle></CardHeader>
          <CardContent><DataTable rows={pendingCandidates} columns={columns} getRowId={(row) => row.id} searchPlaceholder="Search product, SKU or scanned code…" emptyMessage="No scanned barcodes are waiting for review at this location." tableHeightClass="max-h-[42vh]" /></CardContent>
        </Card>
      </main>

      <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject scanned barcode</DialogTitle><DialogDescription>{rejecting?.productName} · {rejecting?.code}. Enter a short reason for the review history.</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label htmlFor="barcode-reject-reason">Reason</Label><Input id="barcode-reject-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Code does not match packaging" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="destructive" disabled={saving || reason.trim().length < 5} onClick={() => rejecting && void reviewCandidate(rejecting, "REJECTED", reason.trim())}>Reject barcode</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
