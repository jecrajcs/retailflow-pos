import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CreditCard,
  LockKeyhole,
  QrCode,
  Vault,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { AppNav } from "@/components/pos/app-nav";
import { getBrowserStorage } from "@/lib/browser-storage";
import { DataTable } from "@/components/pos/data-table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  canAccessLocation,
  canManage,
  saveActiveLocation,
  useAccess,
  type UserAccessProfile,
} from "@/lib/access";
import { retailApi, userFacingError } from "@/lib/retail-api";
import { refreshLocalReplica } from "@/lib/offline-sync";
import {
  CASH_TXN_REASONS,
  closeSession,
  DENOMINATIONS,
  denomTotal,
  inr,
  logCashTxn,
  openSession,
  useCashSessions,
  useCashTransactions,
  useCustomers,
  useLocations,
  usePaymentsSince,
  useSales,
  type CashTxnRow,
  type PaymentRow,
  type CashSession,
} from "@/lib/pos";

export const Route = createFileRoute("/cash-drawer")({
  head: () => ({
    meta: [
      { title: "DailyPlazaa POS — Cash Drawer" },
      {
        name: "description",
        content:
          "Open and close cash drawer shifts with a full cash in/out history — shop expenses, tea & snacks, vendor payments, change top-ups and reconciliation.",
      },
      { property: "og:title", content: "DailyPlazaa POS — Cash Drawer" },
      {
        property: "og:description",
        content:
          "Open and close cash drawer shifts with a full cash in/out history — shop expenses, tea & snacks, vendor payments, change top-ups and reconciliation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CashDrawerPage,
});

const LS_KEY = "pos-location-id";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function CashDrawerPage() {
  const queryClient = useQueryClient();
  const { profile } = useAccess();
  const { data: locations = [] } = useLocations();
  const { data: customers = [] } = useCustomers();
  const { data: sales = [] } = useSales();
  const allowedLocations = locations.filter(
    (entry) => entry.is_active && canAccessLocation(profile, entry.id),
  );
  const [locationId, setLocationId] = useState<string>(() => getBrowserStorage(LS_KEY) ?? "");
  const location =
    allowedLocations.find((l) => l.id === locationId) ??
    (allowedLocations.length === 1 ? allowedLocations[0] : undefined);

  useEffect(() => {
    if (allowedLocations.length === 1 && locationId !== allowedLocations[0]?.id) {
      setLocationId(allowedLocations[0]!.id);
      saveActiveLocation(allowedLocations[0]!.id);
    }
  }, [allowedLocations, locationId]);

  const [view, setView] = useState<"express" | "detailed">("express");

  const { data: localSessions = [] } = useCashSessions(location?.id ?? null);
  const sessions = useMemo(
    () =>
      localSessions
        .slice()
        .sort((a, b) => b.opened_at.localeCompare(a.opened_at))
        .slice(0, 30),
    [localSessions],
  );
  const closedSessions = useMemo(
    () => sessions.filter((session) => session.status === "CLOSED"),
    [sessions],
  );

  const activeShift = sessions.find((s) => s.status === "OPEN");
  const foreignShift =
    profile?.role === "CASHIER" && activeShift && activeShift.opened_by_id !== profile.user_id;
  const legacyUnassignedShift = !!activeShift && !activeShift.opened_by_id;
  const open = foreignShift ? undefined : activeShift;
  const since = open?.opened_at ?? startOfToday();
  const { data: payments = [] } = usePaymentsSince(location?.id ?? null, since);
  const { data: txns = [] } = useCashTransactions(location?.id ?? null, since);
  const customersById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );
  const salesById = useMemo(() => new Map(sales.map((sale) => [sale.id, sale])), [sales]);

  const byMode: { CASH: number; UPI: number; CARD: number; CREDIT: number } = useMemo(() => {
    const map: { CASH: number; UPI: number; CARD: number; CREDIT: number } = {
      CASH: 0,
      UPI: 0,
      CARD: 0,
      CREDIT: 0,
    };
    for (const p of payments) {
      if (p.mode === "CASH" || p.mode === "UPI" || p.mode === "CARD" || p.mode === "CREDIT") {
        map[p.mode] += p.amount;
      }
    }
    return map;
  }, [payments]);

  const txnIn = useMemo(
    () => txns.filter((t) => t.direction === "IN").reduce((s, t) => s + t.amount, 0),
    [txns],
  );
  const txnOut = useMemo(
    () => txns.filter((t) => t.direction === "OUT").reduce((s, t) => s + t.amount, 0),
    [txns],
  );

  const expectedCash = open ? open.opening_cash + byMode.CASH + open.cash_in - open.cash_out : 0;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["payments-since"] });
    void queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
  }

  function pickLocation(id: string) {
    setLocationId(id);
    saveActiveLocation(id);
  }

  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/cash-drawer" />
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <SearchableSelect
          className="w-64"
          value={location?.id ?? ""}
          onValueChange={pickLocation}
          placeholder="Select store"
          options={allowedLocations.map((location) => ({
            value: location.id,
            label: `${location.name} (${location.type})`,
            keywords: [location.code],
          }))}
        />
      </div>

      <main className="mx-auto min-h-0 w-full max-w-[1100px] flex-1 overflow-y-auto p-3">
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList>
            <TabsTrigger value="express">Express</TabsTrigger>
            <TabsTrigger value="detailed" disabled={profile?.role === "CASHIER" && !open}>
              Detailed
            </TabsTrigger>
          </TabsList>

          <TabsContent value="express" className="mt-3 space-y-3">
            {foreignShift && activeShift ? (
              <div className="rounded-xl border border-warning/50 bg-warning/5 p-4 text-sm">
                <p className="font-medium">
                  {legacyUnassignedShift
                    ? "This legacy shift has no verified cashier owner."
                    : `This drawer is open under ${activeShift.opened_by}.`}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {legacyUnassignedShift
                    ? "A Manager must review and resolve the shift before this location can be used. You may sign out."
                    : `The cashier who opened it at ${new Date(activeShift.opened_at).toLocaleString("en-IN", { timeStyle: "short" })} must reconcile and close it. You may sign out.`}
                </p>
              </div>
            ) : open ? (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <SummaryCard label="Opening cash" value={inr(open.opening_cash)} />
                  <SummaryCard label="Cash sales (shift)" value={inr(byMode.CASH)} />
                  <SummaryCard label="Expected in drawer" value={inr(expectedCash)} highlight />
                  <SummaryCard
                    label={`Other modes today`}
                    value={inr(byMode.UPI + byMode.CARD + byMode.CREDIT)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SummaryCard
                    label="Cash in (logged)"
                    value={inr(open.cash_in)}
                    icon={ArrowDownCircle}
                    className="text-success"
                  />
                  <SummaryCard
                    label="Cash out (logged)"
                    value={inr(open.cash_out)}
                    icon={ArrowUpCircle}
                    className="text-destructive"
                  />
                </div>
                <QuickLogForm
                  locationId={location?.id ?? ""}
                  sessionId={open.id}
                  onLogged={refresh}
                />
                <CloseShiftCard
                  session={open}
                  expectedCash={expectedCash}
                  cashSales={byMode.CASH}
                  onClosed={refresh}
                />
              </>
            ) : profile?.role === "CASHIER" ? (
              <OpenShiftCard locationId={location?.id ?? ""} profile={profile} onOpened={refresh} />
            ) : (
              <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                No cashier shift is open at this location. A Cashier must count the drawer and open
                the shift before sales begin.
              </div>
            )}
          </TabsContent>

          <TabsContent value="detailed" className="mt-3 space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <SummaryCard label="Cash" value={inr(byMode.CASH)} />
              <SummaryCard label="UPI" value={inr(byMode.UPI)} />
              <SummaryCard label="Card" value={inr(byMode.CARD)} />
              <SummaryCard label="Credit" value={inr(byMode.CREDIT)} />
              <SummaryCard label="Cash out (expenses)" value={inr(txnOut)} />
            </div>

            <QuickLogForm
              locationId={location?.id ?? ""}
              sessionId={open?.id ?? null}
              onLogged={refresh}
            />

            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
                <span>Cash in / out history</span>
                <span className="text-xs text-muted-foreground">
                  In {inr(txnIn)} · Out {inr(txnOut)} · Net {inr(txnIn - txnOut)}
                </span>
              </div>
              <DataTable<CashTxnRow & { sync_status?: string }>
                rows={txns}
                getRowId={(row) => row.id}
                resetKey={`${location?.id ?? ""}:${open?.id ?? ""}`}
                searchPlaceholder="Search cash history…"
                emptyMessage="No cash in/out events logged yet today."
                tableHeightClass="max-h-72"
                columns={[
                  {
                    id: "time",
                    header: "Time",
                    accessor: (row) => row.created_at,
                    cell: (row) =>
                      new Date(row.created_at).toLocaleString("en-IN", { timeStyle: "short" }),
                  },
                  {
                    id: "direction",
                    header: "Direction",
                    accessor: (row) => row.direction,
                    cell: (row) => (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                          row.direction === "IN"
                            ? "bg-success/15 text-success"
                            : "bg-destructive/15 text-destructive",
                        )}
                      >
                        {row.direction === "IN" ? (
                          <ArrowDownCircle className="h-3 w-3" />
                        ) : (
                          <ArrowUpCircle className="h-3 w-3" />
                        )}
                        {row.direction === "IN" ? "Cash In" : "Cash Out"}
                      </span>
                    ),
                  },
                  { id: "reason", header: "Reason", accessor: (row) => row.reason },
                  {
                    id: "amount",
                    header: "Amount",
                    accessor: (row) => row.amount,
                    cell: (row) => (
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          row.direction === "IN" ? "text-success" : "text-destructive",
                        )}
                      >
                        {row.direction === "IN" ? "+" : "−"} {inr(row.amount)}
                      </span>
                    ),
                  },
                ]}
              />
            </section>

            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-sm font-medium">
                Payments since{" "}
                {new Date(since).toLocaleString("en-IN", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </div>
              <DataTable<PaymentRow>
                rows={payments}
                getRowId={(row) => row.id}
                resetKey={`${location?.id ?? ""}:${open?.id ?? ""}`}
                searchPlaceholder="Search payments…"
                emptyMessage="No payments yet."
                tableHeightClass="max-h-72"
                columns={[
                  {
                    id: "time",
                    header: "Time",
                    accessor: (row) => row.created_at,
                    cell: (row) =>
                      new Date(row.created_at).toLocaleString("en-IN", { timeStyle: "short" }),
                  },
                  {
                    id: "mode",
                    header: "Mode",
                    accessor: (row) => row.mode,
                    cell: (row) => <ModeChip mode={row.mode} />,
                  },
                  {
                    id: "customer",
                    header: "Customer name / mobile",
                    accessor: (row) => {
                      const invoice = salesById.get(row.invoice_id);
                      const customer = invoice?.customer_id
                        ? customersById.get(invoice.customer_id)
                        : undefined;
                      return (
                        `${customer?.name ?? ""} ${customer?.mobile ?? ""}`.trim() || "Walk-in"
                      );
                    },
                    cell: (row) => {
                      const invoice = salesById.get(row.invoice_id);
                      const customer = invoice?.customer_id
                        ? customersById.get(invoice.customer_id)
                        : undefined;
                      return (
                        <span className="block min-w-28">
                          <span className="block font-medium">{customer?.name ?? "Walk-in"}</span>
                          {customer?.mobile && (
                            <span className="block text-xs text-muted-foreground">
                              {customer.mobile}
                            </span>
                          )}
                        </span>
                      );
                    },
                  },
                  {
                    id: "received",
                    header: "Amount received",
                    accessor: (row) =>
                      row.mode === "CREDIT"
                        ? null
                        : row.mode === "CASH"
                          ? (row.tendered ?? row.amount)
                          : row.amount,
                    cell: (row) =>
                      row.mode === "CREDIT"
                        ? "—"
                        : inr(row.mode === "CASH" ? (row.tendered ?? row.amount) : row.amount),
                  },
                  {
                    id: "amount",
                    header: "Bill amount",
                    accessor: (row) => salesById.get(row.invoice_id)?.total_amount ?? row.amount,
                    cell: (row) => inr(salesById.get(row.invoice_id)?.total_amount ?? row.amount),
                  },
                  {
                    id: "change",
                    header: "Change returned",
                    accessor: (row) => row.change_given ?? 0,
                    cell: (row) => (row.change_given ? inr(row.change_given) : "—"),
                  },
                ]}
              />
            </section>

            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-sm font-medium">Shift history</div>
              <DataTable<CashSession>
                rows={closedSessions}
                getRowId={(row) => row.id}
                resetKey={location?.id ?? ""}
                searchPlaceholder="Search shifts…"
                emptyMessage="No closed shifts yet."
                columns={[
                  {
                    id: "opened",
                    header: "Opened",
                    accessor: (row) => row.opened_at,
                    cell: (row) =>
                      new Date(row.opened_at).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }),
                  },
                  { id: "operator", header: "By", accessor: (row) => row.opened_by },
                  {
                    id: "closed_by",
                    header: "Closed / approved by",
                    accessor: (row) =>
                      row.override_by_id
                        ? `Manager override ${row.override_by_id}`
                        : `Closed by ${row.closed_by_id ?? row.opened_by}`,
                    cell: (row) => (
                      <div>
                        <div>
                          {row.override_by_id
                            ? `Manager override · ${row.override_by_id}`
                            : row.closed_by_id
                              ? `Closed by · ${row.closed_by_id}`
                              : "Closed by operator"}
                        </div>
                        {row.override_reason && (
                          <div className="max-w-56 truncate text-xs text-muted-foreground">
                            {row.override_reason}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: "opening",
                    header: "Opening",
                    accessor: (row) => row.opening_cash,
                    cell: (row) => inr(row.opening_cash),
                  },
                  {
                    id: "sales",
                    header: "Cash sales",
                    accessor: (row) => row.cash_sales,
                    cell: (row) => inr(row.cash_sales),
                  },
                  {
                    id: "in",
                    header: "In",
                    accessor: (row) => row.cash_in,
                    cell: (row) => <span className="text-success">{inr(row.cash_in)}</span>,
                  },
                  {
                    id: "out",
                    header: "Out",
                    accessor: (row) => row.cash_out,
                    cell: (row) => <span className="text-destructive">{inr(row.cash_out)}</span>,
                  },
                  {
                    id: "closing",
                    header: "Closing",
                    accessor: (row) => row.closing_cash ?? 0,
                    cell: (row) => inr(row.closing_cash ?? 0),
                  },
                  {
                    id: "difference",
                    header: "Diff",
                    accessor: (row) =>
                      (row.closing_cash ??
                        row.opening_cash + row.cash_sales + row.cash_in - row.cash_out) -
                      (row.opening_cash + row.cash_sales + row.cash_in - row.cash_out),
                    cell: (row) => {
                      const expected =
                        row.opening_cash + row.cash_sales + row.cash_in - row.cash_out;
                      const diff = (row.closing_cash ?? expected) - expected;
                      return (
                        <span
                          className={cn(
                            "tabular-nums",
                            Math.abs(diff) > 0.01
                              ? "font-semibold text-destructive"
                              : "text-success",
                          )}
                        >
                          {inr(diff)}
                        </span>
                      );
                    },
                  },
                ]}
              />
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  icon?: typeof Banknote;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        highlight && "border-primary/40 bg-primary/5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3" /> : <Vault className="h-3 w-3" />} {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function QuickLogForm({
  locationId,
  sessionId,
  onLogged,
}: {
  locationId: string;
  sessionId: string | null;
  onLogged: () => void;
}) {
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<string>(CASH_TXN_REASONS[0]);
  const [busy, setBusy] = useState(false);

  async function log() {
    if (!locationId || busy) return;
    if (!(Number(amount) > 0)) {
      toast.error("Enter the amount");
      return;
    }
    setBusy(true);
    try {
      await logCashTxn({
        sessionId,
        locationId,
        direction,
        amount: Number(amount),
        reason,
      });
      toast.success(`Cash ${direction === "IN" ? "in" : "out"} of ${inr(Number(amount))} logged`, {
        description: reason,
      });
      setAmount("");
      onLogged();
    } catch (e) {
      toast.error("Could not log the entry", {
        description: userFacingError(e, "Check the amount and reason, then try again."),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 text-sm font-medium">Log a cash movement</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>Direction</Label>
          <SearchableSelect
            className="w-36"
            value={direction}
            onValueChange={(value) => setDirection(value as "IN" | "OUT")}
            options={[
              { value: "IN", label: "Cash In" },
              { value: "OUT", label: "Cash Out" },
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="txn-amount">Amount (₹)</Label>
          <Input
            id="txn-amount"
            type="number"
            className="w-28"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            onKeyDown={(e) => e.key === "Enter" && log()}
          />
        </div>
        <div className="space-y-1">
          <Label>Reason</Label>
          <SearchableSelect
            className="w-48"
            value={reason}
            onValueChange={setReason}
            options={CASH_TXN_REASONS.map((reasonOption) => ({
              value: reasonOption,
              label: reasonOption,
            }))}
          />
        </div>
        <Button onClick={log} disabled={busy || !sessionId}>
          {sessionId ? "Log entry" : "Open a shift first"}
        </Button>
      </div>
    </div>
  );
}

function ModeChip({ mode }: { mode: string }) {
  const icons: Record<string, typeof Banknote> = {
    CASH: Banknote,
    UPI: QrCode,
    CARD: CreditCard,
    CREDIT: Wallet,
  };
  const Icon = icons[mode] ?? Banknote;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
      <Icon className="h-3 w-3" /> {mode}
    </span>
  );
}

function OpenShiftCard({
  locationId,
  profile,
  onOpened,
}: {
  locationId: string;
  profile: UserAccessProfile | null;
  onOpened: () => void;
}) {
  const [openingCounts, setOpeningCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!locationId || !profile || busy) return;
    setBusy(true);
    try {
      await openSession({
        locationId,
        openedBy: profile.display_name,
        openedById: profile.user_id,
        openingCash: denomTotal(openingCounts),
        openingDenominations: Object.fromEntries(
          DENOMINATIONS.map((value) => [String(value), openingCounts[String(value)] ?? 0]),
        ),
      });
      toast.success("Shift opened");
      onOpened();
    } catch (e) {
      toast.error("Could not open shift", {
        description: userFacingError(e, "Refresh the cash drawer and try again."),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm">
        <div className="font-medium">Opening cash · {profile?.display_name ?? "Staff"}</div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="basis-full">
          <DenominationFields counts={openingCounts} onChange={setOpeningCounts} />
        </div>
        <Button onClick={open} disabled={busy || !profile || !locationId}>
          <LockKeyhole className="mr-1.5 h-4 w-4" /> Open shift
        </Button>
      </div>
    </div>
  );
}

function CloseShiftCard({
  session,
  expectedCash,
  cashSales,
  onClosed,
}: {
  session: CashSession;
  expectedCash: number;
  cashSales: number;
  onClosed: () => void;
}) {
  const { profile, online } = useAccess();
  const [closingCounts, setClosingCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [managerIdentifier, setManagerIdentifier] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const counted = denomTotal(closingCounts);
  const difference = counted - expectedCash;
  const isSessionOwner = session.opened_by_id === profile?.user_id;
  const managerClosingForOperator = profile?.role === "MANAGER" && !isSessionOwner;

  async function close() {
    if (busy || !profile || Object.keys(closingCounts).length === 0 || Math.abs(difference) > 0.01)
      return;
    setBusy(true);
    try {
      // cash_in / cash_out stay null — the shift already tracks them from the logged history.
      const result = await closeSession({
        sessionId: session.id,
        actorUserId: profile.user_id,
        cashIn: null,
        cashOut: null,
        countedCash: counted,
        closingDenominations: Object.fromEntries(
          DENOMINATIONS.map((value) => [String(value), closingCounts[String(value)] ?? 0]),
        ),
      });
      toast.success("Shift closed — drawer balanced", {
        description: `Cash sales ${inr(result.cash_sales)}`,
      });
      onClosed();
    } catch (e) {
      toast.error("Could not close shift", {
        description: userFacingError(e, "Check the counted cash and try closing the shift again."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function closeWithManagerOverride() {
    if (
      !online ||
      busy ||
      !managerIdentifier.trim() ||
      !managerPassword ||
      overrideReason.trim().length < 5 ||
      Object.keys(closingCounts).length === 0
    )
      return;
    setBusy(true);
    try {
      await retailApi<{ ok: boolean }>("/api/cash-session-override", {
        method: "POST",
        json: {
          session_id: session.id,
          counted_cash: counted,
          closing_denominations: Object.fromEntries(
            DENOMINATIONS.map((value) => [String(value), closingCounts[String(value)] ?? 0]),
          ),
          reason: overrideReason.trim(),
          manager_identifier: managerIdentifier.trim(),
          manager_password: managerPassword,
        },
      });
      await refreshLocalReplica();
      toast.success("Shift closed with Manager approval", { description: overrideReason.trim() });
      onClosed();
    } catch (error) {
      toast.error("Manager override could not be completed", {
        description: userFacingError(error, "Verify the Manager credentials and try again."),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <div>
          <div className="font-medium">
            Shift open since{" "}
            {new Date(session.opened_at).toLocaleString("en-IN", { timeStyle: "short" })} ·{" "}
            {session.opened_by}
          </div>
          <div className="text-muted-foreground">
            Cash sales: {inr(cashSales)} · Cash in {inr(session.cash_in)} · Cash out{" "}
            {inr(session.cash_out)}
            <span className="mt-1 block text-xs">
              Expected = opening cash + cash applied to sales + cash in − cash out.
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="basis-full">
          <DenominationFields counts={closingCounts} onChange={setClosingCounts} />
        </div>
        <div className="w-full text-sm">
          <span className="text-muted-foreground">
            Counted {inr(counted)} · expected {inr(expectedCash)}
          </span>
          {Object.keys(closingCounts).length > 0 && Math.abs(difference) > 0.01 && (
            <span className="ml-2 font-medium text-destructive">Difference {inr(difference)}</span>
          )}
        </div>
        <Button
          variant="destructive"
          onClick={close}
          disabled={
            busy ||
            !profile ||
            !isSessionOwner ||
            Object.keys(closingCounts).length === 0 ||
            Math.abs(difference) > 0.01
          }
        >
          Close shift
        </Button>
      </div>
      {Object.keys(closingCounts).length > 0 &&
        profile?.role !== "ADMIN" &&
        (Math.abs(difference) > 0.01 || managerClosingForOperator) && (
          <div className="mt-4 space-y-3 rounded-lg border border-warning/50 bg-warning/5 p-3">
            <p className="text-sm font-medium">
              {managerClosingForOperator
                ? "Manager approval is required because this shift belongs to another cashier."
                : "The counted drawer differs from expected cash. Review the opening count, cash sales, cash-in and cash-out before requesting a Manager."}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="override-manager-id">Manager email or mobile</Label>
                <Input
                  id="override-manager-id"
                  autoComplete="username"
                  value={managerIdentifier}
                  onChange={(event) => setManagerIdentifier(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="override-manager-password">Password</Label>
                <Input
                  id="override-manager-password"
                  type="password"
                  autoComplete="current-password"
                  value={managerPassword}
                  onChange={(event) => setManagerPassword(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="override-reason">Reason for variance</Label>
              <Input
                id="override-reason"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Describe the cash difference"
              />
            </div>
            <Button
              onClick={closeWithManagerOverride}
              disabled={
                !online ||
                busy ||
                !managerIdentifier.trim() ||
                !managerPassword ||
                overrideReason.trim().length < 5 ||
                Object.keys(closingCounts).length === 0
              }
            >
              {online ? "Manager override & close" : "Reconnect to request approval"}
            </Button>
          </div>
        )}
    </div>
  );
}

function DenominationFields({
  counts,
  onChange,
}: {
  counts: Record<string, number>;
  onChange: (counts: Record<string, number>) => void;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between text-sm font-medium">
        <span>Notes & coins count</span>
        <span className="tabular-nums">Total {inr(denomTotal(counts))}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {DENOMINATIONS.map((value) => (
          <label key={value} className="space-y-1 text-xs text-muted-foreground">
            <span>₹{value}</span>
            <Input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              aria-label={`Count of ₹${value} notes or coins`}
              className="h-9 text-right tabular-nums"
              value={counts[String(value)] ?? ""}
              onChange={(event) =>
                onChange({
                  ...counts,
                  [value]: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}
