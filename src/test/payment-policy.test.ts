import { describe, expect, it } from "vitest";
import { calculatePaymentAllocation, validateRecordedPaymentSplit } from "@/lib/payment-policy";

describe("payment allocation", () => {
  it("returns the correct change for a cash and UPI split", () => {
    expect(
      calculatePaymentAllocation(20, [
        { mode: "UPI", amount: 10 },
        { mode: "CASH", amount: 30 },
      ]),
    ).toEqual({
      cashTendered: 30,
      cashApplied: 10,
      nonCashPaid: 10,
      creditAllocated: 0,
      paid: 20,
      change: 20,
      remaining: 0,
    });
  });

  it("keeps customer credit separate from cash received", () => {
    expect(
      calculatePaymentAllocation(100, [
        { mode: "CASH", amount: 30 },
        { mode: "CREDIT", amount: 70 },
      ]),
    ).toMatchObject({
      cashTendered: 30,
      cashApplied: 30,
      creditAllocated: 70,
      paid: 30,
      change: 0,
      remaining: 0,
    });
  });

  it("shows any bill amount that has not been assigned to payment or credit", () => {
    expect(calculatePaymentAllocation(100, [{ mode: "UPI", amount: 40 }])).toMatchObject({
      paid: 40,
      remaining: 60,
    });
  });

  it("validates cash tender, edited change denominations and full bill allocation", () => {
    expect(
      validateRecordedPaymentSplit(20, [
        {
          mode: "CASH",
          amount: 10,
          tendered: 30,
          change_given: 20,
          change_denominations: { "20": 1 },
        },
        { mode: "UPI", amount: 10 },
      ]),
    ).toBeNull();
    expect(
      validateRecordedPaymentSplit(20, [
        {
          mode: "CASH",
          amount: 10,
          tendered: 30,
          change_given: 20,
          change_denominations: { "10": 1 },
        },
        { mode: "UPI", amount: 10 },
      ]),
    ).toContain("returned note and coin total");
    expect(
      validateRecordedPaymentSplit(20, [
        { mode: "UPI", amount: 10 },
        { mode: "CASH", amount: 5, tendered: 5, change_given: 0 },
      ]),
    ).toContain("Allocate the full bill amount");
  });
});
