import { useMemo, useState } from "react";
import { Plus, Search, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  familySummary,
  inr,
  matchesSearchFields,
  useCustomers,
  addCustomer,
  type Customer,
} from "@/lib/pos";

const AGE_GROUPS = ["Child", "Teen", "Adult", "Senior"];
const GENDERS = ["Male", "Female", "Other"];

export function CustomerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (customer: Customer | null, walkIn?: boolean) => void;
}) {
  const { data: customers = [] } = useCustomers();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [ageGroup, setAgeGroup] = useState("unspecified");
  const [gender, setGender] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectableCustomers = customers.filter(
    (customer) => customer.name?.trim().toLocaleLowerCase() !== "walk-in" || !!customer.mobile,
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return selectableCustomers.slice(0, 8);
    return selectableCustomers.filter((c) => matchesSearchFields([c.name, c.mobile], q));
  }, [selectableCustomers, search]);
  const visibleCustomers = filtered.slice(0, 100);

  async function selectWalkIn() {
    if (busy) return;
    setBusy(true);
    try {
      const walkIn =
        customers.find(
          (customer) => customer.name?.trim().toLocaleLowerCase() === "walk-in" && !customer.mobile,
        ) ??
        (await addCustomer({
          name: "Walk-in",
          mobile: null,
          creditLimit: 0,
          ageGroup: null,
          gender: null,
        }));
      onSelect(walkIn, true);
      onOpenChange(false);
    } catch (error) {
      toast.error("Could not start a Walk-in bill", {
        description:
          error instanceof Error
            ? error.message
            : "The Walk-in customer profile could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if ((!name.trim() && !mobile.replace(/\D/g, "")) || busy) return;
    setBusy(true);
    try {
      const created = await addCustomer({
        name: name.trim() || null,
        mobile: mobile.trim() || null,
        creditLimit: Number(creditLimit) || 0,
        ageGroup: ageGroup === "unspecified" ? null : ageGroup,
        gender: gender || null,
      });
      onSelect(created);
      onOpenChange(false);
      setName("");
      setMobile("");
      setCreditLimit("");
      setAgeGroup("unspecified");
      setGender("");
      setAdding(false);
      setSearch("");
    } catch (error) {
      toast.error("Could not save customer", {
        description:
          error instanceof Error ? error.message : "The customer profile could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select customer</DialogTitle>
          <DialogDescription>
            Search by name or mobile, or create a customer profile.
          </DialogDescription>
        </DialogHeader>

        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          disabled={busy}
          onClick={() => void selectWalkIn()}
        >
          Continue as Walk-in
        </Button>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Name or mobile…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && visibleCustomers.length) {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, visibleCustomers.length - 1));
              } else if (event.key === "ArrowUp" && visibleCustomers.length) {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && visibleCustomers[activeIndex]) {
                event.preventDefault();
                onSelect(visibleCustomers[activeIndex]!);
                onOpenChange(false);
              } else if (event.key === "Escape") onOpenChange(false);
            }}
            className="pl-8"
          />
        </div>

        <div className="max-h-56 space-y-1 overflow-y-auto">
          {visibleCustomers.map((c, index) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c);
                onOpenChange(false);
              }}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent ${activeIndex === index ? "border-primary bg-accent" : ""}`}
            >
              <span className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-muted-foreground" />
                {c.name || "Name not provided"}
                {c.mobile && <span className="text-xs text-muted-foreground">{c.mobile}</span>}
                {Number(c.visits) > 0 && (
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {c.visits} visits
                  </span>
                )}
              </span>
              {(c.mobile ? familySummary(customers, c.mobile).outstanding : c.outstanding_balance) >
              0 ? (
                <span className="text-xs font-semibold text-destructive">
                  ⚠️ Family{" "}
                  {inr(
                    c.mobile
                      ? familySummary(customers, c.mobile).outstanding
                      : c.outstanding_balance,
                  )}{" "}
                  · member {inr(c.outstanding_balance)}
                </span>
              ) : (
                <span className="text-[10px] font-medium text-success">Clear</span>
              )}
            </button>
          ))}
        </div>
        {search.trim() &&
          !adding &&
          !selectableCustomers.some((customer) =>
            matchesSearchFields([customer.name, customer.mobile], search.trim()),
          ) && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-primary hover:bg-accent"
              onClick={() => {
                const isPhone = /\d/.test(search);
                setName(isPhone ? "" : search.trim());
                setMobile(isPhone ? search.trim() : "");
                setAdding(true);
              }}
            >
              <Plus className="h-4 w-4" /> Create customer from this search
            </button>
          )}
        {filtered.length > visibleCustomers.length && (
          <p className="text-xs text-muted-foreground">
            Showing the first 100 matches. Type more to narrow the list.
          </p>
        )}

        {adding ? (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="cust-name">Name</Label>
                <Input
                  id="cust-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Customer name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cust-mobile">Mobile (optional)</Label>
                <Input
                  id="cust-mobile"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="10-digit number"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>Age group</Label>
                <SearchableSelect
                  value={ageGroup}
                  onValueChange={setAgeGroup}
                  options={[
                    { value: "unspecified", label: "Not specified" },
                    ...AGE_GROUPS.map((value) => ({ value, label: value })),
                  ]}
                />
              </div>
              <div className="space-y-1">
                <Label>Gender</Label>
                <SearchableSelect
                  value={gender}
                  onValueChange={setGender}
                  placeholder="—"
                  options={GENDERS.map((value) => ({ value, label: value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cust-credit">Credit limit (₹)</Label>
                <Input
                  id="cust-credit"
                  type="number"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={(!name.trim() && !mobile.replace(/\D/g, "")) || busy}
              >
                Save customer
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
