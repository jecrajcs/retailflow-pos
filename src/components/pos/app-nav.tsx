import { Link } from "@tanstack/react-router";
import { Boxes, PackageSearch, ScanBarcode, Vault, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const links: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/", label: "Billing", icon: ScanBarcode },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/cash-drawer", label: "Cash Drawer", icon: Vault },
  { to: "/manager", label: "Manager", icon: PackageSearch },
];

export function AppNav({ active }: { active: string }) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-1 px-3">
        <Link to="/" className="mr-3 flex items-center gap-2 text-sm font-bold tracking-tight">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary font-display text-xs text-primary-foreground">
            R
          </span>
          Retail<span className="text-primary">Hub</span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
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
        <div className="ml-auto hidden items-center gap-2 text-[11px] text-muted-foreground md:flex">
          <span className="rounded border px-1.5 py-0.5 font-mono">F1</span> scan
          <span className="rounded border px-1.5 py-0.5 font-mono">F2</span> quick add
          <span className="rounded border px-1.5 py-0.5 font-mono">F3</span> customer
          <span className="rounded border px-1.5 py-0.5 font-mono">F4</span> pay
        </div>
      </div>
    </header>
  );
}
