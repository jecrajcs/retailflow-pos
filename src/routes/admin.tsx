import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes, ChartNoAxesCombined, MapPin, Plus, Store, Users } from "lucide-react";
import { AppNav } from "@/components/pos/app-nav";
import { DataTable } from "@/components/pos/data-table";
import { WorkbookImporter } from "@/components/pos/workbook-importer";
import { StaffAccessPanel } from "@/components/pos/staff-access-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccess } from "@/lib/access";
import { refreshLocalReplica } from "@/lib/offline-sync";
import { inr, useInventory, useLocations, useProducts, useSales, type Location } from "@/lib/pos";
import { LOCATION_TYPES, type LocationType } from "@/lib/location-policy";
import { retailApi, userFacingError } from "@/lib/retail-api";

export const Route = createFileRoute("/admin")({ component: AdminPage });

type LocationForm = {
  name: string;
  code: string;
  type: LocationType;
  address: string;
  phone: string;
  is_active: boolean;
};

const emptyLocation: LocationForm = {
  name: "",
  code: "",
  type: "RETAIL",
  address: "",
  phone: "",
  is_active: true,
};

function todayInIndia() {
  const date = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function AdminPage() {
  const { profile } = useAccess();
  const { data: localLocations = [] } = useLocations();
  const { data: sales = [] } = useSales();
  const { data: inventory = [] } = useInventory();
  const { data: products = [] } = useProducts();
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [form, setForm] = useState<LocationForm>(emptyLocation);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationError, setLocationError] = useState("");

  const loadLocations = useCallback(async () => {
    if (profile?.role !== "ADMIN") return;
    setLoadingLocations(true);
    try {
      const result = await retailApi<{ locations: Location[] }>("/api/admin/locations");
      setLocations(result.locations);
      setLocationError("");
    } catch (error) {
      setLocationError(userFacingError(error, "Could not load locations. Please try again."));
    } finally {
      setLoadingLocations(false);
    }
  }, [profile?.role]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const activeLocations = locations.filter((location) => location.is_active);
  const todaysSales = sales.filter(
    (sale) => sale.business_date === todayInIndia() && sale.status === "COMPLETED",
  );
  const lowStockCount = inventory.filter((row) => {
    const product = products.find((item) => item.id === row.product_id);
    return product && product.min_stock > 0 && row.quantity_on_hand <= product.min_stock;
  }).length;

  function editLocation(location: Location) {
    setEditingId(location.id);
    setForm({
      name: location.name,
      code: location.code,
      type: LOCATION_TYPES.includes(location.type as LocationType)
        ? (location.type as LocationType)
        : "RETAIL",
      address: location.address ?? "",
      phone: location.phone ?? "",
      is_active: location.is_active,
    });
    setLocationError("");
  }

  function startNewLocation() {
    setEditingId(null);
    setForm(emptyLocation);
    setLocationError("");
    setActiveTab("locations");
  }

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.code.trim()) {
      setLocationError("Enter both a location name and a unique code.");
      return;
    }
    setSavingLocation(true);
    setLocationError("");
    try {
      const result = await retailApi<{ location: Location }>("/api/admin/locations", {
        method: editingId ? "PATCH" : "POST",
        json: {
          ...(editingId ? { id: editingId } : {}),
          ...form,
          name: form.name.trim(),
          code: form.code.trim(),
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
        },
      });
      setLocations((current) =>
        [...current.filter((location) => location.id !== result.location.id), result.location].sort(
          (left, right) => left.name.localeCompare(right.name),
        ),
      );
      startNewLocation();
      try {
        await refreshLocalReplica();
      } catch {
        setLocationError(
          "Location saved, but POS data could not refresh on this device. Check the connection and reload.",
        );
      }
    } catch (error) {
      setLocationError(userFacingError(error, "Could not save this location."));
    } finally {
      setSavingLocation(false);
    }
  }

  if (profile?.role !== "ADMIN") {
    return (
      <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
        <AppNav active="/admin" />
        <main className="m-auto max-w-lg rounded-xl border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Network-wide locations, staff and analytics are available only to an Admin.
          </p>
          {profile?.role === "MANAGER" && (
            <Button asChild className="mt-4">
              <Link to="/manager">Open Manager workspace</Link>
            </Button>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      <AppNav active="/admin" />
      <main className="mx-auto min-h-0 w-full max-w-[1500px] flex-1 space-y-5 overflow-y-auto p-3 sm:p-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 sm:p-6">
          <div>
            <p className="text-sm text-muted-foreground">RetailFlow POS · Network administration</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Admin console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage stores and warehouses, provision location-scoped Managers, and review network
              performance.
            </p>
          </div>
          <Button onClick={startNewLocation} className="gap-2">
            <Plus className="h-4 w-4" /> Add location
          </Button>
        </header>

        {locationError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
          >
            <span>{locationError}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadLocations()}
              disabled={loadingLocations}
            >
              {loadingLocations ? "Refreshing…" : "Retry"}
            </Button>
          </div>
        )}

        {!loadingLocations && !locationError && !activeLocations.length && (
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <h2 className="font-semibold">Start by adding your first location</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Managers and Cashiers need an active location assignment. Create a store or warehouse
              here first, then use Staff access to create its Manager.
            </p>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Network overview">
          <Metric
            title="Active locations"
            value={String(activeLocations.length)}
            detail={`${locations.length} total locations`}
            icon={Store}
          />
          <Metric
            title="Today's network sales"
            value={inr(todaysSales.reduce((sum, sale) => sum + sale.total_amount, 0))}
            detail={`${todaysSales.length} completed bills`}
            icon={ChartNoAxesCombined}
          />
          <Metric
            title="Low-stock items"
            value={String(lowStockCount)}
            detail="Across active locations"
            icon={Boxes}
          />
          <Metric
            title="Staff setup"
            value={activeLocations.length ? "Ready" : "Waiting"}
            detail={
              activeLocations.length ? "Create location-scoped access" : "Add a location first"
            }
            icon={Users}
          />
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
            <TabsTrigger value="staff">Staff access</TabsTrigger>
            <TabsTrigger value="import">Data import</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-4 pt-3">
            <section className="grid gap-3 md:grid-cols-3">
              <QuickLink
                to="/inventory"
                title="Network inventory"
                text="Review stock across active locations."
              />
              <QuickLink
                to="/sales"
                title="Sales register"
                text="Inspect bills and payment status."
              />
              <QuickLink
                to="/purchases"
                title="Purchases"
                text="Review incoming stock and supplier receipts."
              />
            </section>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4" /> Locations at a glance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LocationDataTable
                  locations={locations}
                  onEdit={editLocation}
                  emptyMessage={
                    loadingLocations
                      ? "Loading locations…"
                      : locationError
                        ? "Locations could not be loaded. Retry from the alert above."
                        : "No locations found. Add your first store or warehouse from the Locations tab."
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="locations" className="space-y-4 pt-3">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <form
                onSubmit={(event) => void saveLocation(event)}
                className="space-y-4 rounded-xl border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">
                    {editingId ? "Edit location" : "Create location"}
                  </h2>
                  {editingId && (
                    <Button type="button" variant="outline" size="sm" onClick={startNewLocation}>
                      New location
                    </Button>
                  )}
                </div>
                <Field label="Location name">
                  <Input
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="Central Market Store"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Unique code">
                    <Input
                      required
                      minLength={2}
                      maxLength={20}
                      pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,19}"
                      title="Use 2–20 letters, numbers, dashes, or underscores."
                      value={form.code}
                      onChange={(event) =>
                        setForm({ ...form, code: event.target.value.toUpperCase() })
                      }
                      placeholder="CMS01"
                    />
                  </Field>
                  <Field label="Location type">
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.type}
                      onChange={(event) =>
                        setForm({ ...form, type: event.target.value as LocationType })
                      }
                    >
                      {LOCATION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type[0] + type.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Address (optional)">
                  <Input
                    value={form.address}
                    onChange={(event) => setForm({ ...form, address: event.target.value })}
                    placeholder="Street, city, state"
                  />
                </Field>
                <Field label="Phone (optional)">
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    placeholder="+91 98765 43210"
                  />
                </Field>
                {editingId && (
                  <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                    <Checkbox
                      checked={form.is_active}
                      onCheckedChange={(checked) =>
                        setForm({ ...form, is_active: checked === true })
                      }
                    />
                    Active location
                  </label>
                )}
                {locationError && (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
                  >
                    {locationError}
                  </p>
                )}
                <Button type="submit" disabled={savingLocation}>
                  {savingLocation ? "Saving…" : editingId ? "Save location" : "Create location"}
                </Button>
              </form>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">All locations</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadLocations()}
                    disabled={loadingLocations}
                  >
                    {loadingLocations ? "Refreshing…" : "Refresh"}
                  </Button>
                </CardHeader>
                <CardContent>
                  <LocationDataTable
                    locations={locations}
                    onEdit={editLocation}
                    emptyMessage={
                      loadingLocations
                        ? "Loading locations…"
                        : "Create the first location with the form. Locations are deactivated, never deleted."
                    }
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="staff" className="pt-3">
            <StaffAccessPanel
              mode="admin"
              locations={locations
                .filter((location) => location.is_active)
                .map(({ id, name, code }) => ({ id, name, code }))}
            />
          </TabsContent>
          <TabsContent value="import" className="pt-3">
            <WorkbookImporter locations={locations.filter((location) => location.is_active)} />
          </TabsContent>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          {localLocations.length} active location records are available to POS workflows on this
          device.
        </p>
      </main>
    </div>
  );
}

function LocationDataTable({
  locations,
  onEdit,
  emptyMessage,
}: {
  locations: Location[];
  onEdit: (location: Location) => void;
  emptyMessage: string;
}) {
  return (
    <DataTable<Location>
      rows={locations}
      getRowId={(location) => location.id}
      searchPlaceholder="Search location, code, address or type…"
      emptyMessage={emptyMessage}
      columns={[
        { id: "name", header: "Location", accessor: (location) => location.name },
        { id: "code", header: "Code", accessor: (location) => location.code },
        { id: "type", header: "Type", accessor: (location) => location.type },
        {
          id: "address",
          header: "Address",
          accessor: (location) => location.address ?? "",
        },
        {
          id: "status",
          header: "Status",
          accessor: (location) => (location.is_active ? "Active" : "Inactive"),
          cell: (location) => (
            <Badge variant={location.is_active ? "outline" : "secondary"}>
              {location.is_active ? "Active" : "Inactive"}
            </Badge>
          ),
        },
        {
          id: "action",
          header: "",
          accessor: () => "Edit",
          sortable: false,
          cell: (location) => (
            <Button size="sm" variant="outline" onClick={() => onEdit(location)}>
              Edit
            </Button>
          ),
        },
      ]}
    />
  );
}

function Metric({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Store;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function QuickLink({
  to,
  title,
  text,
}: {
  to: "/inventory" | "/sales" | "/purchases";
  title: string;
  text: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={to}>Open</Link>
        </Button>
      </CardContent>
    </Card>
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
