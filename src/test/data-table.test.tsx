import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTable } from "@/components/pos/data-table";

type Row = { id: string; name: string; quantity: number };

const rows: Row[] = Array.from({ length: 30 }, (_, index) => ({
  id: String(index + 1),
  name: `Item ${String(index + 1).padStart(2, "0")}`,
  quantity: index + 1,
}));

const columns = [
  { id: "name", header: "Name", accessor: (row: Row) => row.name },
  { id: "quantity", header: "Quantity", accessor: (row: Row) => row.quantity },
];

describe("DataTable", () => {
  it("shows 25 rows by default and advances through pages", () => {
    render(<DataTable rows={rows} columns={columns} getRowId={(row) => row.id} />);

    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();
    expect(screen.getByText("Item 01")).toBeInTheDocument();
    expect(screen.queryByText("Item 26")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("26–30 of 30")).toBeInTheDocument();
    expect(screen.getByText("Item 26")).toBeInTheDocument();
    expect(screen.queryByText("Item 01")).not.toBeInTheDocument();
  });

  it("resets paging when search changes and sorts numeric values", () => {
    render(<DataTable rows={rows} columns={columns} getRowId={(row) => row.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Search records…" }), {
      target: { value: "Item 02" },
    });
    expect(screen.getByText("1–1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Item 02")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search records…" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Quantity" }));
    const renderedRows = screen.getAllByRole("row");
    expect(renderedRows[1]).toHaveTextContent("Item 01");

    fireEvent.click(screen.getByRole("button", { name: "Quantity" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Item 30");
  });
});
