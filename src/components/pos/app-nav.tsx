import { Link } from "@tanstack/react-router";
import { ScanBarcode, Vault, PackageSearch, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const links: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/", label: "Billing", icon: ScanBarcode },
  { to: "/cash-drawer", label: "Cash Drawer", icon: Vault },
  { to: "/manager", label: "Manager", icon: PackageSearch },
];

export function AppNav({ active }: { active: string }) {
  return (
    <header className="bg-primary text-primary-foreground">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-1 px-3">
        <span className="mr-3 text-sm font-bold tracking-tight">
          Retail<span className="text-amber-300">Hub</span> POS
        </span>
        {links.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active === to
                ? "bg-primary-foreground/15 text-primary-foreground"
                : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}
      </div>
    </header>
  );
}
