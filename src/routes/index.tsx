import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  Cloud,
  RefreshCw,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { AppNav } from "@/components/pos/app-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { inr, useInventory, useLocations, useProducts, useSales } from "@/lib/pos";
import { getPendingOperations } from "@/lib/local-db";
import { syncOutbox } from "@/lib/offline-sync";
import { canManage, useAccess } from "@/lib/access";
import { retailApi, userFacingError } from "@/lib/retail-api";

export const Route = createFileRoute("/")({ component: DashboardPage });

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function DashboardPage() {
  const { profile } = useAccess();
  if (!profile) return <PublicDashboardPage />;
  return <StaffDashboardPage />;
}

function PublicDashboardPage() {
  const [overview, setOverview] = useState<{
    business_date: string;
    completed_bills: number;
    sales_total: number;
  } | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void retailApi<{
      business_date: string;
      completed_bills: number;
      sales_total: number;
    }>("/api/public-overview")
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            userFacingError(
              error,
              "Today's overview is temporarily unavailable. Please try again.",
            ),
          );
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 bg-background p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">RetailFlow POS · Public overview</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Today at a glance</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Store-wide totals only. Sign in to view operational details or use POS tools.
          </p>
        </div>
        <Button asChild>
          <Link to="/billing">Staff sign in</Link>
        </Button>
      </header>
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Public daily totals">
        <Metric
          title="Today's sales"
          value={overview ? inr(overview.sales_total) : "—"}
          detail={overview ? `${overview.completed_bills} completed bills` : "Store-wide total"}
          icon={ShoppingBag}
        />
        <Metric
          title="Completed bills"
          value={overview ? String(overview.completed_bills) : "—"}
          detail={overview?.business_date ?? "Today"}
          icon={Cloud}
        />
      </section>
      {message && (
        <p
          role="status"
          className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          {message}
        </p>
      )}
      <p className="mt-auto text-xs text-muted-foreground">
        This public page contains no bill, customer, staff, inventory, or location-level details.
      </p>
    </main>
  );
}

function StaffDashboardPage() {
  const { profile } = useAccess();
  const { data: sales = [] } = useSales();
  const { data: inventory = [] } = useInventory();
  const { data: products = [] } = useProducts();
  const { data: locations = [] } = useLocations();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const operations = await getPendingOperations();
      if (active) setPendingCount(operations.length);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onSyncStatus = () => void refresh();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("retailflow:sync-status", onSyncStatus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("retailflow:sync-status", onSyncStatus);
    };
  }, []);

  const permittedIds = useMemo(
    () =>
      new Set(
        profile?.role === "ADMIN"
          ? locations.map((location) => location.id)
          : (profile?.location_ids ?? []),
      ),
    [profile, locations],
  );
  const visibleSales = useMemo(
    () => sales.filter((sale) => permittedIds.has(sale.location_id)),
    [sales, permittedIds],
  );
  const visibleInventory = useMemo(
    () => inventory.filter((row) => permittedIds.has(row.location_id)),
    [inventory, permittedIds],
  );
  const todaysSales = useMemo(
    () =>
      visibleSales.filter((sale) => sale.business_date === today() && sale.status === "COMPLETED"),
    [visibleSales],
  );
  const gross = todaysSales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const outstanding = visibleSales
    .filter((sale) => sale.status === "COMPLETED")
    .reduce((sum, sale) => sum + sale.balance_amount, 0);
  const lowStock = visibleInventory.filter((row) => {
    const product = products.find((item) => item.id === row.product_id);
    return product && product.min_stock > 0 && row.quantity_on_hand <= product.min_stock;
  });
  const locationCount =
    profile?.role === "ADMIN"
      ? locations.length
      : locations.filter((location) => permittedIds.has(location.id)).length;

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await syncOutbox();
      setPendingCount(result.pending);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/" />
      <main className="mx-auto min-h-0 w-full max-w-[1500px] flex-1 space-y-5 overflow-y-auto p-3 sm:p-5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 sm:p-6">
          <div>
            <p className="text-sm text-muted-foreground">
              RetailFlow POS ·{" "}
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              Today at a glance
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sales and alerts update from this device, even while offline.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void syncNow()}
              disabled={!online || syncing}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> Sync now
            </Button>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            title="Today's sales"
            value={inr(gross)}
            detail={`${todaysSales.length} completed bills`}
            icon={ShoppingBag}
          />
          <Metric
            title="Outstanding dues"
            value={inr(outstanding)}
            detail={
              profile?.role === "CASHIER"
                ? "assigned outlet balances"
                : "assigned location balances"
            }
            icon={Wallet}
          />
          <Metric
            title="Low stock alerts"
            value={String(lowStock.length)}
            detail="Across your assigned locations"
            icon={CircleAlert}
            alert={lowStock.length > 0}
          />
          <Metric
            title="Locations"
            value={String(locationCount)}
            detail="Accessible stock snapshots"
            icon={Cloud}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Recent sales</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Completed bills saved on this device
                </p>
              </div>
              <Button variant="ghost" asChild className="gap-1">
                <Link to="/sales">
                  Sales register <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {visibleSales
                .filter((sale) => sale.status === "COMPLETED")
                .slice()
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .slice(0, 6).length ? (
                <div className="divide-y">
                  {visibleSales
                    .filter((sale) => sale.status === "COMPLETED")
                    .slice()
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .slice(0, 6)
                    .map((sale) => (
                      <div key={sale.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{sale.invoice_number}</div>
                          <div className="text-xs text-muted-foreground">
                            {sale.business_date} ·{" "}
                            {locations.find((location) => location.id === sale.location_id)?.name ??
                              "Outlet"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{inr(sale.total_amount)}</div>
                          <div className="text-xs text-muted-foreground">
                            {sale.balance_amount > 0 ? `${inr(sale.balance_amount)} due` : "Paid"}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <Empty label="No completed sales on this device yet." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alerts & sync</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border p-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${online ? "bg-success" : "bg-warning"}`}
                  />
                  <div>
                    <div className="text-sm font-medium">{online ? "Online" : "Offline"}</div>
                    <div className="text-xs text-muted-foreground">
                      POS remains available either way
                    </div>
                  </div>
                </div>
                <Badge variant={pendingCount ? "secondary" : "outline"}>
                  {pendingCount} pending
                </Badge>
              </div>
              {lowStock.slice(0, 4).map((row) => {
                const product = products.find((item) => item.id === row.product_id);
                const location = locations.find((item) => item.id === row.location_id);
                return (
                  <div
                    key={`${row.product_id}-${row.location_id}`}
                    className="flex items-center justify-between rounded-lg bg-warning/10 px-3 py-2 text-sm"
                  >
                    <span className="truncate">
                      {product?.name ?? "Product"} · {location?.code ?? "Outlet"}
                    </span>
                    <span className="font-mono font-semibold">{row.quantity_on_hand} left</span>
                  </div>
                );
              })}
              {!lowStock.length && <Empty label="No low-stock alerts." />}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="outline" asChild className="justify-between">
                  <Link to="/inventory">
                    Inventory <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
                {canManage(profile) && (
                  <Button variant="outline" asChild className="justify-between">
                    <Link to="/purchases">
                      Receive stock <ArrowDownRight className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

function Metric({
  title,
  value,
  detail,
  icon: Icon,
  alert = false,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof ShoppingBag;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className={`mt-2 text-2xl font-bold tabular-nums ${alert ? "text-warning" : ""}`}>
            {value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span
          className={`rounded-xl p-2.5 ${alert ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
