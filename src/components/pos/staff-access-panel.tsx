import { useCallback, useEffect, useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAccess } from "@/lib/access";
import { retailApi, userFacingError } from "@/lib/retail-api";

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

type StaffLocation = { id: string; name: string; code: string };

export function StaffAccessPanel({
  mode,
  locations,
}: {
  mode: "admin" | "manager";
  locations: StaffLocation[];
}) {
  const { online, profile } = useAccess();
  const [staff, setStaff] = useState<ManagedStaff[]>([]);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<ManagedStaff["role"]>(mode === "admin" ? "MANAGER" : "CASHIER");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCredential, setNewCredential] = useState<{
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
    setRole(mode === "admin" ? "MANAGER" : "CASHIER");
    setLocationIds([]);
    setActive(true);
  }

  async function saveMember(resetPassword = false) {
    const normalizedId = userId.trim();
    if (!displayName.trim()) {
      toast.error("Enter a staff display name.");
      return;
    }
    if (role !== "ADMIN" && active && locationIds.length === 0) {
      toast.error("Assign at least one active location to this active staff member.");
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
          login: result.login ?? (email.trim() || phone.trim()),
          temporary_password: result.temporary_password,
        });
      }
      toast.success(
        resetPassword
          ? "Temporary password created; the staff member must change it at sign-in."
          : normalizedId
            ? "Staff role and location access saved."
            : `${role[0] + role.slice(1).toLowerCase()} login created.`,
      );
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

  const allowedRoles =
    mode === "admin" ? (["MANAGER", "CASHIER", "ADMIN"] as const) : (["CASHIER"] as const);
  const canEdit = mode === "admin" ? profile?.role === "ADMIN" : profile?.role === "MANAGER";
  if (!canEdit) return null;

  return (
    <section className="space-y-4">
      <div className="rounded-xl border bg-primary/5 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <UserPlus className="h-4 w-4" />
          {mode === "admin" ? "Network staff access" : "Store staff access"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "admin"
            ? "Create Managers and assign one or more active locations. Admins can also manage all staff."
            : "Create or update Cashiers only for your assigned locations. Manager and Admin roles are managed by an Admin."}{" "}
          New staff receive a temporary password that must be changed at first sign-in.
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
            This password is shown only in this screen. The user must change it before opening
            RetailFlow.
          </p>
        </div>
      )}
      {!locations.length && (
        <p role="status" className="rounded-lg border border-dashed p-4 text-sm">
          No active assigned locations are available.{" "}
          {mode === "admin"
            ? "Create and activate a location in Admin → Locations before provisioning a Manager or Cashier."
            : "Ask an Admin to assign an active location to your account."}
        </p>
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
                placeholder={role === "MANAGER" ? "Manager name" : "Cashier name"}
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
                    placeholder="staff@example.com"
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
            {mode === "admin" && (
              <Field label="Role">
                <SearchableSelect
                  value={role}
                  onValueChange={(value) => {
                    setRole(value as ManagedStaff["role"]);
                    if (value === "ADMIN") setLocationIds([]);
                  }}
                  options={allowedRoles.map((value) => ({
                    value,
                    label:
                      value === "ADMIN" ? "Admin / Owner" : value[0] + value.slice(1).toLowerCase(),
                  }))}
                />
              </Field>
            )}
            {userId && mode === "admin" && (
              <label className="flex items-center gap-2 self-end rounded-lg border p-3 text-sm">
                <Checkbox
                  checked={active}
                  onCheckedChange={(checked) => setActive(checked === true)}
                />
                Active sign-in
              </label>
            )}
          </div>
          {role === "ADMIN" ? (
            <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              Admin access covers all locations; no location assignment is required.
            </p>
          ) : (
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
                {mode === "admin"
                  ? "Managers and Cashiers can access only their assigned locations."
                  : "Assignments are limited to locations this Manager is allowed to operate."}
              </p>
            </div>
          )}
          <Button
            onClick={() => void saveMember()}
            disabled={!online || saving || (!locations.length && role !== "ADMIN")}
          >
            {saving ? "Saving…" : userId ? "Update staff access" : "Create active login"}
          </Button>
          {userId && mode === "admin" && (
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
              Staff permissions require an online connection. POS sales can remain queued offline.
            </p>
          )}
        </div>
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              {mode === "admin" ? "Network staff" : "Store Cashiers"}
            </h3>
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
              {online ? "No staff assignments found." : "Staff list is not available offline."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
