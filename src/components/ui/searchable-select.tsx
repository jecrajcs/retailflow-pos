import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { matchesSearchFields } from "@/lib/pos";

export interface SearchableOption {
  value: string;
  label: string;
  keywords?: string[];
  disabled?: boolean | undefined;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyMessage = "No matches found.",
  className,
  disabled = false,
}: {
  options: SearchableOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(
    () =>
      options.filter((option) =>
        matchesSearchFields([option.label, ...(option.keywords ?? [])], search),
      ),
    [options, search],
  );
  const visible = filtered.slice(0, 100);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between gap-2 font-normal", className)}
          disabled={disabled}
        >
          <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0" align="start">
        <Command shouldFilter={false}>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={searchPlaceholder}
              className="pl-8"
            />
          </div>
          <CommandList className="max-h-64">
            {!filtered.length && <CommandEmpty>{emptyMessage}</CommandEmpty>}
            {visible.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
                onSelect={() => {
                  onValueChange(option.value);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === option.value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{option.label}</span>
              </CommandItem>
            ))}
          </CommandList>
          {filtered.length > visible.length && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Showing the first 100 matches. Type a few more letters to narrow the list.
            </p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
