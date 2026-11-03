import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CreditCard, LockKeyhole, QrCode, Vault, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppNav } from "@/components/pos/app-nav";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  closeSession,
  inr,
  openSession,
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
        content: "Open and close cash drawer shifts with automatic cash sales reconciliation.",
      },
      { property: "og:title", content: "RetailHub POS — Cash Drawer" },
      {
        property: "og:description",
        content: "Open and close cash drawer shifts with automatic cash sales reconciliation.",
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
  const { data: locations = [] } = useLocations();
  const [locationId, setLocationId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "");
  const location = locations.find((l) => l.id === locationId) ?? locations[0];

  const [view, setView] = useState<"express" | "detailed">("express");

  const { data: sessions = [] } = useQuery<CashSession[]>({
    enabled: !!location?.id,
    queryKey: ["cash-sessions", location?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_drawer_sessions")
        .select("*")
        .eq("location_id", location!.id)
        .order("opened_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as CashSession[];
    },
  });

  const open = sessions.find((s) => s.status === "OPEN");
  const since = open?.opened_at ?? startOfToday();
  const { data: payments = [] } = usePaymentsSince(location?.id ?? null, since);

  const byMode = useMemo(() => {
    const map: Record<string, number> = { CASH: 0, UPI: 0, CARD: 0, CREDIT: 0 };
    for (const p of payments) map[p.mode] = (map[p.mode] ?? 0) + p.amount;
    return map;
  }, [payments]);

  const expectedCash = open
    ? open.opening_cash + byMode.CASH + open.cash_in - open.cash_out
    : 0;

  function pickLocation(id: string) {
    setLocationId(id);
    localStorage.setItem(LS_KEY, id);
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav active="/cash-drawer" />
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Select value={location?.id ?? ""} onValueChange={pickLocation}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} ({l.type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                  <SummaryCard
                    label="Expected in drawer"
                    value={inr(expectedCash)}
                    highlight
                  />
                  <SummaryCard
                    label={`Other modes today`}
                    value={inr(byMode.UPI + byMode.CARD + byMode.CREDIT)}
                  />
                </div>
                <CloseShiftCard
                  session={open}
                  expectedCash={expectedCash}
                  cashSales={byMode.CASH}
                  onClosed={() => {
                    void queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
                    void queryClient.invalidateQueries({ queryKey: ["payments-since"] });
                  }}
                />
              </>
            ) : (
              <OpenShiftCard
                locationId={location?.id ?? ""}
                cashSalesToday={byMode.CASH}
                onOpened={() => {
                  void queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
                  void queryClient.invalidateQueries({ queryKey: ["payments-since"] });
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="detailed" className="mt-3 space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryCard label="Cash" value={inr(byMode.CASH)} />
              <SummaryCard label="UPI" value={inr(byMode.UPI)} />
              <SummaryCard label="Card" value={inr(byMode.CARD)} />
              <SummaryCard label="Credit" value={inr(byMode.CREDIT)} />
            </div>

            <section className="rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-sm font-medium">
                Payments since {new Date(since).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            <section className="rounded-lg border bg-card">
              <div className="border-b px-3 py-2 text-sm font-medium">Shift history</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Opened</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Cash sales</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.filter((s) => s.status === "CLOSED").length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No closed shifts yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {sessions
                    .filter((s) => s.status === "CLOSED")
                    .map((s) => {
                      const expected =
                        s.opening_cash + s.cash_sales + s.cash_in - s.cash_out;
                      const diff = (s.closing_cash ?? expected) - expected;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs">
                            {new Date(s.opened_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                          </TableCell>
                          <TableCell>{s.opened_by}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(s.opening_cash)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(s.cash_sales)}</TableCell>
                          <TableCell className="text-right tabular-nums">{inr(s.closing_cash ?? 0)}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              Math.abs(diff) > 0.01 ? "font-semibold text-destructive" : "text-success",
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

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        highlight && "border-primary/40 bg-primary/5",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
        <Vault className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
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
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!locationId || busy) return;
    setBusy(true);
    try {
      await openSession({
        locationId,
        openedBy: operator.trim() || "Operator",
        openingCash: Number(openingCash) || 0,
      });
      toast.success("Shift opened");
      onOpened();
    } catch (e) {
      toast.error("Could not open shift", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm">
        <div className="font-medium">No open shift</div>
        <div className="text-muted-foreground">
          Cash sales today so far (no shift): {inr(cashSalesToday)}. Open a shift to start
          drawer reconciliation.
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="op-name">Operator</Label>
          <Input id="op-name" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Name" />
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
  const [cashIn, setCashIn] = useState("");
  const [cashOut, setCashOut] = useState("");
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);

  async function close() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await closeSession({
        sessionId: session.id,
        cashIn: Number(cashIn) || 0,
        cashOut: Number(cashOut) || 0,
        countedCash: counted === "" ? null : Number(counted),
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
      toast.error("Could not close shift", { description: String(e) });
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
          <div className="text-muted-foreground">Cash sales: {inr(cashSales)}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="cash-in">Cash in (₹)</Label>
          <Input id="cash-in" type="number" value={cashIn} onChange={(e) => setCashIn(e.target.value)} placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cash-out">Cash out (₹)</Label>
          <Input id="cash-out" type="number" value={cashOut} onChange={(e) => setCashOut(e.target.value)} placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="counted">Counted cash (₹)</Label>
          <Input
            id="counted"
            type="number"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder={String(expectedCash.toFixed(2))}
          />
        </div>
        <Button variant="destructive" onClick={close} disabled={busy}>
          Close shift
        </Button>
      </div>
    </div>
  );
}
