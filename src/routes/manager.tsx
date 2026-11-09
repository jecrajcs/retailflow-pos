import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Download,
  FileSpreadsheet,
  PackageMinus,
  Tag,
  Upload,
  UserRoundCog,
  Zap,
  CircleAlert,
  Copy,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { AppNav } from "@/components/pos/app-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StaffAccessPanel } from "@/components/pos/staff-access-panel";
import {
  createAdjustment,
  createTransfer,
  addCustomer,
  quickAddProduct,
  legacyStockSet,
  inr,
  exportSheets,
  parseWorkbookFile,
  pickField,
  formatPriceTiers,
  parsePriceTiers,
  REASONS,
  receiveTransfer,
  setTransferStatus,
  updateProductProfile,
  updateCustomer,
  matchesSearchFields,
  useStockTransfers,
  useTransferItems,
  useStockAdjustments,
  useCustomers,
  useSales,
  useShortcutTiles,
  saveShortcutTiles,
  useLocations,
  useInventory,
  useProducts,
  useSyncAlerts,
  type Product,
} from "@/lib/pos";
import { canAccessLocation, saveActiveLocation, useAccess } from "@/lib/access";
import { retailApi, userFacingError } from "@/lib/retail-api";
import { refreshLocalReplica } from "@/lib/offline-sync";

