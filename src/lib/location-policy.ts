export const LOCATION_TYPES = ["RETAIL", "WAREHOUSE", "WHOLESALE", "ECOMMERCE"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export type LocationInput = {
  name: string;
  code: string;
  type: LocationType;
  address: string | null;
  phone: string | null;
  is_active: boolean;
};

export function normalizeLocationInput(value: unknown): LocationInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record["name"] !== "string" ||
    typeof record["code"] !== "string" ||
    typeof record["type"] !== "string"
  )
    return null;
  if (
    record["address"] !== undefined &&
    record["address"] !== null &&
    typeof record["address"] !== "string"
  )
    return null;
  if (
    record["phone"] !== undefined &&
    record["phone"] !== null &&
    typeof record["phone"] !== "string"
  )
    return null;
  if (record["is_active"] !== undefined && typeof record["is_active"] !== "boolean") return null;

  const name = record["name"].trim();
  const code = record["code"].trim().toUpperCase();
  const type = record["type"].trim().toUpperCase();
  if (!name || name.length > 120 || !/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) return null;
  if (!LOCATION_TYPES.includes(type as LocationType)) return null;

  return {
    name,
    code,
    type: type as LocationType,
    address: typeof record["address"] === "string" ? record["address"].trim() || null : null,
    phone: typeof record["phone"] === "string" ? record["phone"].trim() || null : null,
    is_active: record["is_active"] !== false,
  };
}

export function canDeactivateLocation(input: {
  openCashSessions: number;
  assignedStaff: number;
  unresolvedAlerts: number;
}) {
  return input.openCashSessions === 0 && input.assignedStaff === 0 && input.unresolvedAlerts === 0;
}
