import { matchesProductSearch, type Product } from "@/lib/pos";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `purchase-line-${Date.now()}`;
}

/** Parse visible invoice rows into editable purchase-line suggestions. */
export function itemRowsFromOcr(text: string, products: Product[]) {
  const amountPattern = /(?:₹|rs\.?\s*)?([0-9][0-9,]*(?:\.\d{1,3})?)/gi;
  const labeledValue = (line: string, labels: string) => {
    const match = new RegExp(
      `\\b(?:${labels})\\b\\s*[:=#-]?\\s*(?:₹|rs\\.?\\s*)?([0-9][0-9,]*(?:\\.\\d{1,3})?)`,
      "i",
    ).exec(line);
    return match?.[1]
      ? {
          value: Number(match[1].replace(/,/g, "")),
          index: match.index,
        }
      : null;
  };

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 4)
    .flatMap((line) => {
      const numbers = [...line.matchAll(amountPattern)].map((match) => ({
        value: Number(match[1]!.replace(/,/g, "")),
        index: match.index ?? 0,
      }));
      if (numbers.length < 2) return [];

      const quantityValue = labeledValue(line, "qty|quantity|units");
      const costValue = labeledValue(
        line,
        "unit\\s*cost|purchase\\s*(?:rate|price)|buy\\s*price|cost(?:\\s*price)?|rate",
      );
      const retailValue = labeledValue(line, "retail\\s*price|selling\\s*price|sell\\s*price|mrp");
      const totalValue = labeledValue(line, "line\\s*total|net\\s*amount|amount|total");
      const quantityToken = quantityValue ?? numbers[numbers.length >= 3 ? 0 : numbers.length - 2];
      const costToken = costValue ?? numbers[numbers.length >= 3 ? 1 : numbers.length - 1];
      const quantity = quantityToken?.value ?? 0;
      const unitCost = costToken?.value ?? 0;
      const sourceTotal = totalValue?.value ?? (numbers.length >= 3 ? numbers.at(-1)?.value : 0);

      const explicitSku = line.match(
        /\b(?:sku|barcode|item\s*code|product\s*code)\s*[:=#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
      )?.[1];
      const sku = explicitSku ?? line.match(/^\s*([A-Z][A-Z0-9/_-]{2,})\s+/i)?.[1];
      const skuMatch = sku
        ? products.find(
            (product) =>
              product.sku?.toLowerCase() === sku.toLowerCase() ||
              product.barcode?.toLowerCase() === sku.toLowerCase(),
          )
        : products.find((product) =>
            [product.sku, product.barcode].some(
              (code) => code && line.toLowerCase().includes(code.toLowerCase()),
            ),
          );
      const cutAt = quantityToken?.index ?? -1;
      const name =
        skuMatch?.name ??
        (cutAt > 0
          ? line
              .slice(0, cutAt)
              .replace(/\b(?:sku|barcode|item\s*code|product\s*code)\s*[:=#-]?\s*/i, "")
              .replace(/^\s*[A-Z][A-Z0-9/_-]{2,}\s+/i, "")
              .replace(/[|:;#]+/g, " ")
              .trim()
          : "");
      const product =
        skuMatch ?? products.find((candidate) => matchesProductSearch(candidate, name));
      const resolvedSku = sku ?? product?.sku ?? undefined;
      const resolvedRetailPrice = retailValue?.value || product?.sale_price || undefined;
      if (
        !name ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitCost) ||
        unitCost <= 0
      )
        return [];
      return [
        {
          id: newId(),
          product_id: product?.id ?? "",
          name,
          quantity,
          unit_cost: unitCost,
          source_total: sourceTotal && sourceTotal > 0 ? sourceTotal : quantity * unitCost,
          uom: product?.uom_sale ?? "Pcs",
          ...(resolvedSku ? { sku: resolvedSku } : {}),
          ...(resolvedRetailPrice ? { retail_price: resolvedRetailPrice } : {}),
        },
      ];
    })
    .slice(0, 100);
}
