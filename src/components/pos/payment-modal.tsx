import { useEffect, useMemo, useState } from "react";
import { Banknote, CreditCard, QrCode, Trash2, UserRound, Wallet } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createPosInvoice,
  inr,
  type CartLine,
  type Customer,
  type InvoiceResult,
  type PaymentMode,
} from "@/lib/pos";

const MODES: Array<{ value: PaymentMode; label: string; icon: typeof Banknote }> = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "UPI", label: "UPI", icon: QrCode },
  { value: "CARD", label: "Card", icon: CreditCard },
  { value: "CREDIT", label: "Customer Credit", icon: Wallet },
];

export function PaymentModal({
  open,
  onOpenChange,
  lines,
  subtotal,
  discount,
  onDiscountChange,
  customer,
  onPickCustomer,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  onDiscountChange: (value: number) => void;
  customer: Customer | null;
  onPickCustomer: () => void;
  onPaid: (result: InvoiceResult, payments: Array<{ mode: string; amount: number }>) => void;
}) {
  const total = Math.max(subtotal - discount, 0);
  const [splits, setSplits] = useState<Array<{ mode: PaymentMode; amount: string }>>([
    { mode: "CASH", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSplits([{ mode: "CASH", amount: String(total.toFixed(2)) }]);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const paid = useMemo(
    () => splits.reduce((s, x) => s + (Number(x.amount) || 0), 0),
    [splits],
  );
  const remaining = Math.max(total - paid, 0);

  const upiAmount = splits
    .filter((s) => s.mode === "UPI")
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  function updateSplit(index: number, patch: Partial<{ mode: PaymentMode; amount: string }>) {
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function confirm() {
    const valid = splits.filter((s) => (Number(s.amount) || 0) > 0);
    if (valid.length === 0) {
      toast.error("Enter at least one payment amount");
      return;
    }
    if (valid.some((s) => s.mode === "CREDIT") && !customer) {
      toast.error("Customer Credit needs a customer", {
        description: "Tap the customer chip to pick or add one first.",
      });
      return;
    }
    setBusy(true);
    try {
      const result = await createPosInvoice({
        locationId: "",
        customerId: customer?.id ?? null,
        discount,
        items: lines.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          uom: l.uom,
          discount: l.discount,
          total: l.quantity * l.unit_price - l.discount,
        })),
        payments: valid.map((s) => ({ amount: Number(s.amount), mode: s.mode })),
      });
      onPaid(result, valid.map((s) => ({ amount: Number(s.amount), mode: s.mode })));
      onOpenChange(false);
    } catch (e) {
      toast.error("Billing failed", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Collect payment</DialogTitle>
          <DialogDescription>
            Split across cash, UPI, card or customer credit.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border bg-muted/40 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Subtotal</div>
            <div className="text-sm font-semibold">{inr(subtotal)}</div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Discount</div>
            <Input
              type="number"
              className="mt-0.5 h-7 text-center text-sm"
              value={discount || ""}
              onChange={(e) => onDiscountChange(Number(e.target.value) || 0)}
            />
          </div>
          <div className="rounded-lg border-2 border-primary bg-primary/5 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Payable</div>
            <div className="text-base font-bold">{inr(total)}</div>
          </div>
        </div>

        <button
          onClick={onPickCustomer}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            customer ? "border-primary/40 bg-primary/5" : "border-dashed text-muted-foreground",
          )}
        >
          <UserRound className="h-4 w-4" />
          {customer
            ? `${customer.name}${customer.credit_limit > 0 ? ` · credit limit ${inr(customer.credit_limit)}` : ""}`
            : "Walk-in — tap to attach a customer (needed for credit)"}
        </button>

        <div className="space-y-2">
          {splits.map((s, i) => {
            const Icon = MODES.find((m) => m.value === s.mode)?.icon ?? Banknote;
            return (
              <div key={i} className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/40">
                  <Icon className="h-4 w-4" />
                </div>
                <Select
                  value={s.mode}
                  onValueChange={(v) => updateSplit(i, { mode: v as PaymentMode })}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  className="text-right"
                  value={s.amount}
                  onChange={(e) => updateSplit(i, { amount: e.target.value })}
                />
                {splits.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSplits((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSplits((prev) => [...prev, { mode: "UPI", amount: "" }])}
            >
              + Add split
            </Button>
            <div className="text-sm">
              Remaining:{" "}
              <b className={remaining > 0 ? "text-warning" : "text-success"}>{inr(remaining)}</b>
              {remaining > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">(stays on invoice)</span>
              )}
            </div>
          </div>
        </div>

        {upiAmount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                `upi://pay?pn=${encodeURIComponent("RetailHub Store")}&am=${upiAmount.toFixed(2)}&cu=INR`,
              )}`}
              alt="UPI QR"
              className="h-28 w-28 rounded bg-white p-1"
            />
            <div className="text-sm">
              <div className="font-medium">Scan to pay via UPI</div>
              <div className="text-muted-foreground">Amount: {inr(upiAmount)}</div>
              <div className="text-xs text-muted-foreground">
                Any UPI app · shows in customer's scanner
              </div>
            </div>
          </div>
        )}

        <Button
          className="h-11 text-base"
          onClick={confirm}
          disabled={busy || paid <= 0}
        >
          {busy ? "Saving…" : `Confirm bill — ${inr(Math.min(paid, total))}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
