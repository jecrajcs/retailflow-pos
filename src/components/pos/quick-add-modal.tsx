import { useEffect, useState } from "react";
import { Camera, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { BarcodePreview } from "@/components/pos/barcode-preview";
import { CameraScannerPanel } from "@/components/pos/camera-scanner";
import {
  UOMS,
  barcodeForSku,
  generateSku,
  inr,
  quickAddProduct,
  resubmitRejectedProduct,
  type Product,
} from "@/lib/pos";
import { userFacingError } from "@/lib/retail-api";

export function QuickAddModal({
  open,
  onOpenChange,
  locationId,
  prefill,
  prefillSku,
  prefillVariant,
  prefillRetailPrice,
  prefillPurchaseCost,
  prefillUom,
  correctionProduct,
  managerMode = false,
  context = "pos",
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  /** Text typed/scanned in the billing search box that found no product. */
  prefill?: string;
  prefillSku?: string;
  prefillVariant?: string;
  prefillRetailPrice?: number;
  prefillPurchaseCost?: number;
  prefillUom?: string;
  correctionProduct?: Product | null;
  managerMode?: boolean;
  context?: "pos" | "purchase";
  onAdded: (product: Product) => void;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [variant, setVariant] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [internalBarcode, setInternalBarcode] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [uom, setUom] = useState("Pcs");
  const [salePrice, setSalePrice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCameraActive(false);
      if (correctionProduct) {
        setSku(correctionProduct.sku ?? "");
        setName(correctionProduct.name);
        setBarcode(correctionProduct.barcode ?? "");
        setVariant(correctionProduct.variant ?? "");
        setCategory(correctionProduct.category ?? "");
        setSubcategory(correctionProduct.subcategory ?? "");
        setUom(correctionProduct.uom_sale);
        setSalePrice(String(correctionProduct.sale_price));
        setInternalBarcode(correctionProduct.barcode_type === "INTERNAL");
        setBusy(false);
        return;
      }
      // Smart prefill: digits look like a barcode, anything else is a name.
      const text = (prefill ?? "").trim();
      const isNumeric = /^\d{4,}$/.test(text);
      setName(isNumeric ? "" : text);
      setBarcode(isNumeric ? text : "");
      setInternalBarcode(false);
      if (prefillSku?.trim()) setSku(prefillSku.trim());
      setVariant(prefillVariant?.trim() || "");
      setUom(prefillUom?.trim() || "Pcs");
      setSalePrice(prefillRetailPrice && prefillRetailPrice > 0 ? String(prefillRetailPrice) : "");
      setBusy(false);
      if (open && !prefillSku?.trim())
        generateSku()
          .then((generatedSku) => {
            setSku(generatedSku);
          })
          .catch(() => setSku(""));
    }
  }, [
    open,
    prefill,
    prefillSku,
    prefillVariant,
    prefillRetailPrice,
    prefillPurchaseCost,
    prefillUom,
    correctionProduct,
  ]);

  const saleNum = Number(salePrice) || 0;

  async function handleSave() {
    if (!sku || !name.trim() || !(saleNum > 0) || busy) return;
    setBusy(true);
    try {
      const product = correctionProduct
        ? await resubmitRejectedProduct({
            productId: correctionProduct.id,
            locationId,
            name,
            sku,
            variant: variant || null,
            category: category || null,
            subcategory: subcategory || null,
            salePrice: saleNum,
            uom,
          })
        : await quickAddProduct({
            name: name.trim(),
            sku,
            barcode: barcode.trim() || null,
            barcodeType: internalBarcode ? "INTERNAL" : managerMode ? "MANUFACTURER" : "UNVERIFIED",
            variant: variant.trim() || null,
            category: category.trim() || null,
            subcategory: subcategory.trim() || null,
            rackLocation: null,
            salePrice: saleNum,
            minSalePrice: 0,
            priceTiers: [],
            purchaseCost: Number(prefillPurchaseCost) || 0,
            mrp: 0,
            uom,
            locationId,
            openingQty: 0,
            cashierQuickAdd: !managerMode,
          });
      onAdded(product);
      onOpenChange(false);
      toast.success(
        correctionProduct ? `${product.name} corrected` : `${product.name} added — ${sku}`,
        {
          description: correctionProduct
            ? "The corrected SKU has been resubmitted for Manager review."
            : `${inr(saleNum)}/${uom} · Catalog details are ready for Manager review.`,
        },
      );
    } catch (e) {
      toast.error("Could not save item", {
        description: userFacingError(e, "Check the item details and try again."),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-warning" />{" "}
            {correctionProduct ? "Correct rejected SKU" : "Quick add item"}
          </DialogTitle>
          <DialogDescription>
            {correctionProduct
              ? correctionProduct.review_reason ||
                "Correct the product details and resubmit for review."
              : context === "purchase"
                ? "Add the missing SKU with its item name, retail price, and sale unit. The invoice quantity will be added when the receipt is received."
                : "Add the selling details. Stock is assigned to this store and can be counted by a Manager later."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[auto_1fr_1fr] gap-2">
            <div className="space-y-1">
              <Label htmlFor="qa-sku">SKU (auto)</Label>
              <Input
                id="qa-sku"
                readOnly={!correctionProduct}
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                className="w-40 bg-muted font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-name">Item name *</Label>
              <Input
                autoFocus={!barcode}
                id="qa-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dove Shampoo"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-barcode">
                {managerMode ? "Barcode" : "Scanned barcode (pending review)"}
              </Label>
              <Input
                autoFocus={!!barcode && managerMode}
                id="qa-barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder={
                  managerMode ? "Scan or enter manufacturer barcode" : "Scan or enter barcode"
                }
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
          </div>
          {!correctionProduct && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCameraActive((active) => !active)}
              >
                <Camera className="mr-2 h-4 w-4" />
                {cameraActive ? "Close barcode camera" : "Scan barcode with camera"}
              </Button>
              {cameraActive && (
                <CameraScannerPanel
                  active={open && cameraActive}
                  compact
                  onScan={(value) => {
                    setBarcode(value);
                    setCameraActive(false);
                    toast.success("Barcode captured", { description: value });
                  }}
                />
              )}
            </div>
          )}

          <div className="grid gap-2">
            <div className="space-y-1">
              <Label htmlFor="qa-variant">Variant</Label>
              <Input
                id="qa-variant"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                placeholder="Size, shade, pack"
              />
            </div>
          </div>

          {managerMode && sku && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Internal Code 128 label</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setBarcode(barcodeForSku(sku));
                    setInternalBarcode(true);
                  }}
                >
                  Generate internal label
                </Button>
              </div>
              {internalBarcode && (
                <BarcodePreview value={barcode} caption={`${name || sku} · Internal label`} />
              )}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>UOM</Label>
              <SearchableSelect
                value={uom}
                onValueChange={setUom}
                options={UOMS.map((value) => ({ value, label: value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-price">Retail sell price *</Label>
              <Input
                id="qa-price"
                type="number"
                value={salePrice}
                onChange={(e) => {
                  setSalePrice(e.target.value);
                }}
                placeholder="0"
              />
            </div>
          </div>
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={!sku || !name.trim() || !(saleNum > 0) || busy}
          >
            {correctionProduct
              ? "Resubmit corrected SKU"
              : managerMode
                ? "Save item"
                : "Add item to bill"}
            {salePrice ? ` — ${inr(saleNum)}/${uom}` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: string }) {
  return <span className="rounded border px-1 py-0.5 font-mono text-[10px]">{children}</span>;
}
