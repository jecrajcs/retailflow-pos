import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Printer, Search } from "lucide-react";
import { AppNav } from "@/components/pos/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  inr,
  matchesSearchFields,
  useCustomers,
  useInvoiceItems,
  useLocations,
  useSales,
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
  const allowedLocations = locations.filter((location) => canAccessLocation(profile, location.id));
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const selected = sales.find((invoice) => invoice.id === selectedId) ?? null;
  const { data: items = [] } = useInvoiceItems(selectedId);

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
        .filter((sale) =>
          matchesSearchFields(
            [
              sale.invoice_number,
              sale.cashier_name,
              customers.find((customer) => customer.id === sale.customer_id)?.name,
              customers.find((customer) => customer.id === sale.customer_id)?.mobile,
            ],
            query,
          ),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [sales, fromDate, toDate, locationId, paymentStatus, query, customers, profile],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AppNav active="/sales" />
      <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-4 p-3 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Local sales register</p>
            <h1 className="text-2xl font-bold">Sales</h1>
          </div>
          <Badge variant="outline">{filtered.length} bills · device data</Badge>
        </div>
        <Card>
          <CardContent className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Bill, customer, phone…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
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
          <CardContent className="space-y-2">
            {filtered.length ? (
              filtered.map((sale) => {
                const customer = customers.find((entry) => entry.id === sale.customer_id);
                const location = locations.find((entry) => entry.id === sale.location_id);
                return (
                  <button
                    key={sale.id}
                    onClick={() => setSelectedId(sale.id)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 sm:grid-cols-[1.2fr_1fr_1fr_auto_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{sale.invoice_number}</span>
                      <span className="text-xs text-muted-foreground">
                        {sale.business_date} ·{" "}
                        {new Date(sale.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="hidden truncate text-sm sm:block">
                      {customer?.name ?? "Walk-in"}
                      <span className="block text-xs text-muted-foreground">
                        {sale.cashier_name}
                      </span>
                    </span>
                    <span className="hidden truncate text-sm text-muted-foreground sm:block">
                      {location?.name ?? "Location"}
                    </span>
                    <span className="text-right font-semibold tabular-nums">
                      {inr(sale.total_amount)}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {inr(sale.balance_amount)} due
                      </span>
                    </span>
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
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No completed bills match these filters.
              </div>
            )}
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
                  onClick={() => window.print()}
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
    </div>
  );
}
