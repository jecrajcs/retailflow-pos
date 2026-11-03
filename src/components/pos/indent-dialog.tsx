import { useState } from "react";
import { Truck } from "lucide-react";
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
  requestIndent,
  inr,
  useInventory,
  type Location,
  type Product,
} from "@/lib/pos";

export function IndentDialog({
  open,
  onOpenChange,
  product,
  locationId,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  locationId: string;
  locations: Location[];
}) {
  const { data: inventory = [] } = useInventory();
  const warehouses = locations.filter((l) => l.type === "WAREHOUSE");
  const [qty, setQty] = useState("");
  const [fromId, setFromId] = useState("");
  const [busy, setBusy] = useState(false);

  if (!product) return null;
  const from = fromId || warehouses[0]?.id || locations[0]?.id;

  const stockAt = (locId: string) =>
    inventory.find((i) => i.product_id === product.id && i.location_id === locId)?.quantity_on_hand ?? 0;

  const suggested = Math.max(
    Math.ceil(product.min_stock * 2 - stockAt(locationId)),
    5,
  );

  async function submit() {
    if (!from || busy) return;
    setBusy(true);
    try {
      await requestIndent({
        fromLocationId: from,
        toLocationId: locationId,
        productId: product.id,
        quantity: Number(qty) || suggested,
        notes: null,
      });
      toast.success(`Indent raised for ${product.name}`, {
        description: "Manager will approve and dispatch the stock transfer.",
      });
      onOpenChange(false);
      setQty("");
    } catch (e) {
      toast.error("Could not raise indent", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4" /> Indent stock — {product.name}
          </DialogTitle>
          <DialogDescription>
            Raises a stock transfer request to the warehouse.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border bg-muted/40 p-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Stock across locations</div>
            <div className="flex flex-wrap gap-1.5">
              {locations.map((l) => (
                <span
                  key={l.id}
                  className="rounded border bg-background px-1.5 py-0.5 text-xs"
                >
                  {l.code}: <b>{stockAt(l.id)}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>From</Label>
              <Select value={from} onValueChange={setFromId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.concat(warehouses.length ? [] : locations).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ind-qty">Quantity</Label>
              <Input
                id="ind-qty"
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={String(suggested)}
              />
            </div>
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            Raise indent of {qty ? qty : suggested} {product.uom_stock} ({inr((Number(qty) || suggested) * product.purchase_cost)} cost)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
