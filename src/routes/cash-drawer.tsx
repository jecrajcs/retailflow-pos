import { useMemo, useState } from "react";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { canAccessLocation, saveActiveLocation, useAccess } from "@/lib/access";
import { userFacingError } from "@/lib/retail-api";
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
  useLocations,
  usePaymentsSince,
  type CashSession,
} from "@/lib/pos";

export const Route = createFileRoute("/cash-drawer")({
  head: () => ({
    meta: [
      { title: "RetailHub POS — Cash Drawer" },
      {
        name: "description",
        content:
          "Open and close cash drawer shifts with a full cash in/out history — shop expenses, tea & snacks, vendor payments, change top-ups and reconciliation.",
      },
      { property: "og:title", content: "RetailHub POS — Cash Drawer" },
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
  const allowedLocations = locations.filter((entry) => canAccessLocation(profile, entry.id));
  const [locationId, setLocationId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "");
  const location = allowedLocations.find((l) => l.id === locationId) ?? allowedLocations[0];

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

  const open = sessions.find((s) => s.status === "OPEN");
  const since = open?.opened_at ?? startOfToday();
  const { data: payments = [] } = usePaymentsSince(location?.id ?? null, since);
  const { data: txns = [] } = useCashTransactions(location?.id ?? null, since);

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
    <div className="flex min-h-screen flex-col bg-background">
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

      <main className="mx-auto w-full max-w-[1100px] flex-1 p-3">
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList>
            <TabsTrigger value="express">Express</TabsTrigger>
            <TabsTrigger value="detailed">Detailed</TabsTrigger>
          </TabsList>

          <TabsContent value="express" className="mt-3 space-y-3">
            {open ? (
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
            ) : (
              <OpenShiftCard
                locationId={location?.id ?? ""}
                cashSalesToday={byMode.CASH}
                onOpened={refresh}
              />
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
              <div className="max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txns.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          No cash in/out events logged yet today.
                        </TableCell>
                      </TableRow>
                    )}
                    {txns.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs">
                          {new Date(t.created_at).toLocaleString("en-IN", { timeStyle: "short" })}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                              t.direction === "IN"
                                ? "bg-success/15 text-success"
                                : "bg-destructive/15 text-destructive",
                            )}
                          >
                            {t.direction === "IN" ? (
                              <ArrowDownCircle className="h-3 w-3" />
                            ) : (
                              <ArrowUpCircle className="h-3 w-3" />
                            )}
                            {t.direction === "IN" ? "Cash In" : "Cash Out"}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{t.reason}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium tabular-nums",
                            t.direction === "IN" ? "text-success" : "text-destructive",
                          )}
                        >
                          {t.direction === "IN" ? "+" : "−"} {inr(t.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-sm font-medium">
                Payments since{" "}
                {new Date(since).toLocaleString("en-IN", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </div>
              <div className="max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Change returned</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          No payments yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">
                          {new Date(p.created_at).toLocaleString("en-IN", { timeStyle: "short" })}
                        </TableCell>
                        <TableCell>
                          <ModeChip mode={p.mode} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{inr(p.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.change_given ? inr(p.change_given) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-sm font-medium">Shift history</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Opened</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Cash sales</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.filter((s) => s.status === "CLOSED").length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No closed shifts yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {sessions
                    .filter((s) => s.status === "CLOSED")
                    .map((s) => {
                      const expected = s.opening_cash + s.cash_sales + s.cash_in - s.cash_out;
                      const diff = (s.closing_cash ?? expected) - expected;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs">
                            {new Date(s.opened_at).toLocaleString("en-IN", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </TableCell>
                          <TableCell>{s.opened_by}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {inr(s.opening_cash)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {inr(s.cash_sales)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-success">
                            {inr(s.cash_in)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-destructive">
                            {inr(s.cash_out)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {inr(s.closing_cash ?? 0)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              Math.abs(diff) > 0.01
                                ? "font-semibold text-destructive"
                                : "text-success",
                            )}
                          >
                            {inr(diff)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
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
  cashSalesToday,
  onOpened,
}: {
  locationId: string;
  cashSalesToday: number;
  onOpened: () => void;
}) {
  const [operator, setOperator] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [openingCounts, setOpeningCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!locationId || busy) return;
    setBusy(true);
    try {
      await openSession({
        locationId,
        openedBy: operator.trim() || "Operator",
        openingCash: denomTotal(openingCounts) || Number(openingCash) || 0,
        openingDenominations: openingCounts,
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
        <div className="font-medium">No open shift</div>
        <div className="text-muted-foreground">
          Cash sales today so far (no shift): {inr(cashSalesToday)}. Open a shift to start drawer
          reconciliation and cash in/out logging.
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="op-name">Operator</Label>
          <Input
            id="op-name"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="Name"
          />
        </div>
        <div className="basis-full">
          <DenominationFields
            counts={openingCounts}
            onChange={(counts) => {
              setOpeningCounts(counts);
              setOpeningCash(String(denomTotal(counts)));
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="op-cash">Opening cash (₹)</Label>
          <Input
            id="op-cash"
            type="number"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            placeholder="0"
          />
        </div>
        <Button onClick={open} disabled={busy}>
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
  const [counted, setCounted] = useState("");
  const [closingCounts, setClosingCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  async function close() {
    if (busy) return;
    setBusy(true);
    try {
      // cash_in / cash_out stay null — the shift already tracks them from the logged history.
      const result = await closeSession({
        sessionId: session.id,
        cashIn: null,
        cashOut: null,
        countedCash: Object.keys(closingCounts).length
          ? denomTotal(closingCounts)
          : counted === ""
            ? null
            : Number(counted),
        closingDenominations: closingCounts,
      });
      const diff = result.difference;
      if (Math.abs(diff) > 0.01) {
        toast.warning(`Shift closed — difference ${inr(diff)}`, {
          description: `Expected ${inr(result.expected_cash)} in drawer.`,
        });
      } else {
        toast.success("Shift closed — drawer balanced", {
          description: `Cash sales ${inr(result.cash_sales)}`,
        });
      }
      onClosed();
    } catch (e) {
      toast.error("Could not close shift", {
        description: userFacingError(e, "Check the counted cash and try closing the shift again."),
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
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="counted">Counted cash (₹)</Label>
          <Input
            id="counted"
            type="number"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder={String(expectedCash.toFixed(2))}
            onKeyDown={(e) => e.key === "Enter" && close()}
          />
        </div>
        <div className="basis-full">
          <DenominationFields
            counts={closingCounts}
            onChange={(counts) => {
              setClosingCounts(counts);
              setCounted(String(denomTotal(counts)));
            }}
          />
        </div>
        <Button variant="destructive" onClick={close} disabled={busy}>
          Close shift
        </Button>
      </div>
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
              inputMode="numeric"
              aria-label={`Count of ₹${value} notes or coins`}
              className="h-9 text-right tabular-nums"
              value={counts[String(value)] ?? ""}
              onChange={(event) =>
                onChange({ ...counts, [value]: Math.max(0, Number(event.target.value) || 0) })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}
