import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReceiptDialog, type ReceiptData } from "@/components/pos/receipt";

const receipt: ReceiptData = {
  invoiceNumber: "SP01-CD08-261112-0007",
  locationName: "SAPTAAR POINT",
  customerName: "Aarvi Rathore",
  lines: [
    { name: "Chips Chakhle", quantity: 1, unit_price: 5, uom: "Pcs", total: 5 },
    { name: "Long named second item", quantity: 2, unit_price: 3.5, uom: "Pcs", total: 7 },
  ],
  subtotal: 12,
  discount: 0,
  total: 12,
  payments: [
    { mode: "CASH", amount: 8, tendered: 10, change_given: 2 },
    { mode: "CREDIT", amount: 4 },
  ],
  createdAt: "2026-11-13T13:31:00.000Z",
};

afterEach(() => {
  document.body.classList.remove("print-receipt");
  vi.restoreAllMocks();
});

describe("receipt printing", () => {
  it("renders all receipt lines, totals, payments, and returned change", () => {
    render(<ReceiptDialog open onOpenChange={vi.fn()} data={receipt} />);

    expect(screen.getByText(receipt.invoiceNumber)).toBeInTheDocument();
    expect(screen.getByText("Chips Chakhle")).toBeInTheDocument();
    expect(screen.getByText("Long named second item")).toBeInTheDocument();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getByText("TOTAL")).toBeInTheDocument();
    expect(screen.getByText("BALANCE DUE (UDHAR)")).toBeInTheDocument();
    expect(screen.getByText("Change returned")).toBeInTheDocument();
  });

  it("switches the print width and enters/exits receipt-only print mode", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<ReceiptDialog open onOpenChange={vi.fn()} data={receipt} />);

    fireEvent.click(screen.getByRole("button", { name: "80mm" }));
    expect(document.querySelector("#thermal-print")).toHaveStyle({
      "--receipt-width": "80mm",
    });

    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
    expect(document.body).toHaveClass("print-receipt");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.body).not.toHaveClass("print-receipt");
  });
});