export const Route = createFileRoute("/manager")({
  head: () => ({
    meta: [
      { title: "RetailHub POS — Manager" },
      {
        name: "description",
        content: "Catalog enrichment queue, stock transfer requests and damage/expiry write-offs.",
      },
      { property: "og:title", content: "RetailHub POS — Manager" },
      {
        property: "og:description",
        content: "Catalog enrichment queue, stock transfer requests and damage/expiry write-offs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ManagerPage,
});

const LS_KEY = "pos-location-id";

interface TransferItemRow {
  id: string;
  transfer_id: string;
  product_id: string;
  quantity: number;
  products?: { name: string } | null;
}

interface AdjustmentRow {
  id: string;
  product_id: string;
  location_id: string;
  quantity: number;
  reason: string;
  returnable_to_vendor: boolean;
  cost_loss: number;
  created_at: string;
  products?: { name: string } | null;
  locations?: { name: string } | null;
}

function ManagerPage() {
  const queryClient = useQueryClient();
  const { profile } = useAccess();
  const { data: locations = [] } = useLocations();
  const { data: products = [] } = useProducts();
  const allowedLocations = locations.filter((item) => canAccessLocation(profile, item.id));
  const [locationId, setLocationId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? "");
  const location = allowedLocations.find((l) => l.id === locationId) ?? allowedLocations[0];
  const { data: allTransfers = [] } = useStockTransfers();
  const { data: allTransferItems = [] } = useTransferItems();
  const { data: allAdjustments = [] } = useStockAdjustments();
  const { data: customers = [] } = useCustomers();
  const { data: sales = [] } = useSales();
  const { data: shortcutRows = [] } = useShortcutTiles();
  const { data: syncAlerts = [] } = useSyncAlerts();
  const transfers = allTransfers.filter(
    (row) =>
      canAccessLocation(profile, row.from_location_id) ||
      canAccessLocation(profile, row.to_location_id),
  );
  const transferItems: TransferItemRow[] = allTransferItems.map((item) => ({
    ...item,
    products: { name: products.find((product) => product.id === item["product_id"])?.name ?? "?" },
  })) as TransferItemRow[];
  const adjustments: AdjustmentRow[] = allAdjustments
    .filter((row) => canAccessLocation(profile, String(row["location_id"])))
    .map((row) => ({
      ...row,
      products: { name: products.find((product) => product.id === row["product_id"])?.name ?? "—" },
      locations: { name: locations.find((entry) => entry.id === row["location_id"])?.name ?? "—" },
    })) as AdjustmentRow[];

  const locName = (id: string) =>
    canAccessLocation(profile, id)
      ? (locations.find((l) => l.id === id)?.name ?? "—")
      : "Restricted location";

  const statusMut = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "dispatch" | "receive" }) => {
      if (action === "dispatch") await setTransferStatus(id, "IN_TRANSIT");
      else await receiveTransfer(id);
    },
    onSuccess: (_, vars) => {
      toast.success(vars.action === "dispatch" ? "Marked in transit" : "Stock received");
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["transfer-items"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e) =>
      toast.error("Action failed", {
        description: userFacingError(e, "The inventory action could not be completed."),
      }),
  });

  const adjustMut = useMutation({
    mutationFn: createAdjustment,
    onSuccess: () => {
      toast.success("Write-off recorded");
      void queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e) =>
      toast.error("Write-off failed", {
        description: userFacingError(e, "The stock write-off could not be completed."),
      }),
  });

  const totalLoss = useMemo(() => adjustments.reduce((s, a) => s + a.cost_loss, 0), [adjustments]);

  if (profile?.role !== "MANAGER")
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <AppNav active="/manager" />
        <main className="m-auto max-w-lg rounded-xl border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">
            {profile?.role === "ADMIN" ? "Use the Admin console" : "Manager access required"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {profile?.role === "ADMIN"
              ? "Network-wide administration has a separate workspace."
              : "This account cannot access store management tools."}
          </p>
          {profile?.role === "ADMIN" && (
            <Button asChild className="mt-4">
              <Link to="/admin">Open Admin console</Link>
            </Button>
          )}
        </main>
      </div>
    );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav active="/manager" />
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <SearchableSelect
          className="w-64"
          value={location?.id ?? ""}
          onValueChange={(id) => {
            setLocationId(id);
            saveActiveLocation(id);
          }}
          placeholder="Select store"
          options={allowedLocations.map((l) => ({
            value: l.id,
            label: `${l.name} (${l.type})`,
            keywords: [l.code],
          }))}
        />
      </div>

      <main className="mx-auto w-full max-w-[1200px] flex-1 p-3">
        <Tabs defaultValue="enrichment">
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="enrichment" className="gap-1.5">
              <Tag className="h-3.5 w-3.5" /> Catalog Queue
            </TabsTrigger>
            <TabsTrigger value="transfers" className="gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5" /> Stock Transfers
            </TabsTrigger>
            <TabsTrigger value="writeoffs" className="gap-1.5">
              <PackageMinus className="h-3.5 w-3.5" /> Damage / Expiry
            </TabsTrigger>
            <TabsTrigger value="spreadsheets" className="gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Spreadsheets
            </TabsTrigger>
            <TabsTrigger value="customers" className="gap-1.5">
              <UserRoundCog className="h-3.5 w-3.5" /> Customer profiles
            </TabsTrigger>
            <TabsTrigger value="shortcuts" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Cashier shortcuts
            </TabsTrigger>
            {profile?.role === "MANAGER" && (
              <TabsTrigger value="staff" className="gap-1.5">
                <UserRoundCog className="h-3.5 w-3.5" /> Cashier access
              </TabsTrigger>
            )}
            <TabsTrigger value="sync-alerts" className="gap-1.5">
              <CircleAlert className="h-3.5 w-3.5" /> Sync alerts
              {syncAlerts.filter((alert) => !alert.resolved_at).length
                ? ` (${syncAlerts.filter((alert) => !alert.resolved_at).length})`
                : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="enrichment" className="mt-3">
            <EnrichmentQueue
              products={products.filter((p) => p.enrichment_status !== "COMPLETE")}
            />
          </TabsContent>

          <TabsContent value="transfers" className="mt-3 space-y-3">
            <NewTransferCard
              locations={allowedLocations}
              products={products}
              defaultFromId={allowedLocations.find((l) => l.type === "WAREHOUSE")?.id ?? ""}
              onCreated={() => void queryClient.invalidateQueries({ queryKey: ["transfers"] })}
            />
            <section className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No transfers yet. POS indents land here.
                      </TableCell>
                    </TableRow>
                  )}
                  {transfers.map((t) => {
                    const items = transferItems.filter((i) => i.transfer_id === t.id);
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs">
                          {new Date(t.created_at).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </TableCell>
                        <TableCell className="text-xs">
                          {locName(t.from_location_id)} → {locName(t.to_location_id)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {items
                            .map((i) => `${i.products?.name ?? "?"} ×${i.quantity}`)
                            .join(", ") || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              t.status === "REQUESTED" && "border-amber-500/50 text-amber-600",
                              t.status === "IN_TRANSIT" && "border-blue-500/50 text-blue-600",
                              t.status === "RECEIVED" && "border-success/50 text-success",
                            )}
                          >
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {t.status === "REQUESTED" &&
                            canAccessLocation(profile, t.from_location_id) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={statusMut.isPending}
                                onClick={() => statusMut.mutate({ id: t.id, action: "dispatch" })}
                              >
                                Dispatch
                              </Button>
                            )}
                          {t.status === "IN_TRANSIT" &&
                            canAccessLocation(profile, t.to_location_id) && (
                              <Button
                                size="sm"
                                disabled={statusMut.isPending}
                                onClick={() => statusMut.mutate({ id: t.id, action: "receive" })}
                              >
                                Receive
                              </Button>
                            )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          </TabsContent>

          <TabsContent value="writeoffs" className="mt-3 space-y-3">
            <NewWriteOffCard
              locations={allowedLocations}
              products={products}
              locationId={location?.id ?? ""}
              busy={adjustMut.isPending}
              onSubmit={(input) => adjustMut.mutate(input)}
            />
            <div className="text-sm text-muted-foreground">
              Total cost loss in last {adjustments.length} write-offs:{" "}
              <b className="text-destructive">{inr(totalLoss)}</b>
            </div>
            <section className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Returnable</TableHead>
                    <TableHead className="text-right">Cost loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No write-offs recorded.
                      </TableCell>
                    </TableRow>
                  )}
                  {adjustments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">
                        {new Date(a.created_at).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell>{a.products?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs">{a.locations?.name ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{a.quantity}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.reason}</Badge>
                      </TableCell>
                      <TableCell>{a.returnable_to_vendor ? "Yes" : "No"}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">
                        {inr(a.cost_loss)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </TabsContent>
          <TabsContent value="spreadsheets" className="mt-3">
            <SpreadsheetTools
              products={products}
              locations={allowedLocations}
              locationId={location?.id ?? ""}
            />
          </TabsContent>
          <TabsContent value="customers" className="mt-3">
            <CustomerManagement customers={customers} />
          </TabsContent>
          <TabsContent value="shortcuts" className="mt-3">
            <ShortcutTileManager
              locations={allowedLocations}
              products={products}
              shortcutRows={shortcutRows}
              defaultLocationId={location?.id ?? ""}
            />
          </TabsContent>
          {profile?.role === "MANAGER" && (
            <TabsContent value="staff" className="mt-3">
              <StaffAccessPanel mode="manager" locations={allowedLocations} />
            </TabsContent>
          )}
          <TabsContent value="sync-alerts" className="mt-3">
            <SyncAlertList
              alerts={syncAlerts.filter((alert) => canAccessLocation(profile, alert.location_id))}
              locations={locations}
              products={products}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SyncAlertList({
  alerts,
  locations,
  products,
}: {
  alerts: Array<{
    id: string;
    operation_id: string;
    product_id: string;
    location_id: string;
    resulting_quantity: number;
    message: string;
    resolved_at: string | null;
    created_at: string;
  }>;
  locations: Array<{ id: string; name: string; code: string }>;
  products: Product[];
}) {
  const { online } = useAccess();
  const activeAlerts = alerts
    .filter((alert) => !alert.resolved_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  async function resolve(alertId: string) {
    try {
      await retailApi<{ ok: boolean }>("/api/resolve-sync-alert", {
        method: "POST",
        json: { alert_id: alertId },
      });
      await refreshLocalReplica();
      toast.success("Alert marked reviewed");
    } catch (error) {
      toast.error("Could not update alert", {
        description: userFacingError(error, "Refresh the alert list and try again."),
      });
    }
  }
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-semibold">Inventory sync discrepancies</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Offline bills stay saved. These alerts flag stock that went below zero when devices
          reconciled their local snapshots.
        </p>
      </div>
      {activeAlerts.map((alert) => (
        <article
          key={alert.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 p-3"
        >
          <div className="flex gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium">
                {products.find((product) => product.id === alert.product_id)?.name ??
                  "Unknown product"}{" "}
                ·{" "}
                {locations.find((location) => location.id === alert.location_id)?.name ??
                  "Location"}
              </p>
              <p className="text-sm text-muted-foreground">{alert.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Resulting server stock: {alert.resulting_quantity} ·{" "}
                {new Date(alert.created_at).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="destructive">Review needed</Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={!online}
              onClick={() => void resolve(alert.id)}
            >
              Mark reviewed
            </Button>
          </div>
        </article>
      ))}
      {!activeAlerts.length && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No unresolved stock sync alerts.
        </p>
      )}
    </section>
  );
}

type ManagedStaff = {
  user_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: "CASHIER" | "MANAGER" | "ADMIN";
  is_active: boolean;
  location_ids: string[];
  has_login: boolean;
};

export function AdminStaffAccess({
  locations,
}: {
  locations: Array<{ id: string; name: string; code: string }>;
}) {
  const { online, profile } = useAccess();
  const [staff, setStaff] = useState<ManagedStaff[]>([]);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<ManagedStaff["role"]>("CASHIER");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCredential, setNewCredential] = useState<{
    user_id: string;
    login: string;
    temporary_password: string;
  } | null>(null);

  const loadStaff = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    try {
      const { staff: members } = await retailApi<{ staff: ManagedStaff[] }>("/api/staff");
      setStaff(members);
    } catch (error) {
      toast.error("Could not load staff access", {
        description: userFacingError(error, "Refresh staff access and try again."),
      });
    } finally {
      setLoading(false);
    }
  }, [online]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  function editMember(member: ManagedStaff) {
    setNewCredential(null);
    setUserId(member.user_id);
    setDisplayName(member.display_name);
    setEmail(member.email ?? "");
    setPhone(member.phone ?? "");
    setRole(member.role);
    setLocationIds(member.location_ids);
    setActive(member.is_active);
  }

  function startNew() {
    setNewCredential(null);
    setUserId("");
    setDisplayName("");
    setEmail("");
    setPhone("");
    setRole("CASHIER");
    setLocationIds([]);
    setActive(true);
  }

  async function saveMember(resetPassword = false) {
    const normalizedId = userId.trim();
    if (!displayName.trim()) {
      toast.error("Enter a staff display name.");
      return;
    }
    if (role !== "ADMIN" && locationIds.length === 0) {
      toast.error("Assign at least one location to this staff member.");
      return;
    }
    if (!normalizedId && !email.trim() && !phone.trim()) {
      toast.error("Enter an email address or mobile number for sign-in.");
      return;
    }
    setSaving(true);
    try {
      const result = await retailApi<{
        user_id: string;
        login: string | null;
        temporary_password?: string;
      }>("/api/staff", {
        method: "POST",
        json: {
          user_id: normalizedId || null,
          display_name: displayName.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          role,
          location_ids: locationIds,
          is_active: active,
          reset_password: resetPassword,
        },
      });
      if (result.temporary_password) {
        setNewCredential({
          user_id: result.user_id,
          login: result.login ?? (email.trim() || phone.trim()),
          temporary_password: result.temporary_password,
        });
      }
      toast.success(
        resetPassword
          ? "Temporary password created; the staff member must change it at sign-in"
          : normalizedId
            ? "Staff role and location access saved"
            : "Staff login created and activated",
      );
      if (resetPassword && result.user_id === profile?.user_id) {
        window.dispatchEvent(new CustomEvent("retailflow:session-change"));
        return;
      }
      setUserId(result.user_id);
      await loadStaff();
    } catch (error) {
      toast.error("Could not save staff access", {
        description: userFacingError(error, "Check the staff details and try again."),
      });
    } finally {
      setSaving(false);
    }
  }

  if (profile?.role !== "ADMIN") return null;
  return (
    <section className="space-y-4">
      <div className="rounded-xl border bg-primary/5 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <UserPlus className="h-4 w-4" /> Staff login setup
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Staff credentials and sessions are managed by RetailFlow. Create accounts here with an
          email and/or mobile number. A temporary password appears once and must be changed at first
          sign-in; it is never stored in the staff profile.
        </p>
      </div>
      {newCredential && (
        <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <strong>One-time login credentials — share securely now</strong>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `Login: ${newCredential.login}\nTemporary password: ${newCredential.temporary_password}`,
                )
              }
            >
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy
            </Button>
          </div>
          <p>
            Login: <span className="font-mono">{newCredential.login}</span>
          </p>
          <p>
            Temporary password:{" "}
            <span className="font-mono font-semibold">{newCredential.temporary_password}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            This password is shown only in this creation screen. The new user must change it before
            RetailFlow opens.
          </p>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{userId ? "Edit staff access" : "Create staff login"}</h3>
            <Button variant="outline" size="sm" onClick={startNew}>
              New assignment
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Cashier name"
              />
            </Field>
            {!userId && (
              <>
                <Field label="Email (optional if mobile is given)">
                  <Input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="cashier@example.com"
                  />
                </Field>
                <Field label="Mobile number (optional if email is given)">
                  <Input
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+91 98765 43210"
                  />
                </Field>
              </>
            )}
            <Field label="Role">
              <SearchableSelect
                value={role}
                onValueChange={(value) => setRole(value as ManagedStaff["role"])}
                options={[
                  { value: "CASHIER", label: "Cashier" },
                  { value: "MANAGER", label: "Manager" },
                  { value: "ADMIN", label: "Admin / Owner" },
                ]}
              />
            </Field>
            {userId && (
              <label className="flex items-center gap-2 self-end rounded-lg border p-3 text-sm">
                <Checkbox
                  checked={active}
                  onCheckedChange={(checked) => setActive(checked === true)}
                />{" "}
                Active sign-in
              </label>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Assigned locations</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {locations.map((location) => (
                <label
                  key={location.id}
                  className="flex items-center gap-2 rounded-lg border p-2 text-sm"
                >
                  <Checkbox
                    checked={locationIds.includes(location.id)}
                    onCheckedChange={(checked) =>
                      setLocationIds((current) =>
                        checked === true
                          ? [...new Set([...current, location.id])]
                          : current.filter((id) => id !== location.id),
                      )
                    }
                  />
                  {location.name}
                  <span className="ml-auto text-xs text-muted-foreground">{location.code}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Admins can access all locations. Cashiers and Managers see only their assignments.
            </p>
          </div>
          <Button onClick={() => void saveMember()} disabled={!online || saving}>
            {saving ? "Saving…" : userId ? "Update staff access" : "Create active login"}
          </Button>
          {userId && (
            <Button
              variant="outline"
              onClick={() => void saveMember(true)}
              disabled={!online || saving}
            >
              {saving ? "Working…" : "Reset staff password"}
            </Button>
          )}
          {!online && (
            <p className="text-xs text-warning">
              Staff permissions require an online Admin sync. POS sales remain available offline.
            </p>
          )}
        </div>
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Current staff</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadStaff()}
              disabled={!online || loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
          {staff.map((member) => (
            <button
              key={member.user_id}
              onClick={() => editMember(member)}
              className="w-full rounded-lg border p-3 text-left hover:bg-accent/40"
            >
              <span className="flex items-center justify-between gap-2">
                <b>{member.display_name}</b>
                <Badge variant={member.is_active ? "outline" : "destructive"}>
                  {member.is_active ? member.role : "INACTIVE"}
                </Badge>
              </span>
              <span className="mt-1 block break-all text-xs text-muted-foreground">
                {member.email ?? member.phone ?? member.user_id}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {member.role === "ADMIN"
                  ? "All locations"
                  : member.location_ids
                      .map((id) => locations.find((location) => location.id === id)?.name ?? id)
                      .join(", ") || "No assigned locations"}
              </span>
            </button>
          ))}
          {!staff.length && (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {online
                ? "No staff profile assignments found. Bootstrap the first Admin using the setup guide."
                : "Staff list is not available offline."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SpreadsheetTools({
  products,
  locations,
  locationId,
}: {
  products: Product[];
  locations: Array<{ id: string; name: string; code: string; type: string }>;
  locationId: string;
}) {
  const { data: inventory = [] } = useInventory();
  const { data: customers = [] } = useCustomers();
  const { data: sales = [] } = useSales();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"products" | "customers" | "stock">("products");
  const [busy, setBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewName, setPreviewName] = useState("");
  const [rowIssues, setRowIssues] = useState<Array<{ row: number; issue: string }>>([]);

  async function downloadTemplate(template: "products" | "customers" | "stock") {
    const examples: Record<typeof template, Record<string, unknown>> = {
      products: {
        name: "Sample item",
        name_hi: "नमूना सामान",
        search_aliases: "sample|namuna",
        sku: "SKU-001",
        barcode: "8900000000000",
        category: "Grocery",
        variant: "1kg",
        hsn: "",
        purchase_cost: 50,
        mrp: 75,
        sale_price: 70,
        min_sale_price: 60,
        price_tiers: "6:68, 12:64",
        min_stock: 5,
        uom_purchase: "Pcs",
        uom_stock: "Pcs",
        uom_sale: "Pcs",
        rack_location: "Rack S1",
      },
      customers: {
        name: "Customer name",
        mobile: "",
        age_group: "Adult",
        gender: "",
        credit_limit: 0,
        outstanding_balance: 0,
        visits: 0,
      },
      stock: { sku: "SKU-001", location_code: "OUTLET1", quantity_on_hand: 10 },
    };
    try {
      await exportSheets(`retailhub-${template}-template.xlsx`, [
        { name: template, rows: [examples[template]] },
      ]);
    } catch (error) {
      toast.error("Template download failed", {
        description: userFacingError(error, "Check the spreadsheet and try importing it again."),
      });
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const sheets = await parseWorkbookFile(file);
      const rows = sheets.flatMap((sheet) => sheet.rows);
      setPreviewRows(rows);
      setPreviewName(file.name);
      setRowIssues(validateRows(rows));
      toast.success(`${rows.length} rows ready to review`, {
        description: "Nothing is imported until you confirm the preview.",
      });
    } catch (error) {
      toast.error("Spreadsheet import failed", {
        description: userFacingError(
          error,
          "Check the file format and required columns, then try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  const validateRows = useCallback(
    (rows: Array<Record<string, unknown>>) => {
      const issues: Array<{ row: number; issue: string }> = [];
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        if (kind === "products") {
          const name = String(pickField(row, ["name", "productname", "item"]) ?? "").trim();
          const sku = String(pickField(row, ["sku", "productsku"]) ?? "").trim();
          const barcode = String(pickField(row, ["barcode", "ean"]) ?? "").trim();
          if (!name) issues.push({ row: index + 2, issue: "Product name is required." });
          if (!(Number(pickField(row, ["saleprice", "sellingprice"])) > 0))
            issues.push({ row: index + 2, issue: "Sale price must be greater than zero." });
          try {
            const tiers = parsePriceTiers(
              pickField(row, ["pricetiers", "quantitytiers", "wholesaleprices"]),
            );
            const retailPrice = Number(pickField(row, ["saleprice", "sellingprice"])) || 0;
            const floorPrice = Number(pickField(row, ["minsaleprice", "floorprice"])) || 0;
            if (tiers.some((tier) => tier.unit_price < floorPrice || tier.unit_price > retailPrice))
              issues.push({
                row: index + 2,
                issue: "Quantity prices must be between minimum allowed price and retail price.",
              });
          } catch (error) {
            issues.push({
              row: index + 2,
              issue: userFacingError(error, "Enter valid quantity prices."),
            });
          }
          const duplicate = products.some(
            (product) =>
              (sku && product.sku?.toLowerCase() === sku.toLowerCase()) ||
              (barcode && product.barcode === barcode),
          );
          const fingerprint = sku
            ? `sku:${sku.toLowerCase()}`
            : barcode
              ? `barcode:${barcode}`
              : "";
          if (duplicate || (fingerprint && seen.has(fingerprint)))
            issues.push({ row: index + 2, issue: "Duplicate SKU or barcode." });
          if (fingerprint) seen.add(fingerprint);
        } else if (kind === "customers") {
          const name = String(pickField(row, ["name", "customername"]) ?? "").trim();
          const mobile = String(pickField(row, ["mobile", "phone", "phonenumber"]) ?? "").trim();
          if (!name) issues.push({ row: index + 2, issue: "Customer name is required." });
          const duplicate = customers.some(
            (customer) =>
              customer.name.trim().toLowerCase() === name.toLowerCase() &&
              (customer.mobile ?? "") === mobile,
          );
          const fingerprint = `${name.toLowerCase()}|${mobile}`;
          if ((mobile && duplicate) || (mobile && seen.has(fingerprint)))
            issues.push({
              row: index + 2,
              issue:
                "Exact customer name and phone already exist. Different family members sharing a phone are allowed.",
            });
          if (mobile) seen.add(fingerprint);
        } else {
          const sku = String(pickField(row, ["sku", "productsku", "barcode"]) ?? "").trim();
          const code = String(pickField(row, ["locationcode", "location"]) ?? "").trim();
          const product = products.find(
            (item) => item.sku?.toLowerCase() === sku.toLowerCase() || item.barcode === sku,
          );
          const target =
            locations.find(
              (item) => item.code.toLowerCase() === code.toLowerCase() || item.id === code,
            ) ?? locations.find((item) => item.id === locationId);
          const quantity = Number(
            pickField(row, ["quantityonhand", "quantity", "openingstock", "stock"]),
          );
          if (!product)
            issues.push({ row: index + 2, issue: "SKU/barcode does not match a product." });
          if (!target) issues.push({ row: index + 2, issue: "Location code is unknown." });
          if (!Number.isFinite(quantity) || quantity < 0)
            issues.push({ row: index + 2, issue: "Quantity must be zero or greater." });
          const fingerprint = product && target ? `${product.id}:${target.id}` : "";
          if (fingerprint && seen.has(fingerprint))
            issues.push({ row: index + 2, issue: "Duplicate product/location stock row." });
          if (fingerprint) seen.add(fingerprint);
        }
      });
      return issues;
    },
    [kind, products, customers, locations, locationId],
  );

  useEffect(() => {
    if (previewRows.length) setRowIssues(validateRows(previewRows));
  }, [previewRows, validateRows]);

  async function confirmImport() {
    if (!previewRows.length || busy) return;
    setBusy(true);
    const invalidRows = new Set(rowIssues.map((issue) => issue.row - 2));
    let imported = 0;
    const failures: string[] = [];
    try {
      for (let index = 0; index < previewRows.length; index++) {
        if (invalidRows.has(index)) continue;
        const row = previewRows[index]!;
        try {
          if (kind === "products") {
            const name = String(pickField(row, ["name", "productname", "item"]) ?? "").trim();
            const aliases = String(pickField(row, ["searchaliases", "aliases"]) ?? "")
              .split(/[|,;]/)
              .map((value) => value.trim())
              .filter(Boolean);
            await quickAddProduct({
              name,
              nameHi: String(pickField(row, ["namehi", "hindiname"]) ?? "") || null,
              searchAliases: aliases,
              ...(String(pickField(row, ["sku", "productsku"]) ?? "")
                ? { sku: String(pickField(row, ["sku", "productsku"])) }
                : {}),
              barcode: String(pickField(row, ["barcode", "ean"]) ?? "") || null,
              variant: String(pickField(row, ["variant", "size"]) ?? "") || null,
              category: String(pickField(row, ["category"]) ?? "") || null,
              rackLocation: String(pickField(row, ["racklocation", "rack"]) ?? "") || null,
              salePrice: Number(pickField(row, ["saleprice", "sellingprice"])),
              priceTiers: parsePriceTiers(
                pickField(row, ["pricetiers", "quantitytiers", "wholesaleprices"]),
              ),
              minSalePrice: Number(pickField(row, ["minsaleprice", "floorprice"])) || 0,
              purchaseCost: Number(pickField(row, ["purchasecost", "cost"])) || 0,
              mrp: Number(pickField(row, ["mrp"])) || 0,
              uom: String(pickField(row, ["uomstock", "uom"]) ?? "Pcs"),
              minStock: Number(pickField(row, ["minstock", "reorderlevel"])) || 0,
              locationId,
              openingQty: 0,
            });
          } else if (kind === "customers") {
            await addCustomer({
              name: String(pickField(row, ["name", "customername"]) ?? "").trim(),
              mobile: String(pickField(row, ["mobile", "phone", "phonenumber"]) ?? "") || null,
              ageGroup: String(pickField(row, ["agegroup"]) ?? "") || null,
              gender: String(pickField(row, ["gender"]) ?? "") || null,
              creditLimit: Number(pickField(row, ["creditlimit"])) || 0,
              outstandingBalance:
                Number(pickField(row, ["outstandingbalance", "udhar", "due"])) || 0,
            });
          } else {
            const sku = String(pickField(row, ["sku", "productsku", "barcode"]) ?? "").trim();
            const product = products.find(
              (item) => item.sku?.toLowerCase() === sku.toLowerCase() || item.barcode === sku,
            )!;
            const code = String(pickField(row, ["locationcode", "location"]) ?? "").trim();
            const target =
              locations.find(
                (item) => item.code.toLowerCase() === code.toLowerCase() || item.id === code,
              ) ?? locations.find((item) => item.id === locationId)!;
            const quantity = Number(
              pickField(row, ["quantityonhand", "quantity", "openingstock", "stock"]),
            );
            const currentQty =
              inventory.find(
                (entry) => entry.product_id === product.id && entry.location_id === target.id,
              )?.quantity_on_hand ?? 0;
            await legacyStockSet({
              productId: product.id,
              locationId: target.id,
              currentQty,
              targetQty: quantity,
            });
          }
          imported++;
        } catch (error) {
          failures.push(`Row ${index + 2}: ${userFacingError(error, "Check the row values.")}`);
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      ]);
      toast.success(`${imported} ${kind} rows imported locally`, {
        description: `${rowIssues.length} rows skipped during validation.${failures.length ? ` ${failures.length} row operations failed.` : ""}`,
      });
      setPreviewRows([]);
      setPreviewName("");
      setRowIssues([]);
    } finally {
      setBusy(false);
    }
  }

  async function exportRegister(type: "stock" | "reorder" | "sales" | "products" | "customers") {
    try {
      if (type === "products") {
        const rows = products.map((product) => ({
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          name_hi: product.name_hi,
          search_aliases: (product.search_aliases ?? []).join("|"),
          category: product.category,
          variant: product.variant,
          hsn: product.hsn,
          purchase_cost: product.purchase_cost,
          mrp: product.mrp,
          sale_price: product.sale_price,
          min_sale_price: product.min_sale_price,
          price_tiers: formatPriceTiers(product.price_tiers),
          min_stock: product.min_stock,
          uom_purchase: product.uom_purchase,
          uom_stock: product.uom_stock,
          uom_sale: product.uom_sale,
          rack_location: product.rack_location,
        }));
        await exportSheets("retailhub-products.xlsx", [{ name: "Products", rows }]);
        return;
      }
      if (type === "customers") {
        const rows = customers.map((customer) => ({
          name: customer.name,
          mobile: customer.mobile,
          age_group: customer.age_group,
          gender: customer.gender,
          credit_limit: customer.credit_limit,
          outstanding_balance: customer.outstanding_balance,
          visits: customer.visits,
        }));
        await exportSheets("retailhub-customers.xlsx", [{ name: "Customers", rows }]);
        return;
      }
      if (type === "sales") {
        const rows = sales
          .filter(
            (sale) =>
              locations.some((location) => location.id === sale.location_id) &&
              sale.status === "COMPLETED",
          )
          .map((sale) => ({
            invoice_number: sale.invoice_number,
            business_date: sale.business_date,
            created_at: sale.created_at,
            outlet: locations.find((location) => location.id === sale.location_id)?.name,
            customer:
              customers.find((customer) => customer.id === sale.customer_id)?.name ?? "Walk-in",
            cashier: sale.cashier_name,
            total_amount: sale.total_amount,
            discount_amount: sale.discount_amount,
            paid_amount: sale.paid_amount,
            balance_amount: sale.balance_amount,
            payment_status: sale.payment_status,
            sync_status: sale.sync_status,
          }));
        await exportSheets("retailhub-sales-register.xlsx", [{ name: "Sales", rows }]);
        return;
      }
      const rows = products
        .flatMap((product) =>
          locations.map((location) => ({
            sku: product.sku,
            name: product.name,
            rack_location: product.rack_location,
            location: location.name,
            location_code: location.code,
            quantity_on_hand:
              inventory.find(
                (row) => row.product_id === product.id && row.location_id === location.id,
              )?.quantity_on_hand ?? 0,
            min_stock: product.min_stock,
            reorder_status:
              (inventory.find(
                (row) => row.product_id === product.id && row.location_id === location.id,
              )?.quantity_on_hand ?? 0) <= 0
                ? "OUT OF STOCK"
                : (inventory.find(
                      (row) => row.product_id === product.id && row.location_id === location.id,
                    )?.quantity_on_hand ?? 0) <= product.min_stock
                  ? "REORDER NOW"
                  : "IN STOCK",
          })),
        )
        .filter((row) => type !== "reorder" || row.reorder_status !== "IN STOCK");
      await exportSheets(
        type === "stock" ? "retailhub-stock-register.xlsx" : "retailhub-reorder-list.xlsx",
        [{ name: type === "stock" ? "Stock Register" : "Reorder", rows }],
      );
    } catch (error) {
      toast.error("Export failed", {
        description: userFacingError(error, "The report could not be prepared. Try again."),
      });
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">Spreadsheet import & export</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download a template, fill it in Excel or CSV, then upload the completed file.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["products", "customers", "stock"] as const).map((template) => (
          <div
            key={template}
            className="flex items-center justify-between gap-2 rounded-md border p-3"
          >
            <span className="capitalize">{template === "stock" ? "Opening stock" : template}</span>
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate(template)}>
              <Download className="h-4 w-4" /> Template
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <SearchableSelect
          className="w-48"
          value={kind}
          onValueChange={(value) => setKind(value as typeof kind)}
          options={[
            { value: "products", label: "Products" },
            { value: "customers", label: "Customers" },
            { value: "stock", label: "Opening stock" },
          ]}
        />
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          <Upload className="h-4 w-4" /> {busy ? "Importing…" : "Upload spreadsheet"}
          <input
            className="sr-only"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {previewRows.length > 0 && (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Preview: {previewName}</h3>
              <p className="text-xs text-muted-foreground">
                {previewRows.length} rows · {rowIssues.length} validation warnings · repeated family
                phone numbers remain separate customers
              </p>
            </div>
            <Button
              onClick={() => void confirmImport()}
              disabled={busy || rowIssues.length >= previewRows.length}
            >
              {busy
                ? "Importing locally…"
                : `Import ${previewRows.length - rowIssues.length} valid rows`}
            </Button>
          </div>
          {rowIssues.length > 0 && (
            <div className="max-h-36 space-y-1 overflow-auto rounded-lg border bg-background p-2 text-xs text-destructive">
              {rowIssues.map((issue, index) => (
                <p key={`${issue.row}-${index}`}>
                  Row {issue.row}: {issue.issue}
                </p>
              ))}
            </div>
          )}
          <div className="max-h-48 overflow-auto rounded-lg border bg-background">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Row</th>
                  {Object.keys(previewRows[0] ?? {})
                    .slice(0, 6)
                    .map((key) => (
                      <th className="px-2 py-1 text-left" key={key}>
                        {key}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 20).map((row, index) => (
                  <tr key={index} className="border-t">
                    <td className="px-2 py-1">{index + 2}</td>
                    {Object.keys(previewRows[0] ?? {})
                      .slice(0, 6)
                      .map((key) => (
                        <td className="max-w-48 truncate px-2 py-1" key={key}>
                          {String(row[key] ?? "")}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {previewRows.length > 20 && (
              <p className="p-2 text-center text-muted-foreground">Showing the first 20 rows.</p>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" onClick={() => void exportRegister("stock")}>
          <Download className="h-4 w-4" /> Stock register
        </Button>
        <Button variant="outline" onClick={() => void exportRegister("reorder")}>
          <Download className="h-4 w-4" /> Reorder list
        </Button>
        <Button variant="outline" onClick={() => void exportRegister("sales")}>
          <Download className="h-4 w-4" /> Daily sales register
        </Button>
        <Button variant="outline" onClick={() => void exportRegister("products")}>
          <Download className="h-4 w-4" /> Product master
        </Button>
        <Button variant="outline" onClick={() => void exportRegister("customers")}>
          <Download className="h-4 w-4" /> Customer master
        </Button>
      </div>
    </section>
  );
}

function CustomerManagement({
  customers,
}: {
  customers: Array<{
    id: string;
    name: string;
    mobile: string | null;
    credit_limit: number;
    outstanding_balance: number;
    age_group: string | null;
    gender: string | null;
  }>;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<
    Record<string, { name?: string; mobile?: string; credit_limit?: string }>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const filtered = customers
    .filter((customer) => matchesSearchFields([customer.name, customer.mobile], search))
    .slice(0, 100);

  async function save(customer: (typeof customers)[number]) {
    const patch = drafts[customer.id];
    if (!patch) return;
    setSavingId(customer.id);
    try {
      await updateCustomer(customer.id, {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.mobile !== undefined ? { mobile: patch.mobile.trim() || null } : {}),
        ...(patch.credit_limit !== undefined
          ? { credit_limit: Number(patch.credit_limit) || 0 }
          : {}),
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[customer.id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer profile saved on this device");
    } catch (error) {
      toast.error("Could not save customer", {
        description: userFacingError(error, "Check the customer details and try again."),
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-4">
      <div>
        <h2 className="font-semibold">Customer profiles</h2>
        <p className="text-sm text-muted-foreground">
          Phone numbers may be shared by family members; profile balances remain member-specific.
        </p>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search customer name or phone…"
      />
      <div className="max-h-[60dvh] space-y-2 overflow-auto">
        {filtered.map((customer) => {
          const draft = drafts[customer.id] ?? {};
          const patch = (key: "name" | "mobile" | "credit_limit", value: string) =>
            setDrafts((current) => ({
              ...current,
              [customer.id]: { ...current[customer.id], [key]: value },
            }));
          return (
            <div
              key={customer.id}
              className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1.3fr_1fr_140px_auto]"
            >
              <Input
                aria-label="Customer name"
                value={draft.name ?? customer.name}
                onChange={(event) => patch("name", event.target.value)}
              />
              <Input
                aria-label="Optional phone"
                value={draft.mobile ?? customer.mobile ?? ""}
                onChange={(event) => patch("mobile", event.target.value)}
                placeholder="Phone optional"
              />
              <Input
                aria-label="Credit limit"
                type="number"
                min="0"
                value={draft.credit_limit ?? customer.credit_limit}
                onChange={(event) => patch("credit_limit", event.target.value)}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Due {inr(customer.outstanding_balance)}
                </span>
                <Button
                  size="sm"
                  disabled={!drafts[customer.id] || savingId === customer.id}
                  onClick={() => void save(customer)}
                >
                  {savingId === customer.id ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ShortcutTileManager({
  locations,
  products,
  shortcutRows,
  defaultLocationId,
}: {
  locations: Array<{ id: string; name: string; code: string }>;
  products: Product[];
  shortcutRows: Array<Record<string, unknown>>;
  defaultLocationId: string;
}) {
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLocationId(defaultLocationId), [defaultLocationId]);
  useEffect(() => {
    const saved = shortcutRows.find((row) => row["location_id"] === locationId);
    const productIds = saved?.["product_ids"];
    setSelectedIds(
      Array.isArray(productIds)
        ? productIds.filter((id): id is string => typeof id === "string")
        : [],
    );
  }, [locationId, shortcutRows]);
  const filtered = products
    .filter((product) =>
      matchesSearchFields(
        [
          product.name,
          product.name_hi,
          product.sku,
          product.barcode,
          ...(product.search_aliases ?? []),
        ],
        search,
      ),
    )
    .slice(0, 100);

  async function save() {
    if (!locationId) return;
    setSaving(true);
    try {
      await saveShortcutTiles(locationId, selectedIds.slice(0, 16));
      toast.success("Cashier shortcuts saved locally");
    } catch (error) {
      toast.error("Could not save shortcuts", {
        description: userFacingError(error, "Refresh the shortcuts and try again."),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-4">
      <div>
        <h2 className="font-semibold">Cashier quick tiles</h2>
        <p className="text-sm text-muted-foreground">
          Choose up to 16 products for a specific outlet. The POS will display these tiles in the
          saved order.
        </p>
      </div>
      <SearchableSelect
        value={locationId}
        onValueChange={setLocationId}
        placeholder="Choose location"
        options={locations.map((location) => ({
          value: location.id,
          label: `${location.code} · ${location.name}`,
        }))}
      />
      <div className="flex gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search English, Hindi, SKU or alias…"
        />
        <Button onClick={() => void save()} disabled={saving || !locationId}>
          {saving ? "Saving…" : "Save shortcuts"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{selectedIds.length}/16 selected</p>
      <div className="grid max-h-[55dvh] gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((product) => {
          const selected = selectedIds.includes(product.id);
          return (
            <button
              key={product.id}
              onClick={() =>
                setSelectedIds((current) =>
                  selected
                    ? current.filter((id) => id !== product.id)
                    : current.length < 16
                      ? [...current, product.id]
                      : current,
                )
              }
              className={`rounded-lg border p-2 text-left text-sm ${selected ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
            >
              <span className="font-medium">
                {selected ? `${selectedIds.indexOf(product.id) + 1}. ` : ""}
                {product.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {product.name_hi ?? product.sku ?? product.barcode ?? ""}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------ Enrichment ------------------------------ */

function EnrichmentQueue({ products }: { products: Product[] }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  const saveMut = useMutation({
    mutationFn: async (p: Product) => {
      const d = drafts[p.id] ?? {};
      await updateProductProfile(p.id, {
        name: d["name"] ?? p.name,
        name_hi: d["name_hi"] ?? p.name_hi ?? null,
        search_aliases: (d["search_aliases"] ?? (p.search_aliases ?? []).join(","))
          .split(/[|,;]/)
          .map((value) => value.trim())
          .filter(Boolean),
        barcode: d["barcode"] ?? p.barcode ?? null,
        sku: d["sku"] ?? p.sku ?? null,
        hsn: d["hsn"] ?? p.hsn ?? null,
        purchase_cost: Number(d["purchase_cost"] ?? p.purchase_cost),
        mrp: Number(d["mrp"] ?? p.mrp),
        sale_price: Number(d["sale_price"] ?? p.sale_price),
        price_tiers: parsePriceTiers(d["price_tiers"] ?? formatPriceTiers(p.price_tiers)),
        uom_purchase: d["uom_purchase"] ?? p.uom_purchase,
        uom_stock: d["uom_stock"] ?? p.uom_stock,
        uom_sale: d["uom_sale"] ?? p.uom_sale,
        min_stock: Number(d["min_stock"] ?? p.min_stock),
        enrichment_status: "COMPLETE",
      });
    },
    onSuccess: () => {
      toast.success("Product completed");
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) =>
      toast.error("Save failed", {
        description: userFacingError(e, "The product changes could not be saved."),
      }),
  });

  if (products.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        Catalog queue is clear — every product is enriched.
      </div>
    );
  }

  const field = (p: Product, key: keyof Product) =>
    drafts[p.id]?.[key] ?? String((p[key] as string | number | boolean | null) ?? "");

  return (
    <section className="overflow-x-auto rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-sm font-medium">
        {products.length} item(s) pending enrichment
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Hindi name / aliases</TableHead>
            <TableHead>Barcode</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>HSN</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>MRP</TableHead>
            <TableHead>Sale</TableHead>
            <TableHead>Qty tiers</TableHead>
            <TableHead>UOM</TableHead>
            <TableHead>Min</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="text-xs font-medium">{p.name}</TableCell>
              <TableCell className="min-w-48 space-y-1">
                <Input
                  aria-label="Hindi product name"
                  className="h-7 w-40 text-xs"
                  placeholder="Hindi name"
                  value={field(p, "name_hi")}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], name_hi: e.target.value } }))
                  }
                />
                <Input
                  aria-label="Search aliases"
                  className="h-7 w-40 text-xs"
                  placeholder="aliases, separated by comma"
                  value={field(p, "search_aliases")}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [p.id]: { ...d[p.id], search_aliases: e.target.value },
                    }))
                  }
                />
              </TableCell>
              {(["barcode", "sku", "hsn"] as const).map((k) => (
                <TableCell key={k}>
                  <Input
                    className="h-7 w-28 text-xs"
                    value={field(p, k) === "null" ? "" : field(p, k)}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], [k]: e.target.value } }))
                    }
                  />
                </TableCell>
              ))}
              {(["purchase_cost", "mrp", "sale_price"] as const).map((k) => (
                <TableCell key={k}>
                  <Input
                    type="number"
                    className="h-7 w-20 text-right text-xs"
                    value={field(p, k)}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], [k]: e.target.value } }))
                    }
                  />
                </TableCell>
              ))}
              <TableCell>
                <Input
                  aria-label={`Quantity prices for ${p.name}`}
                  className="h-7 w-28 text-xs"
                  value={drafts[p.id]?.["price_tiers"] ?? formatPriceTiers(p.price_tiers)}
                  onChange={(event) =>
                    setDrafts((d) => ({
                      ...d,
                      [p.id]: { ...d[p.id], price_tiers: event.target.value },
                    }))
                  }
                  placeholder="6:68,12:64"
                  title="Minimum quantity: unit price, for example 6:68,12:64"
                />
              </TableCell>
              <TableCell>
                <SearchableSelect
                  className="h-7 w-20 text-xs"
                  value={field(p, "uom_stock")}
                  onValueChange={(value) =>
                    setDrafts((drafts) => ({
                      ...drafts,
                      [p.id]: {
                        ...drafts[p.id],
                        uom_stock: value,
                        uom_sale: value,
                        uom_purchase: value,
                      },
                    }))
                  }
                  options={["UNIT", "KG", "LITRE", "PKT", "BAG", "PIECE"].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  className="h-7 w-16 text-right text-xs"
                  value={field(p, "min_stock")}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: { ...d[p.id], min_stock: e.target.value } }))
                  }
                />
              </TableCell>
              <TableCell>
                <Button size="sm" onClick={() => saveMut.mutate(p)} disabled={saveMut.isPending}>
                  Complete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/* ------------------------------ Transfers ------------------------------ */

function NewTransferCard({
  locations,
  products,
  defaultFromId,
  onCreated,
}: {
  locations: Array<{ id: string; name: string; type: string }>;
  products: Product[];
  defaultFromId: string;
  onCreated: () => void;
}) {
  const [fromId, setFromId] = useState(defaultFromId);
  const [toId, setToId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ product_id: string; quantity: number; name: string }>>(
    [],
  );
  const [busy, setBusy] = useState(false);

  function addLine() {
    const p = products.find((x) => x.id === productId);
    if (!p || !(Number(qty) > 0)) return;
    setLines((prev) => [...prev, { product_id: p.id, quantity: Number(qty), name: p.name }]);
    setProductId("");
    setQty("");
  }

  async function submit() {
    if (!fromId || !toId || lines.length === 0 || busy) return;
    setBusy(true);
    try {
      await createTransfer({
        fromLocationId: fromId,
        toLocationId: toId,
        notes: notes.trim() || null,
        items: lines.map(({ product_id, quantity }) => ({ product_id, quantity })),
      });
      toast.success("Transfer created");
      setLines([]);
      setNotes("");
      onCreated();
    } catch (e) {
      toast.error("Could not create transfer", {
        description: userFacingError(
          e,
          "Check the source, destination, and quantities, then try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm font-medium">New stock transfer</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>From</Label>
          <SearchableSelect
            className="w-52"
            value={fromId}
            onValueChange={setFromId}
            placeholder="Source"
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
        </div>
        <div className="space-y-1">
          <Label>To</Label>
          <SearchableSelect
            className="w-52"
            value={toId}
            onValueChange={setToId}
            placeholder="Destination"
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Item</Label>
          <SearchableSelect
            className="w-56"
            value={productId}
            onValueChange={setProductId}
            placeholder="Pick product"
            options={products.map((product) => ({
              value: product.id,
              label: `${product.name}${product.name_hi ? ` · ${product.name_hi}` : ""} · ${product.sku ?? product.barcode ?? "No SKU"}`,
              keywords: [
                ...(product.search_aliases ?? []),
                product.sku ?? "",
                product.barcode ?? "",
              ],
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Qty</Label>
          <Input
            type="number"
            className="w-20"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={addLine}>
          Add
        </Button>
      </div>
      {lines.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lines.map((l, i) => (
            <span
              key={i}
              className="flex items-center gap-1 rounded border bg-muted/40 px-2 py-0.5 text-xs"
            >
              {l.name} ×{l.quantity}
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="tr-notes">Notes</Label>
          <Input
            id="tr-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional note"
          />
        </div>
        <Button onClick={submit} disabled={busy || !toId || lines.length === 0}>
          Create transfer
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ Write-offs ------------------------------ */

function NewWriteOffCard({
  locations,
  products,
  locationId,
  busy,
  onSubmit,
}: {
  locations: Array<{ id: string; name: string }>;
  products: Product[];
  locationId: string;
  busy: boolean;
  onSubmit: (input: {
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
    returnable: boolean;
  }) => void;
}) {
  const [productId, setProductId] = useState("");
  const [locId, setLocId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<string>("SPOILAGE");
  const [returnable, setReturnable] = useState(false);

  const product = products.find((p) => p.id === productId);
  const effectiveLoc = locId || locationId;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm font-medium">Record damage / expiry write-off</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>Item</Label>
          <SearchableSelect
            className="w-56"
            value={productId}
            onValueChange={setProductId}
            placeholder="Pick product"
            options={products.map((item) => ({
              value: item.id,
              label: `${item.name}${item.name_hi ? ` · ${item.name_hi}` : ""} · ${item.sku ?? item.barcode ?? "No SKU"}`,
              keywords: [...(item.search_aliases ?? []), item.sku ?? "", item.barcode ?? ""],
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Location</Label>
          <SearchableSelect
            className="w-52"
            value={effectiveLoc}
            onValueChange={setLocId}
            placeholder="Location"
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Qty</Label>
          <Input
            type="number"
            className="w-20"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Reason</Label>
          <SearchableSelect
            className="w-32"
            value={reason}
            onValueChange={setReason}
            options={REASONS.map((reasonOption) => ({ value: reasonOption, label: reasonOption }))}
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-xs">
          <Checkbox checked={returnable} onCheckedChange={(v) => setReturnable(!!v)} />
          Returnable to vendor
        </label>
        <Button
          disabled={!productId || !effectiveLoc || !(Number(qty) > 0) || busy}
          onClick={() =>
            onSubmit({
              productId,
              locationId: effectiveLoc,
              quantity: Number(qty),
              reason,
              returnable,
            })
          }
        >
          Write off ({product && qty ? inr(Number(qty) * product.purchase_cost) : "₹0.00"})
        </Button>
      </div>
    </div>
  );
}
