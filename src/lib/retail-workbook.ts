export const RETAILFLOW_WORKBOOK_SHEETS = {
  sales: "2_Sales_Billing",
  customers: "4_Customer_Master",
  purchases: "5_Purchase_Entry",
  products: "6_Master_Stock",
} as const;

export const RETAILFLOW_WORKBOOK_HEADER_ROWS = {
  sales: 0,
  customers: 3,
  purchases: 0,
  products: 0,
} as const;

export function isWorkbookLocationColumn(name: string) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^(location|store|outlet|warehouse)(id|code|name)?$/.test(normalized);
}
