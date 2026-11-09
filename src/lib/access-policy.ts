export type AccessClass = "public" | "staff";

export const accessPolicy = {
  pages: {
    public: ["/"],
    staff: ["/billing", "/sales", "/inventory", "/purchases", "/cash-drawer", "/manager"],
  },
  api: {
    public: ["/api/public-overview", "/api/first-admin"],
    staff: [
      "/api/retail-snapshot",
      "/api/retail-sync",
      "/api/resolve-sync-alert",
      "/api/staff",
      "/api/staff-password",
      "/api/staff-session",
    ],
    signIn: ["/api/staff-login", "/api/auth/*"],
  },
} as const;

export function pageAccessClass(pathname: string): AccessClass {
  return (accessPolicy.pages.public as readonly string[]).includes(pathname) ? "public" : "staff";
}
