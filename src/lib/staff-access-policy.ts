import type { StaffRole } from "@/lib/retail-auth.server";

export function canManageStaffRole(actorRole: StaffRole, targetRole: StaffRole) {
  return actorRole === "ADMIN" || (actorRole === "MANAGER" && targetRole === "CASHIER");
}

export function canAssignStaffLocations(
  actorRole: StaffRole,
  actorLocationIds: readonly string[],
  requestedLocationIds: readonly string[],
) {
  if (requestedLocationIds.length === 0) return false;
  if (actorRole === "ADMIN") return true;
  const allowed = new Set(actorLocationIds);
  return requestedLocationIds.every((locationId) => allowed.has(locationId));
}

export function canManageStaffTarget(
  actorRole: StaffRole,
  actorLocationIds: readonly string[],
  targetRole: StaffRole,
  targetLocationIds: readonly string[],
) {
  if (!canManageStaffRole(actorRole, targetRole)) return false;
  if (actorRole === "ADMIN") return true;
  const allowed = new Set(actorLocationIds);
  return (
    targetLocationIds.length > 0 && targetLocationIds.every((locationId) => allowed.has(locationId))
  );
}

/** Keep the offline sync API aligned with the permissions exposed in the POS. */
export function canStaffSyncOperation(role: StaffRole, operation: string) {
  if (["invoice.draft.save", "invoice.draft.void", "invoice.finalize", "payment.add"].includes(operation))
    return role === "CASHIER";
  if (operation === "customer.create") return role !== "WAREHOUSE";
  if (operation === "customer.update") return role === "MANAGER" || role === "ADMIN";
  if (operation === "product.quick_add") return role === "CASHIER";
  if (["product.create", "product.update", "shortcut.update"].includes(operation))
    return role === "MANAGER" || role === "ADMIN";
  if (operation.startsWith("purchase.")) return role === "MANAGER" || role === "ADMIN";
  if (operation.startsWith("inventory."))
    return role === "MANAGER" || role === "ADMIN" || role === "WAREHOUSE";
  if (operation === "cash.session.open" || operation === "cash.session.close" || operation === "cash.transaction.create")
    return role === "CASHIER";
  return false;
}
