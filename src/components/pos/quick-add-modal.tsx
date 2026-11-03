import { useState } from "react";
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
import { quickAddProduct, type Product } from "@/lib/pos";

const UOMS = ["UNIT", "KG", "LITRE", "PKT", "BAG", "PIECE"];

export function QuickAddModal({
  open,
  onOpenChange,
  locationId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  onAdded: (product: Product) => void;
}) {
  const [name, setName] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [uom, setUom] = useState("UNIT");
  const [openingQty, setOpeningQty] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!name.trim() || !salePrice || busy) return;
    setBusy(true);
    try {
      const product = await quickAddProduct({
        name: name.trim(),
        salePrice: Number(salePrice),
        mrp: Number(mrp) || Number(salePrice),
        purchaseCost: Number(purchaseCost) || 0,
        uom,
        locationId,
        openingQty: Number(openingQty) || 0,
      });
      onAdded(product);
      onOpenChange(false);
      setName("");
      setSalePrice("");
      setMrp("");
      setPurchaseCost("");
      setOpeningQty("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quick add item</DialogTitle>
          <DialogDescription>
            Name and price are enough — rest can be filled later from the Catalog Queue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="qa-name">Item name *</Label>
            <Input
              autoFocus
              id="qa-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fresh Paneer"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="qa-price">Sale price *</Label>
              <Input
                id="qa-price"
                type="number"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0"
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
            <div className="space-y-1">
              <Label htmlFor="qa-cost">Cost</Label>
              <Input
                id="qa-cost"
                type="number"
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
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
            Save & add to bill
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
