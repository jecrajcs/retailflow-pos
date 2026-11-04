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
import { CATEGORIES, UOMS, quickAddProduct, type Product } from "@/lib/pos";

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
      setName(prefill?.trim() ?? "");
      setBarcode(prefill?.trim() ?? "");
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
      toast.success(`${product.name} added`, { description: `Rack ${product.rack_location ?? "—"} · ${inrFmt(saleNum)}/${uom}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-primary" /> Quick add item
          </DialogTitle>
          <DialogDescription>
            Name & price are enough — press <Kbd>Enter</Kbd> to save & add to bill. Everything else can be
            completed later from the Catalog Queue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div className="space-y-1">
              <Label htmlFor="qa-name">Item name *</Label>
              <Input
                autoFocus
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
                  <option key={c} value={c} />
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
            Save & add to bill{salePrice ? ` — ${inrFmt(saleNum)}/${uom}` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function inrFmt(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Kbd({ children }: { children: string }) {
  return <span className="rounded border px-1 py-0.5 font-mono text-[10px]">{children}</span>;
}
