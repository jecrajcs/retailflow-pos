import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
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
import { UOMS, barcodeForSku, generateSku, inr, quickAddProduct, type Product } from "@/lib/pos";
import { userFacingError } from "@/lib/retail-api";

export function QuickAddModal({
  open,
  onOpenChange,
  locationId,
  prefill,
  prefillSku,
  prefillRetailPrice,
  prefillPurchaseCost,
  prefillUom,
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
  prefillRetailPrice?: number;
  prefillPurchaseCost?: number;
  prefillUom?: string;
  managerMode?: boolean;
  context?: "pos" | "purchase";
  onAdded: (product: Product) => void;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [uom, setUom] = useState("Pcs");
  const [salePrice, setSalePrice] = useState("");
  const [openingQty, setOpeningQty] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      // Smart prefill: digits look like a barcode, anything else is a name.
      const text = (prefill ?? "").trim();
      const isNumeric = /^\d{4,}$/.test(text);
      setName(isNumeric ? "" : text);
      setBarcode(isNumeric ? text : "");
      if (prefillSku?.trim()) setSku(prefillSku.trim());
      setUom(prefillUom?.trim() || "Pcs");
      setSalePrice(prefillRetailPrice && prefillRetailPrice > 0 ? String(prefillRetailPrice) : "");
      setOpeningQty("");
      setBusy(false);
      if (open && !prefillSku?.trim())
        generateSku()
          .then((generatedSku) => {
            setSku(generatedSku);
            if (!isNumeric) setBarcode(barcodeForSku(generatedSku));
          })
          .catch(() => setSku(""));
    }
  }, [open, prefill, prefillSku, prefillRetailPrice, prefillPurchaseCost, prefillUom]);

  const saleNum = Number(salePrice) || 0;

  async function handleSave() {
    if (
      !sku ||
      !name.trim() ||
      !(saleNum > 0) ||
      (context === "pos" && !(Number(openingQty) > 0)) ||
      busy
    )
      return;
    setBusy(true);
    try {
      const product = await quickAddProduct({
        name: name.trim(),
        sku,
        barcode: barcode.trim() || null,
        variant: null,
        category: null,
        rackLocation: null,
        salePrice: saleNum,
        minSalePrice: 0,
        priceTiers: [],
        purchaseCost: Number(prefillPurchaseCost) || 0,
        mrp: 0,
        uom,
        locationId,
        openingQty: context === "pos" ? Number(openingQty) || 0 : 0,
        cashierQuickAdd: !managerMode,
      });
      onAdded(product);
      onOpenChange(false);
      toast.success(`${product.name} added — ${sku}`, {
        description: `${inr(saleNum)}/${uom} · Catalog details are ready for Manager review.`,
      });
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
            <Zap className="h-4 w-4 text-warning" /> Quick add item
          </DialogTitle>
          <DialogDescription>
            {context === "purchase"
              ? "Add the missing SKU with its item name, retail price, and sale unit. The invoice quantity will be added when the receipt is received."
              : "Enter the item name, retail price, sale unit, and quantity available. Managers can complete the remaining catalog details later."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[auto_1fr_1fr] gap-2">
            <div className="space-y-1">
              <Label htmlFor="qa-sku">SKU (auto)</Label>
              <Input id="qa-sku" readOnly value={sku} className="w-40 bg-muted font-mono text-xs" />
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
              <Label htmlFor="qa-barcode">Barcode</Label>
              <Input
                autoFocus={!!barcode}
                id="qa-barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Scan or type barcode"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
          </div>

          {sku && (
            <div className="space-y-1">
              <Label>Scannable Code 128 barcode · auto-generated from SKU</Label>
              <BarcodePreview value={barcode || barcodeForSku(sku)} caption={name || sku} />
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
          {context === "pos" && (
            <div className="space-y-1">
              <Label htmlFor="qa-qty">Quantity available *</Label>
              <Input
                id="qa-qty"
                type="number"
                min="0.001"
                step="any"
                value={openingQty}
                onChange={(e) => setOpeningQty(e.target.value)}
                placeholder="0"
                required
              />
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleSave}
            disabled={
              !sku ||
              !name.trim() ||
              !(saleNum > 0) ||
              (context === "pos" && !(Number(openingQty) > 0)) ||
              busy
            }
          >
            {managerMode ? "Save item" : "Add item to bill"}
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
