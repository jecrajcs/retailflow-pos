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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CATEGORIES,
  UOMS,
  categoryIcon,
  generateSku,
  inr,
  quickAddProduct,
  type Product,
} from "@/lib/pos";

export function QuickAddModal({
  open,
  onOpenChange,
  locationId,
  prefill,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  /** Text typed/scanned in the billing search box that found no product. */
  prefill?: string;
  onAdded: (product: Product) => void;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [variant, setVariant] = useState("");
  const [category, setCategory] = useState("");
  const [rack, setRack] = useState("");
  const [uom, setUom] = useState("Pcs");
  const [salePrice, setSalePrice] = useState("");
  const [minSalePrice, setMinSalePrice] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [mrp, setMrp] = useState("");
  const [openingQty, setOpeningQty] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      // Smart prefill: digits look like a barcode, anything else is a name.
      const text = (prefill ?? "").trim();
      const isNumeric = /^\d{4,}$/.test(text);
      setName(isNumeric ? "" : text);
      setBarcode(isNumeric ? text : "");
      setVariant("");
      setCategory("");
      setRack("");
      setUom("Pcs");
      setSalePrice("");
      setMinSalePrice("");
      setPurchaseCost("");
      setMrp("");
      setOpeningQty("");
      setBusy(false);
      if (open) generateSku().then(setSku).catch(() => setSku(""));
    }
  }, [open, prefill]);

  const minPriceNum = Number(minSalePrice) || 0;
  const saleNum = Number(salePrice) || 0;

  async function handleSave() {
    if (!name.trim() || !salePrice || busy) return;
    setBusy(true);
    try {
      const product = await quickAddProduct({
        name: name.trim(),
        sku,
        barcode: barcode.trim() || null,
        variant: variant.trim() || null,
        category: category.trim() || null,
        rackLocation: rack.trim() || null,
        salePrice: saleNum,
        minSalePrice: Math.min(minPriceNum, saleNum),
        purchaseCost: Number(purchaseCost) || 0,
        mrp: Number(mrp) || saleNum,
        uom,
        locationId,
        openingQty: Number(openingQty) || 0,
      });
      onAdded(product);
      onOpenChange(false);
      toast.success(`${product.name} added — ${sku}`, {
        description: `Rack ${product.rack_location ?? "—"} · ${inr(saleNum)}/${uom} · Catalog details flagged PENDING for the Manager queue.`,
      });
    } catch (e) {
      toast.error("Could not save item", { description: String(e) });
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
            SKU khud generate ho gaya hai — sirf naam & rate bharein aur{" "}
            <Kbd>Enter</Kbd> dabaein. Baaki details baad mein Manager ke Catalog Queue se complete
            honge.
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

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="qa-variant">Variant</Label>
              <Input
                id="qa-variant"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                placeholder="50g, 100ml…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-category">Category</Label>
              <Input
                id="qa-category"
                list="qa-category-list"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Snacks, FMCG…"
              />
              <datalist id="qa-category-list">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryIcon(c)} {c}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-rack">Rack location</Label>
              <Input
                id="qa-rack"
                value={rack}
                onChange={(e) => setRack(e.target.value)}
                placeholder="Rack S1"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label>UOM</Label>
              <Select value={uom} onValueChange={setUom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UOMS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-price">Sell price *</Label>
              <Input
                id="qa-price"
                type="number"
                value={salePrice}
                onChange={(e) => {
                  setSalePrice(e.target.value);
                  const v = Number(e.target.value) || 0;
                  if (minPriceNum > v) setMinSalePrice(String(v));
                }}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-min-price">Min allowed rate</Label>
              <Input
                id="qa-min-price"
                type="number"
                value={minSalePrice}
                onChange={(e) => setMinSalePrice(e.target.value)}
                placeholder="Floor price"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-mrp">MRP</Label>
              <Input
                id="qa-mrp"
                type="number"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="qa-cost">Cost price</Label>
              <Input
                id="qa-cost"
                type="number"
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qa-qty">Opening qty at this store</Label>
              <Input
                id="qa-qty"
                type="number"
                value={openingQty}
                onChange={(e) => setOpeningQty(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <Button className="w-full" onClick={handleSave} disabled={!name.trim() || !salePrice || busy}>
            Save & add to bill{salePrice ? ` — ${inr(saleNum)}/${uom}` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: string }) {
  return <span className="rounded border px-1 py-0.5 font-mono text-[10px]">{children}</span>;
}
