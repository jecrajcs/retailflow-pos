import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "@/components/ui/searchable-select";

globalThis.ResizeObserver ??= class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function openCreateOption(onCreateOption: (query: string) => void) {
  render(
    <SearchableSelect
      value=""
      onValueChange={() => undefined}
      options={[]}
      placeholder="Choose product"
      searchPlaceholder="Search product"
      onCreateOption={onCreateOption}
      createOptionLabel={(query) => `Add “${query}” as new SKU / variant`}
    />,
  );
  fireEvent.click(screen.getByRole("combobox"));
  const search = screen.getByPlaceholderText("Search product");
  fireEvent.change(search, { target: { value: "Almond milk" } });
  return search;
}

describe("SearchableSelect create option", () => {
  it("creates an item when the query-specific option is clicked", () => {
    const onCreateOption = vi.fn();
    openCreateOption(onCreateOption);

    fireEvent.click(screen.getByText("Add “Almond milk” as new SKU / variant"));

    expect(onCreateOption).toHaveBeenCalledWith("Almond milk");
  });

  it("creates an item when the query-specific option is chosen with Enter", () => {
    const onCreateOption = vi.fn();
    const search = openCreateOption(onCreateOption);

    fireEvent.keyDown(search, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter", code: "Enter" });

    expect(onCreateOption).toHaveBeenCalledWith("Almond milk");
  });
});
