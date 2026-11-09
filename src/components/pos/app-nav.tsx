import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Boxes,
  ChartNoAxesCombined,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  MapPin,
  PackageSearch,
  ScanBarcode,
  Vault,
  CircleHelp,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccess, canAccessLocation, canManage } from "@/lib/access";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCashSessions, useLocations } from "@/lib/pos";

const links: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
  { to: "/billing", label: "Billing", icon: ScanBarcode },
  { to: "/sales", label: "Sales", icon: ChartNoAxesCombined },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/purchases", label: "Purchases", icon: ClipboardList },
  { to: "/cash-drawer", label: "Cash Drawer", icon: Vault },
  { to: "/manager", label: "Manager", icon: PackageSearch },
];

export function AppNav({ active }: { active: string }) {
  const { profile, online, signOut } = useAccess();
  const { data: locations = [] } = useLocations();
  const [locationId, setLocationId] = useState("");
  useEffect(() => {
    const read = () => setLocationId(window.localStorage.getItem("pos-location-id") ?? "");
    read();
    window.addEventListener("retailflow:location-change", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("retailflow:location-change", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const { data: sessions = [] } = useCashSessions(locationId || null);
  const currentLocation = locations.find((location) => location.id === locationId);
  const activeLocations = locations.filter((location) => canAccessLocation(profile, location.id));
  const shiftOpen = sessions.some((session) => session.status === "OPEN");
  const visibleLinks = links.filter(({ to }) => {
    if (to === "/admin") return profile?.role === "ADMIN";
    if (to === "/manager") return profile?.role === "MANAGER";
    if (to === "/purchases") return canManage(profile);
    return true;
  });
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex min-h-12 max-w-[1600px] items-center gap-1 px-2 sm:px-3">
          <Link
            to="/"
            className="mr-2 flex shrink-0 items-center gap-2 text-sm font-bold tracking-tight sm:mr-3"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary font-display text-xs text-primary-foreground">
              R
            </span>
            Retail<span className="text-primary">Hub</span>
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
            {visibleLinks.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors sm:px-3 sm:text-xs",
                  active === to
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            ))}
          </nav>
          {profile && (
            <div className="ml-auto flex shrink-0 items-center gap-2 border-l pl-2 sm:pl-3">
              <span className="hidden text-right sm:block">
                <span className="block max-w-28 truncate text-[11px] font-medium">
                  {profile.display_name}
                </span>
                <span className="block text-[9px] text-muted-foreground">
                  {profile.role.toLowerCase()} · {online ? "online" : "offline"}
                </span>
              </span>
              <span
                className="hidden max-w-36 items-center gap-1 truncate rounded-md border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground md:flex"
                title={`${currentLocation?.name ?? "No outlet selected"} · ${shiftOpen ? "shift open" : "shift closed"}`}
              >
                <MapPin className="h-3 w-3 shrink-0" />
                {currentLocation?.code ?? "Select outlet"}
                <span className="opacity-50">·</span>
                {shiftOpen ? "shift open" : "shift closed"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Sign out"
                aria-label="Sign out"
                onClick={() => void signOut()}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title="Open this screen’s quick guide"
                aria-label="Open quick guide"
              >
                <CircleHelp className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  Quick guide · {links.find((link) => link.to === active)?.label ?? "RetailFlow"}
                </DialogTitle>
                <DialogDescription>
                  Short steps for this screen. Close the guide at any time and reopen it from the
                  help icon.
                </DialogDescription>
              </DialogHeader>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {guideFor(active).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                Keyboard: type to search, ↑/↓ to move through matches, Enter to choose, Esc to
                close. Bills save on this device before background sync.
              </div>
            </DialogContent>
          </Dialog>
          <div className="ml-2 hidden shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground xl:flex">
            <span className="rounded border px-1.5 py-0.5 font-mono">F1</span> scan
            <span className="rounded border px-1.5 py-0.5 font-mono">F2</span> quick add
            <span className="rounded border px-1.5 py-0.5 font-mono">F3</span> customer
            <span className="rounded border px-1.5 py-0.5 font-mono">F4</span> pay
          </div>
        </div>
      </header>
      {profile && activeLocations.length === 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
          <p>
            {online
              ? `No active assigned location is available, so location-based POS work is blocked. ${
                  profile.role === "ADMIN"
                    ? "Create and activate your first store or warehouse."
                    : "Ask an Admin to assign an active store or warehouse to your account."
                }`
              : "No active assigned location is cached on this device. Reconnect to refresh available locations before starting location-based POS work."}
          </p>
          {profile.role === "ADMIN" && online && (
            <Button asChild size="sm" variant="outline">
              <Link to="/admin">Open Admin locations</Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function guideFor(route: string) {
  const guides: Record<string, string[]> = {
    "/": [
      "Check today’s saved sales, outstanding balances, low stock and sync status.",
      "Use New bill to start billing for an assigned outlet.",
      "Sync now sends queued operations when the network is available.",
    ],
    "/admin": [
      "Create and maintain stores and warehouses before provisioning location-scoped staff.",
      "Create Managers and assign one or more active locations; Managers can manage Cashiers only within their assignments.",
      "Use the network-wide inventory, sales and operations links to review all active locations.",
    ],
    "/billing": [
      "Select the outlet and choose a customer or Walk-in before scanning.",
      "Scan or type a name/SKU; use arrow keys and Enter to select. F2 adds an unknown barcode.",
      "Use the bill tabs to hold and switch customers. Pay saves the completed sale locally.",
    ],
    "/sales": [
      "Search by bill, customer or phone; narrow the register by date, outlet or payment status.",
      "Open a completed bill to inspect items and payments, then reprint its receipt.",
      "Sync labels show whether a bill is saved here, pending, synced or needs review.",
    ],
    "/inventory": [
      "Choose an assigned location to see its stock and local movements.",
      "Managers can record adjustments or transfers; cashier sales are reflected immediately on this device.",
      "A later cross-device stock mismatch appears in Manager → Sync alerts.",
    ],
    "/purchases": [
      "Enter the supplier invoice manually or add a PDF/photo for browser-only OCR.",
      "Review matched products, quantities and costs; edit every extracted field.",
      "Manager review is required before receiving inventory into the warehouse.",
    ],
    "/cash-drawer": [
      "Count opening denominations when the shift starts.",
      "Log small cash in/out entries with a reason; checkout shows cash received and change.",
      "Count closing denominations and review the expected-cash difference before closing.",
    ],
    "/manager": [
      "Use catalog tools to update bilingual product/customer records, transfers and write-offs.",
      "Spreadsheet imports show a preview and row warnings before local import; download a template first.",
      "Admin controls staff roles and outlet access. Resolve sync alerts after checking the affected stock.",
    ],
  };
  return (
    guides[route] ?? [
      "Use the visible controls to complete this module’s task.",
      "Changes save on this device and sync in the background when online.",
    ]
  );
}
