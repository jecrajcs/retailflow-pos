import { describe, expect, it } from "vitest";
import { summarizeIdleSales } from "@/lib/idle-analytics";

describe("idle-screen sales analytics", () => {
  it("uses completed business-date totals for the last seven India business days", () => {
    const result = summarizeIdleSales(
      [
        { status: "COMPLETED", business_date: "2026-03-05", total_amount: 20 },
        { status: "COMPLETED", business_date: "2026-03-04", total_amount: 12 },
        { status: "", invoice_status: "COMPLETED", business_date: "2026-03-05", total_amount: 5 },
        { status: "DRAFT", business_date: "2026-03-05", total_amount: 50 },
        { status: "COMPLETED", business_date: "2026-02-26", total_amount: 100 },
      ],
      new Date("2026-03-04T20:00:00.000Z"),
    );

    expect(result.bills).toBe(2);
    expect(result.sales).toBe(37);
    expect(result.salesTrend).toHaveLength(7);
    expect(result.salesTrend.slice(-2).map((point) => point.sales)).toEqual([12, 25]);
  });

  it("falls back to the India date of created_at when a business date is absent", () => {
    const result = summarizeIdleSales(
      [
        {
          status: "COMPLETED",
          created_at: "2026-03-04T20:00:00.000Z",
          total_amount: "15.5",
        },
        {
          status: "COMPLETED",
          created_at: "not-a-date",
          total_amount: 100,
        },
      ],
      new Date("2026-03-04T20:00:00.000Z"),
    );

    expect(result.bills).toBe(1);
    expect(result.sales).toBe(15.5);
    expect(result.salesTrend.at(-1)?.sales).toBe(15.5);
  });
});
