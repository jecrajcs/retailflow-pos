import { describe, expect, it } from "vitest";
import {
  calculatePaymentAllocation,
  suggestCashChange,
  tenderAfterDenominationTap,
  validateRecordedPaymentSplit,
} from "@/lib/payment-policy";
import {
  DEFAULT_ENABLED_CASH_DENOMINATIONS,
  parseEnabledCashDenominations,
} from "@/lib/cash-denominations";

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

  it("applies UPI first and returns only the cash excess for a mixed tender", () => {
    expect(
      calculatePaymentAllocation(80, [
        { mode: "CASH", amount: 50 },
        { mode: "UPI", amount: 50 },
      ]),
    ).toMatchObject({
      cashApplied: 30,
      nonCashPaid: 50,
      paid: 80,
      change: 20,
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

  it("suggests change using valid whole-rupee notes and coins", () => {
    expect(suggestCashChange(26.5).filter((line) => line.count > 0)).toEqual([
      { denomination: 20, count: 1 },
      { denomination: 5, count: 1 },
    ]);
    expect(DEFAULT_ENABLED_CASH_DENOMINATIONS).not.toContain(1);
    expect(DEFAULT_ENABLED_CASH_DENOMINATIONS).not.toContain(2);
    expect(suggestCashChange(26).filter((line) => line.count > 0)).toEqual([
      { denomination: 20, count: 1 },
      { denomination: 5, count: 1 },
    ]);
    expect(suggestCashChange(26, [20, 5, 1]).filter((line) => line.count > 0)).toEqual([
      { denomination: 20, count: 1 },
      { denomination: 5, count: 1 },
      { denomination: 1, count: 1 },
    ]);
    expect(
      validateRecordedPaymentSplit(1, [
        {
          mode: "CASH",
          amount: 1,
          tendered: 1,
          change_given: 0,
          change_denominations: {},
        },
      ]),
    ).toBeNull();
    expect(
      validateRecordedPaymentSplit(1, [
        {
          mode: "CASH",
          amount: 0.5,
          tendered: 1,
          change_given: 0.5,
          change_denominations: { "0.5": 1 },
        },
        { mode: "UPI", amount: 0.5 },
      ]),
    ).toContain("unsupported denomination");
  });

  it("replaces tender on the first denomination tap and adds on subsequent taps", () => {
    expect(tenderAfterDenominationTap("40", 20, true)).toBe("20");
    expect(tenderAfterDenominationTap("20", 5, false)).toBe("25");
  });

  it("accepts only a non-empty list of supported whole-rupee denominations", () => {
    expect(parseEnabledCashDenominations([1, 5, 20])).toEqual([20, 5, 1]);
    expect(parseEnabledCashDenominations([0.5])).toBeNull();
    expect(parseEnabledCashDenominations([])).toBeNull();
  });
});
