import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ReceiptLine {
  name: string;
  quantity: number;
  unit_price: number;
  uom: string;
  total: number;
}

export type { ReceiptPayment } from "@/lib/pos";
import { inr, type ReceiptPayment } from "@/lib/pos";

export interface ReceiptData {
  invoiceNumber: string;
  locationName: string;
  customerName: string | null;
  lines: ReceiptLine[];
  subtotal: number;
  discount: number;
  total: number;
  payments: ReceiptPayment[];
  createdAt: string;
}

export function ReceiptDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ReceiptData | null;
}) {
  const [width, setWidth] = useState<58 | 80>(58);
  if (!data) return null;

  function printReceipt() {
    const body = document.body;
    const pageStyle = document.createElement("style");
    pageStyle.dataset["receiptPrint"] = "true";
    pageStyle.textContent = "@page { margin: 0; }";
    let cleanupTimer = 0;
    const cleanup = () => {
      body.classList.remove("print-receipt");
      pageStyle.remove();
      window.clearTimeout(cleanupTimer);
      window.removeEventListener("afterprint", cleanup);
    };
    body.classList.add("print-receipt");
    document.head.append(pageStyle);
    window.addEventListener("afterprint", cleanup);
    cleanupTimer = window.setTimeout(cleanup, 60_000);
    window.print();
  }

  const paid = data.payments
    .filter((payment) => payment.mode !== "CREDIT")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const balance = Math.max(data.total - paid, 0);
  const changeTotal = data.payments.reduce((s, p) => s + (p.change_given ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Receipt — {data.invoiceNumber}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-lg border bg-muted p-1">
            {([58, 80] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWidth(w)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium",
                  width === w ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                {w}mm
              </button>
            ))}
          </div>
          <Button onClick={printReceipt} className="gap-1.5">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>

        <div
          id="thermal-print"
          className="mx-auto rounded border bg-white p-3 font-mono text-[11px] leading-snug text-black"
          style={{ ["--receipt-width" as string]: `${width}mm`, width: width === 58 ? 260 : 330 }}
        >
          <div className="text-center">
            <div className="text-sm font-bold uppercase">{data.locationName}</div>
            <div className="text-[10px] text-neutral-600">Tax Invoice / Bill of Supply</div>
          </div>
          <div className="my-1 border-t border-dashed border-neutral-400" />
          <div className="receipt-meta">
            <div className="receipt-invoice">{data.invoiceNumber}</div>
            <div className="receipt-created-at">
              {new Date(data.createdAt).toLocaleString("en-IN", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </div>
          </div>
          <div>Customer: {data.customerName ?? "Walk-in"}</div>
          <div className="my-1 border-t border-dashed border-neutral-400" />
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[48%]" />
              <col className="w-[24%]" />
              <col className="w-[28%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase">
                <th className="pb-0.5">Item</th>
                <th className="pb-0.5 text-right">Qty</th>
                <th className="pb-0.5 text-right">Amt</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={i}>
                  <td className="receipt-item-name pr-1">{l.name}</td>
                  <td className="text-right whitespace-nowrap">
                    {l.quantity} {l.uom}
                  </td>
                  <td className="text-right whitespace-nowrap">{inr(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="my-1 border-t border-dashed border-neutral-400" />
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{inr(data.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount</span>
            <span>- {inr(data.discount)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold">
            <span>TOTAL</span>
            <span>{inr(data.total)}</span>
          </div>
          {data.payments.map((p, i) => (
            <div key={i}>
              <div className="flex justify-between">
                <span>
                  {p.mode}
                  {p.tendered ? ` (tendered ${inr(p.tendered)})` : ""}
                </span>
                <span>{inr(p.amount)}</span>
              </div>
              {(p.change_given ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span>Change returned</span>
                  <span>- {inr(p.change_given!)}</span>
                </div>
              )}
            </div>
          ))}
          {balance > 0 && (
            <div className="flex justify-between font-bold">
              <span>BALANCE DUE (UDHAR)</span>
              <span>{inr(balance)}</span>
            </div>
          )}
          {changeTotal > 0 && (
            <div className="mt-1 border-t border-dashed border-neutral-400 pt-1 text-center">
              <div className="text-[10px] uppercase">Change to return</div>
              <div className="text-base font-bold">₹ {inr(changeTotal).replace("₹", "")}</div>
            </div>
          )}
          <div className="my-1 border-t border-dashed border-neutral-400" />
          <div className="text-center text-[10px]">Thank you! Visit again.</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
