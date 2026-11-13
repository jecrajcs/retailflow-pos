import type { LocalPurchaseReceipt, Product } from "@/lib/pos";

export type ExpiringProductSuggestion = {
  product: Product;
  quantity: number;
  expiresOn: string;
};

export function expiringProductSuggestions(
  purchases: LocalPurchaseReceipt[],
  products: Product[],
  availableProductIds: Set<string>,
  now = new Date(),
  horizonDays = 30,
): ExpiringProductSuggestion[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastDay = new Date(today);
  lastDay.setDate(lastDay.getDate() + horizonDays);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const suggestions = new Map<string, ExpiringProductSuggestion>();

  for (const receipt of purchases) {
    if (receipt.status !== "RECEIVED") continue;
    for (const item of receipt.items) {
      if (!item.expires_on || !availableProductIds.has(item.product_id)) continue;
      const expiry = new Date(`${item.expires_on}T00:00:00`);
      if (Number.isNaN(expiry.getTime()) || expiry < today || expiry > lastDay) continue;
      const product = productsById.get(item.product_id);
      if (!product) continue;
      const current = suggestions.get(item.product_id);
      if (!current) {
        suggestions.set(item.product_id, {
          product,
          quantity: item.quantity,
          expiresOn: item.expires_on,
        });
      } else {
        current.quantity += item.quantity;
        if (item.expires_on < current.expiresOn) current.expiresOn = item.expires_on;
      }
    }
  }

  return [...suggestions.values()].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}
