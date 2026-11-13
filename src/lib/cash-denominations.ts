export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export type CashDenomination = (typeof DENOMINATIONS)[number];

export const DEFAULT_ENABLED_CASH_DENOMINATIONS: CashDenomination[] = DENOMINATIONS.filter(
  (denomination) => denomination !== 1 && denomination !== 2,
);

function isCashDenomination(value: number): value is CashDenomination {
  return DENOMINATIONS.some((denomination) => denomination === value);
}

export function parseEnabledCashDenominations(value: unknown): CashDenomination[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const selected = new Set<CashDenomination>();
  for (const candidate of value) {
    if (
      typeof candidate !== "number" ||
      !Number.isInteger(candidate) ||
      !isCashDenomination(candidate)
    )
      return null;
    selected.add(candidate);
  }
  return DENOMINATIONS.filter((denomination) => selected.has(denomination));
}
