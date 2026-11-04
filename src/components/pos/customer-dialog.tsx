import { useMemo, useState } from "react";
import { Plus, Search, UserRound } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inr, useCustomers, addCustomer, type Customer } from "@/lib/pos";

const AGE_GROUPS = ["Child", "Teen", "Adult", "Senior"];
const GENDERS = ["Male", "Female", "Other"];

export function CustomerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (customer: Customer | null) => void;
}) {
  const { data: customers = [] } = useCustomers();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [ageGroup, setAgeGroup] = useState("Adult");
  const [gender, setGender] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.mobile ?? "").includes(q),
    );
  }, [customers, search]);

  async function handleAdd() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await addCustomer({
        name: name.trim(),
        mobile: mobile.trim() || null,
        creditLimit: Number(creditLimit) || 0,
        ageGroup,
        gender: gender || null,
      });
      onSelect(created);
      onOpenChange(false);
      setName("");
      setMobile("");
      setCreditLimit("");
      setAgeGroup("Adult");
      setGender("");
      setAdding(false);
      setSearch("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Customer</DialogTitle>
          <DialogDescription>
            Search by name or mobile — phone number is optional. Pick Walk-in to skip.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Name or mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="max-h-56 space-y-1 overflow-y-auto">
          <button
            onClick={() => {
              onSelect(null);
              onOpenChange(false);
            }}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <UserRound className="h-4 w-4" /> Walk-in (no customer)
          </button>
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c);
                onOpenChange(false);
              }}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
            >
              <span className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-muted-foreground" />
                {c.name}
                {c.mobile && <span className="text-xs text-muted-foreground">{c.mobile}</span>}
                {c.visits > 0 && (
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {c.visits} visits
                  </span>
                )}
              </span>
              {c.outstanding_balance > 0 ? (
                <span className="text-xs font-semibold text-destructive">
                  ⚠️ Udhar due {inr(c.outstanding_balance)}
                </span>
              ) : (
                <span className="text-[10px] font-medium text-success">Clear</span>
              )}
            </button>
          ))}
        </div>

        {adding ? (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="cust-name">Name *</Label>
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
                <Select value={ageGroup} onValueChange={setAgeGroup}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGE_GROUPS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <Button size="sm" onClick={handleAdd} disabled={!name.trim() || busy}>
                Save customer
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add new customer
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
