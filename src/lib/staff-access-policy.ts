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
