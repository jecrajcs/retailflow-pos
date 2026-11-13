import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Printer } from "lucide-react";
import { toast } from "sonner";
import { AppNav } from "@/components/pos/app-nav";
import { DataTable } from "@/components/pos/data-table";
import { ReceiptDialog, type ReceiptData } from "@/components/pos/receipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  inr,
  useCustomers,
  useInvoiceItems,
  useLocations,
  useProducts,
  useSales,
  type InvoiceItemRow,
} from "@/lib/pos";
import { getAllLocal, type KeyedRecord } from "@/lib/local-db";
import type { PaymentRow } from "@/lib/pos";
import { useEffect } from "react";
import { useAccess, canAccessLocation } from "@/lib/access";

export const Route = createFileRoute("/sales")({ component: SalesPage });

function SalesPage() {
  const { profile } = useAccess();
  const { data: sales = [] } = useSales();
  const { data: locations = [] } = useLocations();
  const { data: customers = [] } = useCustomers();
  const { data: products = [] } = useProducts();
  const allowedLocations = locations.filter((location) => canAccessLocation(profile, location.id));
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const selected = sales.find((invoice) => invoice.id === selectedId) ?? null;
  const { data: items = [] } = useInvoiceItems(selectedId);

  async function reprintSelectedReceipt() {
    if (!selected) return;
    try {
      const [allItems, allPayments] = await Promise.all([
        getAllLocal<InvoiceItemRow & KeyedRecord>("invoice_items"),
        getAllLocal<PaymentRow & KeyedRecord>("payments"),
      ]);
      const invoiceItems = allItems.filter((item) => item.invoice_id === selected.id);
      const invoicePayments = allPayments.filter((payment) => payment.invoice_id === selected.id);
      const location = locations.find((entry) => entry.id === selected.location_id);
      setReceipt({
        invoiceNumber: selected.invoice_number,
        locationName: location?.name ?? "DailyPlazaa Store",
        customerName: customers.find((entry) => entry.id === selected.customer_id)?.name ?? null,
        lines: invoiceItems.map((item) => ({
          name:
            item.product_snapshot?.name ??
            products.find((product) => product.id === item.product_id)?.name ??
            item.products?.name ??
            `Item ${item.product_id}`,
          quantity: item.quantity,
          unit_price: item.unit_price,
          uom: item.uom,
          total: item.total,
        })),
        subtotal:
          invoiceItems.reduce((sum, item) => sum + item.total, 0) + selected.discount_amount,
        discount: selected.discount_amount,
        total: selected.total_amount,
        payments: invoicePayments.map((payment) => ({
          mode: payment.mode,
          amount: payment.amount,
          ...(payment.tendered != null ? { tendered: payment.tendered } : {}),
          ...(payment.change_given != null ? { change_given: payment.change_given } : {}),
          ...(payment.change_denominations
            ? { change_denominations: payment.change_denominations }
            : {}),
        })),
        createdAt: selected.created_at,
      });
    } catch (error) {
      console.error("Could not load receipt data", error);
      toast.error("Could not load this receipt", {
        description: "The bill remains saved. Reopen it and try printing again.",
      });
    }
  }

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setPayments([]);
      return;
    }
    void getAllLocal<PaymentRow & KeyedRecord>("payments").then((rows) => {
      if (active) setPayments(rows.filter((row) => row.invoice_id === selectedId));
    });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const filtered = useMemo(
    () =>
      sales
        .filter(
          (sale) => sale.status === "COMPLETED" && canAccessLocation(profile, sale.location_id),
        )
        .filter(
          (sale) =>
            (!fromDate || sale.business_date >= fromDate) &&
            (!toDate || sale.business_date <= toDate),
        )
        .filter((sale) => locationId === "all" || sale.location_id === locationId)
        .filter((sale) => paymentStatus === "all" || sale.payment_status === paymentStatus)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [sales, fromDate, toDate, locationId, paymentStatus, profile],
  );

  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/sales" />
      <main className="mx-auto min-h-0 w-full max-w-[1500px] flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Local sales register</p>
            <h1 className="text-2xl font-bold">Sales</h1>
          </div>
          <Badge variant="outline">{filtered.length} bills · device data</Badge>
        </div>
        <Card>
          <CardContent className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="grid grid-cols-2 gap-1">
              <div className="relative">
                <CalendarDays className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  aria-label="Start bill date"
                />
              </div>
              <Input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                aria-label="End bill date"
              />
            </div>
            <SearchableSelect
              value={locationId}
              onValueChange={setLocationId}
              placeholder="Assigned locations"
              options={[
                { value: "all", label: "Assigned locations" },
                ...allowedLocations.map((location) => ({
                  value: location.id,
                  label: location.name,
                  keywords: [location.code],
                })),
              ]}
            />
            <SearchableSelect
              value={paymentStatus}
              onValueChange={setPaymentStatus}
              placeholder="All payment statuses"
              options={[
                { value: "all", label: "All payment statuses" },
                { value: "PAID", label: "Paid" },
                { value: "PARTIALLY_PAID", label: "Partially paid" },
                { value: "UNPAID", label: "Unpaid" },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Completed bills</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={filtered}
              getRowId={(sale) => sale.id}
              resetKey={`${fromDate}:${toDate}:${locationId}:${paymentStatus}`}
              searchPlaceholder="Bill, customer, phone or cashier…"
              emptyMessage="No completed bills match these filters."
              columns={[
                {
                  id: "bill",
                  header: "Bill",
                  accessor: (sale) => sale.invoice_number,
                  cell: (sale) => (
                    <Button
                      variant="link"
                      className="h-auto p-0 font-semibold"
                      onClick={() => setSelectedId(sale.id)}
                    >
                      {sale.invoice_number}
                    </Button>
                  ),
                },
                {
                  id: "date",
                  header: "Date",
                  accessor: (sale) => sale.business_date,
                  cell: (sale) => (
                    <span>
                      {sale.business_date}
                      <span className="block text-xs text-muted-foreground">
                        {new Date(sale.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                  ),
                },
                {
                  id: "customer",
                  header: "Customer",
                  accessor: (sale) =>
                    customers.find((entry) => entry.id === sale.customer_id)?.name ?? "Walk-in",
                  cell: (sale) => (
                    <span>
                      {customers.find((entry) => entry.id === sale.customer_id)?.name ?? "Walk-in"}
                      <span className="block text-xs text-muted-foreground">
                        {sale.cashier_name}
                      </span>
                    </span>
                  ),
                },
                {
                  id: "location",
                  header: "Location",
                  accessor: (sale) =>
                    locations.find((entry) => entry.id === sale.location_id)?.name ?? "Location",
                },
                {
                  id: "total",
                  header: "Total",
                  accessor: (sale) => sale.total_amount,
                  cell: (sale) => (
                    <span className="font-medium tabular-nums">
                      {inr(sale.total_amount)}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {inr(sale.balance_amount)} due
                      </span>
                    </span>
                  ),
                },
                {
                  id: "sync",
                  header: "Sync",
                  accessor: (sale) => sale.sync_status ?? "LOCAL",
                  cell: (sale) => (
                    <Badge
                      variant={
                        sale.sync_status === "SYNCED"
                          ? "outline"
                          : sale.sync_status === "REVIEW"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {sale.sync_status === "SYNCED"
                        ? "Synced"
                        : sale.sync_status === "REVIEW"
                          ? "Review needed"
                          : sale.sync_status === "PENDING"
                            ? "Sync pending"
                            : "Saved here"}
                    </Badge>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </main>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto print-area">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Bill {selected.invoice_number}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>
                  {selected.business_date} ·{" "}
                  {locations.find((location) => location.id === selected.location_id)?.name}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void reprintSelectedReceipt()}
                  className="print:hidden"
                >
                  <Printer className="mr-2 h-4 w-4" /> Reprint receipt
                </Button>
              </div>
              <div className="space-y-2 rounded-xl border p-3">
                {items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-3 text-sm">
                    <span>
                      {item.product_snapshot?.name ??
                        item.products?.name ??
                        `Item ${item.product_id}`}{" "}
                      × {item.quantity} {item.uom}
                    </span>
                    <span>{inr(item.total)}</span>
                  </div>
                ))}
              </div>
              <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>{inr(selected.discount_amount)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span>{inr(selected.total_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Paid</span>
                  <span>{inr(selected.paid_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Balance</span>
                  <span>{inr(selected.balance_amount)}</span>
                </div>
              </div>
              <div className="space-y-1 border-t pt-3">
                <p className="text-sm font-medium">Payments</p>
                {payments.length ? (
                  payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex justify-between text-sm text-muted-foreground"
                    >
                      <span>
                        {payment.mode} · {new Date(payment.created_at).toLocaleString()}
                      </span>
                      <span>{inr(payment.amount)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No payments found.</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ReceiptDialog
        open={!!receipt}
        onOpenChange={(open) => !open && setReceipt(null)}
        data={receipt}
      />
    </div>
  );
}
