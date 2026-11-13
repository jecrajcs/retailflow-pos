export function generatedSupplierInvoiceNumber(
  supplier: string,
  category: string,
  invoiceDate: string,
  receiptId: string,
) {
  const token = (value: string, fallback: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 8) || fallback;
  const date = invoiceDate.replaceAll("-", "");
  const suffix = receiptId
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();
  return `AUTO-${token(supplier, "SUP")}-${token(category, "GEN")}-${date}-${suffix}`;
}
