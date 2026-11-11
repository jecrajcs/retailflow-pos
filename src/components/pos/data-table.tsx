import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  accessor: (row: T) => unknown;
  cell?: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  searchPlaceholder = "Search records…",
  searchable = true,
  emptyMessage = "No records found.",
  initialPageSize = 25,
  resetKey,
  tableHeightClass = "",
}: {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  searchPlaceholder?: string;
  searchable?: boolean;
  emptyMessage?: string;
  initialPageSize?: number;
  resetKey?: string | number | null;
  tableHeightClass?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => setPage(0), [resetKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const result =
      searchable && needle
        ? rows.filter((row) =>
            columns.some((column) =>
              String(column.accessor(row) ?? "")
                .toLocaleLowerCase()
                .includes(needle),
            ),
          )
        : [...rows];
    if (!sort) return result;
    const column = columns.find((candidate) => candidate.id === sort.id);
    if (!column) return result;
    const direction = sort.direction === "asc" ? 1 : -1;
    return result.sort((left, right) => {
      const a = column.accessor(left);
      const b = column.accessor(right);
      const an = typeof a === "number" ? a : Number.NaN;
      const bn = typeof b === "number" ? b : Number.NaN;
      const comparison =
        Number.isFinite(an) && Number.isFinite(bn)
          ? an - bn
          : String(a ?? "").localeCompare(String(b ?? ""), undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return comparison * direction;
    });
  }, [rows, columns, query, searchable, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  function changeSearch(value: string) {
    setQuery(value);
    setPage(0);
  }

  function toggleSort(id: string) {
    setSort((current) =>
      current?.id === id
        ? { id, direction: current.direction === "asc" ? "desc" : "asc" }
        : { id, direction: "asc" },
    );
    setPage(0);
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {searchable ? (
          <div className="relative min-w-52 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => changeSearch(event.target.value)}
              className="pl-8"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {filtered.length.toLocaleString()} records
          </span>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Rows
          <select
            className="h-8 rounded-md border bg-background px-2 text-foreground"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
            aria-label="Rows per page"
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={`overflow-auto rounded-md border ${tableHeightClass}`}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <TableRow>
              {columns.map((column) => {
                const active = sort?.id === column.id;
                const Icon = active
                  ? sort.direction === "asc"
                    ? ArrowUp
                    : ArrowDown
                  : ChevronsUpDown;
                return (
                  <TableHead
                    key={column.id}
                    className={column.className}
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    {column.sortable === false ? (
                      column.header
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                        className="inline-flex items-center gap-1 text-left hover:text-foreground"
                      >
                        {column.header}
                        <Icon className="h-3 w-3 opacity-60" />
                      </button>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={getRowId(row)}>
                {columns.map((column) => (
                  <TableCell key={column.id} className={column.className}>
                    {column.cell ? column.cell(row) : String(column.accessor(row) ?? "—")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!visible.length && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {filtered.length
            ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)} of ${filtered.length}`
            : "0 records"}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={currentPage === 0}
            onClick={() => setPage(Math.max(0, currentPage - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
