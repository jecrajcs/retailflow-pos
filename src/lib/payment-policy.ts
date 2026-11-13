import { DENOMINATIONS } from "@/lib/cash-denominations";

export const CASH_DENOMINATIONS = [...DENOMINATIONS, 0.5] as const;

export type PaymentAllocationLine = {
  mode: string;
  amount: number | string;
};

export type PaymentAllocation = {
  cashTendered: number;
  cashApplied: number;
  nonCashPaid: number;
  creditAllocated: number;
  paid: number;
  change: number;
  remaining: number;
};

export type RecordedPaymentLine = PaymentAllocationLine & {
  tendered?: number;
  change_given?: number;
  change_denominations?: Record<string, number>;
};

export function suggestCashChange(amount: number) {
  let remaining = Math.max(0, Math.round(amount * 100) / 100);
  return CASH_DENOMINATIONS.map((denomination) => {
    const count = Math.floor((remaining + 0.0001) / denomination);
    remaining = Math.round((remaining - count * denomination) * 100) / 100;
    return { denomination, count };
  });
}

/** Cash amount means tendered; other modes mean the amount applied to the bill. */
export function calculatePaymentAllocation(
  total: number,
  lines: readonly PaymentAllocationLine[],
): PaymentAllocation {
  const amountFor = (mode: string) =>
    lines
      .filter((line) => line.mode === mode)
      .reduce((sum, line) => {
        const amount = Number(line.amount);
        return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0);
  const payable = Math.max(Number.isFinite(total) ? total : 0, 0);
  const cashTendered = amountFor("CASH");
  const nonCashPaid = amountFor("UPI") + amountFor("CARD");
  const creditAllocated = amountFor("CREDIT");
  const cashApplied = Math.min(cashTendered, Math.max(payable - nonCashPaid - creditAllocated, 0));
  const paid = nonCashPaid + cashApplied;

  return {
    cashTendered,
    cashApplied,
    nonCashPaid,
    creditAllocated,
    paid,
    change: Math.max(cashTendered - cashApplied, 0),
    remaining: Math.max(payable - paid - creditAllocated, 0),
  };
}
export function validateRecordedPaymentSplit(total: number, lines: readonly RecordedPaymentLine[]) {
  if (!Number.isFinite(total) || total < 0) return "The bill total is invalid.";
  if (lines.length === 0) return "Enter at least one payment amount.";
  const seen = new Set<string>();
  let allocated = 0;

  for (const line of lines) {
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return "Each payment amount must be greater than zero.";
    if (!["CASH", "UPI", "CARD", "CREDIT"].includes(line.mode))
      return "Choose a supported payment mode.";
    if (seen.has(line.mode)) return "Use each payment mode only once.";
    seen.add(line.mode);
    allocated += amount;

    if (line.mode === "CASH") {
      const tendered = Number(line.tendered);
      const change = Number(line.change_given ?? 0);
      if (!Number.isFinite(tendered) || !Number.isFinite(change) || change < 0 || tendered < amount)
        return "Check the cash received and change amount.";
      if (Math.abs(tendered - change - amount) > 0.01)
        return "Cash received less change must equal the cash applied to the bill.";
      let denominationsTotal = 0;
      for (const [rawDenomination, rawCount] of Object.entries(line.change_denominations ?? {})) {
        const denomination = Number(rawDenomination);
        const count = Number(rawCount);
        if (
          !CASH_DENOMINATIONS.includes(denomination as (typeof CASH_DENOMINATIONS)[number]) ||
          !Number.isInteger(count) ||
          count < 0
        )
          return "Returned change contains an unsupported denomination or count.";
        denominationsTotal += denomination * count;
      }
      if (Math.abs(denominationsTotal - change) > 0.01)
        return "The returned note and coin total must match the change due.";
    }
  }

  if (Math.abs(allocated - total) > 0.01)
    return "Allocate the full bill amount to collected payments and customer credit.";
  return null;
}
