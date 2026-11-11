export type AccessClass = "public" | "staff";

export const accessPolicy = {
  pages: {
    public: ["/"],
    staff: ["/billing", "/sales", "/inventory", "/purchases", "/cash-drawer", "/manager", "/admin", "/barcodes", "/scanner"],
  },
  api: {
    public: ["/api/public-overview"],
    staff: [
      "/api/retail-snapshot",
      "/api/retail-sync",
      "/api/resolve-sync-alert",
      "/api/staff",
      "/api/staff-password",
      "/api/staff-session",
      "/api/cash-session-override",
      "/api/retail-workbook-import",
    "/api/staff-username",
    "/api/admin/archive-product",
    "/api/barcode-candidate",
    ],
    signIn: ["/api/pos/login"],
  },
} as const;

export function pageAccessClass(pathname: string): AccessClass {
  return (accessPolicy.pages.public as readonly string[]).includes(pathname) ? "public" : "staff";
}
