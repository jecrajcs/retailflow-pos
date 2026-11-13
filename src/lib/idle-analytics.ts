export type IdleSaleRow = {
  business_date?: string | null;
  created_at?: string | null;
  total_amount?: number | string | null;
  status?: string | null;
  invoice_status?: string | null;
};

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
});

function businessDate(row: IdleSaleRow) {
  const recordedDate = row.business_date?.slice(0, 10);
  if (recordedDate && /^\d{4}-\d{2}-\d{2}$/.test(recordedDate)) return recordedDate;
  if (!row.created_at) return null;
  const createdAt = new Date(row.created_at);
  return Number.isNaN(createdAt.getTime()) ? null : businessDateFormatter.format(createdAt);
}

function dateOffset(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + offset)).toISOString().slice(0, 10);
}

export function summarizeIdleSales(rows: IdleSaleRow[], now = new Date()) {
  const today = businessDateFormatter.format(now);
  const firstDay = dateOffset(today, -6);
  const dates = Array.from({ length: 7 }, (_, index) => dateOffset(firstDay, index));
  const totals = new Map(dates.map((date) => [date, 0]));
  const validSales = rows.filter(
    (row) => String(row.status || row.invoice_status || "").toUpperCase() === "COMPLETED",
  );

  for (const row of validSales) {
    const date = businessDate(row);
    if (!date || !totals.has(date)) continue;
    const amount = Number(row.total_amount ?? 0);
    if (Number.isFinite(amount)) totals.set(date, (totals.get(date) ?? 0) + amount);
  }

  const salesTrend = dates.map((date) => ({
    day: new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
    }).format(new Date(`${date}T06:30:00.000Z`)),
    sales: totals.get(date) ?? 0,
  }));
  const todaysBills = validSales.filter((row) => businessDate(row) === today);

  return {
    bills: todaysBills.length,
    sales: salesTrend.reduce((sum, point) => sum + point.sales, 0),
    salesTrend,
  };
}
