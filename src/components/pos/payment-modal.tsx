import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Banknote,
  CreditCard,
  QrCode,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import QRCodeSVG from "react-qr-code";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import {
  createPosInvoice,
  inr,
  type CartLine,
  type Customer,
  type InvoiceResult,
  type PaymentMode,
  type PaymentSplitInput,
} from "@/lib/pos";
import { userFacingError } from "@/lib/retail-api";

const MODES: Array<{ value: PaymentMode; label: string; icon: typeof Banknote }> = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "UPI", label: "UPI", icon: QrCode },
  { value: "CARD", label: "Card", icon: CreditCard },
  { value: "CREDIT", label: "Udhar (Customer Credit)", icon: Wallet },
];

const NOTES = [100, 200, 500, 2000];

function suggestChange(amount: number) {
  const denominations = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
  let remaining = Math.round(amount * 100) / 100;
  return denominations.flatMap((denomination) => {
    const count = Math.floor((remaining + 0.0001) / denomination);
    remaining = Math.round((remaining - count * denomination) * 100) / 100;
    return count ? [{ denomination, count }] : [];
  });
}

interface Split {
  mode: PaymentMode;
  amount: string;
  tendered: string;
}

export function PaymentModal({
  open,
  onOpenChange,
  locationId,
  draftId,
  invoiceNumber,
  cashierId,
  cashierName,
  businessDate,
  lines,
  subtotal,
  discount,
  onDiscountChange,
  minTotal,
  customer,
  onPickCustomer,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  draftId?: string | null | undefined;
  invoiceNumber?: string | null | undefined;
  cashierId?: string | undefined;
  cashierName?: string | undefined;
  businessDate: string;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  onDiscountChange: (value: number) => void;
  /** Sum of qty × floor (min allowed) price — bill discount cannot go below this. */
  minTotal: number;
  customer: Customer | null;
  onPickCustomer: () => void;
  onPaid: (result: InvoiceResult, payments: PaymentSplitInput[]) => void;
}) {
  const maxDiscount = Math.max(subtotal - minTotal, 0);
  const total = Math.max(subtotal - discount, 0);
  const [splits, setSplits] = useState<Split[]>([{ mode: "CASH", amount: "", tendered: "" }]);
  const [discountMode, setDiscountMode] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [busy, setBusy] = useState(false);
  const [changeNotes, setChangeNotes] = useState<Array<{ denomination: number; count: number }>>(
    [],
  );

  useEffect(() => {
    if (open) {
      setSplits([{ mode: "CASH", amount: String(total.toFixed(2)), tendered: "" }]);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const paid = useMemo(() => splits.reduce((s, x) => s + (Number(x.amount) || 0), 0), [splits]);
  const remaining = Math.max(total - paid, 0);

  const cashDue = useMemo(
    () =>
      splits.filter((s) => s.mode === "CASH").reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
    [splits],
  );
  const cashTendered = useMemo(
    () =>
      splits
        .filter((s) => s.mode === "CASH")
        .reduce((sum, s) => sum + (Number(s.tendered) || 0), 0),
    [splits],
  );
  const change = Math.max(cashTendered - cashDue, 0);

  useEffect(() => setChangeNotes(suggestChange(change)), [change]);

  const upiAmount = splits
    .filter((s) => s.mode === "UPI")
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  function updateSplit(index: number, patch: Partial<Split>) {
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function confirm() {
    const valid = splits.filter((s) => (Number(s.amount) || 0) > 0);
    if (valid.length === 0) {
      toast.error("Enter at least one payment amount");
      return;
    }
    if (valid.some((s) => s.mode === "CREDIT") && !customer) {
      toast.error("Udhar needs a registered customer", {
        description: "Tap the customer chip to pick or add one first.",
      });
      return;
    }
    if (remaining > 0.01 && !customer) {
      toast.error("A customer is required for an unpaid balance", {
        description: "Choose or add a customer, or collect the full amount before checkout.",
      });
      return;
    }
    if (paid > total + 0.01) {
      toast.error("Payment amounts exceed the bill total", {
        description: `Reduce the split by ${inr(paid - total)}.`,
      });
      return;
    }
    setBusy(true);
    try {
      const payments: PaymentSplitInput[] = valid.map((s) => {
        const amount = Number(s.amount);
        if (s.mode === "CASH") {
          const tendered = Number(s.tendered) || amount;
          return {
            amount,
            mode: s.mode,
            tendered,
            change_given: Math.max(tendered - amount, 0),
          };
        }
        return { amount, mode: s.mode };
      });
      const result = await createPosInvoice({
        locationId,
        draftId,
        invoiceNumber,
        cashierId,
        cashierName,
        customerId: customer?.id ?? null,
        discount,
        businessDate,
        items: lines.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          uom: l.uom,
          discount: l.discount,
          total: l.quantity * l.unit_price - l.discount,
        })),
        payments,
      });
      onPaid(result, payments);
      onOpenChange(false);
    } catch (e) {
      toast.error("Billing failed", {
        description: userFacingError(
          e,
          "The bill could not be completed. Review the payment and try again.",
        ),
      });
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
            Split across cash, UPI, card or customer credit. Cash asks for tendered amount and shows
            change.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border bg-muted/40 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Subtotal</div>
            <div className="text-sm font-semibold">{inr(subtotal)}</div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Discount</div>
            <div className="mt-0.5 flex gap-1">
              <SearchableSelect
                className="h-7 w-16"
                value={discountMode}
                onValueChange={(value) => setDiscountMode(value as "AMOUNT" | "PERCENT")}
                options={[
                  { value: "AMOUNT", label: "₹" },
                  { value: "PERCENT", label: "%" },
                ]}
              />
              <Input
                type="number"
                className="h-7 text-center text-sm"
                value={
                  discountMode === "PERCENT" && subtotal > 0
                    ? ((discount / subtotal) * 100).toFixed(2)
                    : discount || ""
                }
                onChange={(e) => {
                  const entered = Number(e.target.value) || 0;
                  const value = discountMode === "PERCENT" ? (subtotal * entered) / 100 : entered;
                  if (value > maxDiscount) {
                    toast.warning(`Max discount ${inr(maxDiscount)}`, {
                      description: "Floor price protection is on.",
                    });
                    onDiscountChange(maxDiscount);
                  } else onDiscountChange(Math.max(0, value));
                }}
              />
            </div>
            <div className="text-[9px] text-muted-foreground">max {inr(maxDiscount)}</div>
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
            : "Walk-in — tap to attach a customer (needed for Udhar)"}
        </button>

        <div className="space-y-2">
          {splits.map((s, i) => {
            const Icon = MODES.find((m) => m.value === s.mode)?.icon ?? Banknote;
            return (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/40">
                    <Icon className="h-4 w-4" />
                  </div>
                  <SearchableSelect
                    className="w-44"
                    value={s.mode}
                    onValueChange={(value) => updateSplit(i, { mode: value as PaymentMode })}
                    options={MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
                  />
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
                {s.mode === "CASH" && (
                  <div className="flex items-center gap-1.5 pl-11">
                    <Input
                      type="number"
                      className="h-8 w-32 text-right"
                      placeholder="Cash tendered"
                      value={s.tendered}
                      onChange={(e) => updateSplit(i, { tendered: e.target.value })}
                    />
                    {NOTES.map((n) => (
                      <button
                        key={n}
                        onClick={() =>
                          updateSplit(i, { tendered: String((Number(s.tendered) || 0) + n) })
                        }
                        className="rounded-md border bg-card px-2 py-1 text-xs font-medium tabular-nums hover:border-primary/40 hover:bg-accent"
                      >
                        +₹{n}
                      </button>
                    ))}
                    <button
                      onClick={() => updateSplit(i, { tendered: String(cashDue.toFixed(2)) })}
                      className="rounded-md border bg-primary/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
                    >
                      Exact
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSplits((prev) => [...prev, { mode: "UPI", amount: "", tendered: "" }])
              }
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
            <div className="h-28 w-28 rounded bg-white p-1" aria-label="UPI payment QR code">
              <QRCodeSVG
                value={`upi://pay?pn=${encodeURIComponent("RetailHub Store")}&am=${upiAmount.toFixed(2)}&cu=INR`}
                size={104}
              />
            </div>
            <div className="text-sm">
              <div className="font-medium">Scan to pay via UPI</div>
              <div className="text-muted-foreground">Amount: {inr(upiAmount)}</div>
              <div className="text-xs text-muted-foreground">
                Any UPI app · shows in customer's scanner
              </div>
            </div>
          </div>
        )}

        {cashDue > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                Cash received
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums">{inr(cashTendered)}</div>
            </div>
            <div
              className={cn(
                "rounded-lg border-2 p-3",
                change > 0 ? "border-warning/50 bg-warning/10" : "border-border bg-muted/40",
              )}
            >
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                <ArrowDownToLine className="h-3.5 w-3.5" /> Change to return
              </div>
              <div
                className={cn(
                  "mt-1 text-xl font-bold tabular-nums",
                  change > 0 ? "text-warning" : "",
                )}
              >
                {inr(change)}
              </div>
            </div>
          </div>
        )}
        {change > 0 && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Suggested change notes · adjust the note count
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {changeNotes.map(({ denomination, count }) => (
                <div
                  key={denomination}
                  className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium tabular-nums"
                >
                  <button
                    aria-label={`Remove one ${denomination} rupee note`}
                    className="rounded px-1 hover:bg-muted"
                    onClick={() =>
                      setChangeNotes((items) =>
                        items.map((item) =>
                          item.denomination === denomination
                            ? { ...item, count: Math.max(0, item.count - 1) }
                            : item,
                        ),
                      )
                    }
                  >
                    −
                  </button>
                  <span>
                    {denomination < 1 ? `${denomination * 100}p` : `₹${denomination}`} × {count}
                  </span>
                  <button
                    aria-label={`Add one ${denomination} rupee note`}
                    className="rounded px-1 hover:bg-muted"
                    onClick={() =>
                      setChangeNotes((items) =>
                        items.map((item) =>
                          item.denomination === denomination
                            ? { ...item, count: item.count + 1 }
                            : item,
                        ),
                      )
                    }
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button className="h-11 text-base" onClick={confirm} disabled={busy || paid <= 0}>
          {busy ? "Saving…" : `Confirm bill — ${inr(Math.min(paid, total))}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
