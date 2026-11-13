/* eslint-disable react-refresh/only-export-components -- access context and access utilities are intentionally shared from this module. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type FormEvent,
  type ReactNode,
} from "react";
import { LockKeyhole, WifiOff } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteLocal,
  getAllLocal,
  getSetting,
  setSetting,
  subscribeLocalChanges,
  type KeyedRecord,
} from "@/lib/local-db";
import { retailApi, RetailApiError, userFacingError } from "@/lib/retail-api";
import { pageAccessClass } from "@/lib/access-policy";
import { summarizeIdleSales } from "@/lib/idle-analytics";
import { toast } from "sonner";

const IdleSalesChart = lazy(() =>
  import("@/components/pos/idle-sales-chart").then((module) => ({
    default: module.IdleSalesChart,
  })),
);

export type AccessRole = "CASHIER" | "MANAGER" | "ADMIN" | "WAREHOUSE";
export const ACTIVE_LOCATION_KEY = "pos-location-id";

export function saveActiveLocation(locationId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_LOCATION_KEY, locationId);
  window.dispatchEvent(new CustomEvent("retailflow:location-change", { detail: { locationId } }));
}

export interface UserAccessProfile {
  user_id: string;
  display_name: string;
  username: string;
  email: string | null;
  phone: string | null;
  must_change_password: boolean;
  role: AccessRole;
  location_ids: string[];
  cached_at: string;
}

function roleCanOpenPath(role: AccessRole, path: string) {
  if (role === "CASHIER") return ["/billing", "/cash-drawer", "/scanner"].includes(path);
  if (role === "WAREHOUSE") return ["/inventory", "/barcodes", "/scanner"].includes(path);
  if (role === "MANAGER")
    return [
      "/",
      "/sales",
      "/inventory",
      "/purchases",
      "/manager",
      "/cash-drawer",
      "/barcodes",
      "/scanner",
    ].includes(path);
  return [
    "/",
    "/admin",
    "/manager",
    "/sales",
    "/inventory",
    "/purchases",
    "/barcodes",
    "/scanner",
  ].includes(path);
}

interface AccessContextValue {
  profile: UserAccessProfile | null;
  online: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<UserAccessProfile | null>;
}

const AccessContext = createContext<AccessContextValue | null>(null);
const PENDING_LOGOUT_KEY = "retailflow-staff-logout-pending";

function hasPendingLogoutMarker() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(PENDING_LOGOUT_KEY) === "1";
  } catch {
    return false;
  }
}

async function logoutIsPending() {
  return hasPendingLogoutMarker() || (await getSetting<boolean>("staff_logout_pending")) === true;
}

export function useAccess() {
  return (
    useContext(AccessContext) ?? {
      profile: null,
      online: typeof navigator === "undefined" || navigator.onLine,
      signOut: async () => undefined,
      refresh: async () => null,
    }
  );
}

export function canAccessLocation(profile: UserAccessProfile | null, locationId: string) {
  if (!profile) return false;
  return profile.role === "ADMIN" || profile.location_ids.includes(locationId);
}

export function canManage(profile: UserAccessProfile | null) {
  return profile?.role === "MANAGER" || profile?.role === "ADMIN";
}

async function cachedProfile() {
  return (await getSetting<UserAccessProfile>("active_access_profile")) ?? null;
}

export async function loadAccessProfile(): Promise<UserAccessProfile | null> {
  const pendingLogout = await logoutIsPending();
  if (pendingLogout) {
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    try {
      await retailApi<{ ok: boolean }>("/api/staff-session", { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof RetailApiError && error.status === 401)) throw error;
    }
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw new Error(`Could not clear the local staff session: ${error.message}`);
    await deleteLocal("settings", "active_access_profile");
    await deleteLocal("settings", "staff_logout_pending");
    try {
      window.localStorage.removeItem(PENDING_LOGOUT_KEY);
    } catch {
      throw new Error(
        "Logout completed, but this browser could not clear its local logout marker.",
      );
    }
    return null;
  }
  const cached = await cachedProfile();
  if (typeof navigator !== "undefined" && !navigator.onLine) return cached;
  try {
    const { profile } = await retailApi<{ profile: UserAccessProfile }>("/api/staff-session");
    await setSetting("active_access_profile", profile);
    return profile;
  } catch (error) {
    if (error instanceof RetailApiError && error.status === 401) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError)
        throw new Error(`Could not clear the expired staff session: ${signOutError.message}`);
      await deleteLocal("settings", "active_access_profile");
      return null;
    }
    throw error;
  }
}

export function AccessBoundary({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserAccessProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine);
  const [logoutPending, setLogoutPending] = useState(false);
  const [accessError, setAccessError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await loadAccessProfile();
      const pending = await logoutIsPending();
      setProfile(next);
      setLogoutPending(pending);
      setAccessError("");
      setLoaded(true);
      return next;
    } catch (error) {
      setProfile(null);
      let pending = hasPendingLogoutMarker();
      try {
        pending = pending || (await logoutIsPending());
      } catch {
        pending = hasPendingLogoutMarker();
      }
      setLogoutPending(pending);
      setAccessError(
        userFacingError(error, "Could not verify staff access. Check your connection."),
      );
      setLoaded(true);
      return null;
    }
  }, []);

  const acceptSignedInProfile = useCallback(async (next: UserAccessProfile) => {
    await setSetting("active_access_profile", next);
    setProfile(next);
    setLogoutPending(false);
    setAccessError("");
    setLoaded(true);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
    const onOnline = () => {
      setOnline(true);
      void refresh();
    };
    const onOffline = () => setOnline(false);
    const onSessionChange = (event: Event) => {
      const signedInProfile = (event as CustomEvent<{ profile?: UserAccessProfile }>).detail
        ?.profile;
      if (signedInProfile) return;
      window.setTimeout(() => void refresh(), 0);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("retailflow:session-change", onSessionChange);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("retailflow:session-change", onSessionChange);
    };
  }, [refresh]);

  useEffect(() => {
    if (!profile || roleCanOpenPath(profile.role, pathname)) return;
    const destination =
      profile.role === "CASHIER"
        ? "/cash-drawer"
        : profile.role === "WAREHOUSE"
          ? "/inventory"
          : profile.role === "MANAGER"
            ? "/manager"
            : "/admin";
    void navigate({ to: destination });
  }, [profile, pathname, navigate]);

  const signOut = useCallback(async () => {
    if (profile?.role === "CASHIER") {
      const openShift = (await getAllLocal<KeyedRecord>("cash_sessions")).find(
        (session) =>
          session["status"] === "OPEN" &&
          profile.location_ids.includes(String(session["location_id"] ?? "")) &&
          session["opened_by_id"] === profile.user_id,
      );
      if (openShift) {
        toast.error("Close and reconcile your cash shift before signing out.");
        await navigate({ to: "/cash-drawer" });
        return;
      }
    }
    let serverLogoutCompleted = false;
    if (typeof navigator !== "undefined" && navigator.onLine) {
      try {
        await retailApi<{ ok: boolean }>("/api/staff-session", { method: "DELETE" });
        serverLogoutCompleted = true;
      } catch (error) {
        if (error instanceof RetailApiError && error.status === 401) {
          serverLogoutCompleted = true;
        } else if (
          profile?.role === "CASHIER" &&
          error instanceof RetailApiError &&
          error.status === 409
        ) {
          toast.error("Close and reconcile your cash shift before signing out.");
          await navigate({ to: "/cash-drawer" });
          return;
        } else {
          toast.error("Could not sign out", {
            description: userFacingError(error, "Reconnect and try again."),
          });
          return;
        }
      }
    } else if (profile?.role === "CASHIER") {
      toast.error("Reconnect before signing out so RetailFlow can verify the closed shift.");
      return;
    }
    setProfile(null);
    setLogoutPending(true);
    setAccessError("");
    setLoaded(true);
    let markerSaved = false;
    try {
      window.localStorage.setItem(PENDING_LOGOUT_KEY, "1");
      markerSaved = true;
    } catch {
      // IndexedDB remains the fallback if local storage is unavailable.
    }
    try {
      await setSetting("staff_logout_pending", true);
      markerSaved = true;
      await deleteLocal("settings", "active_access_profile");
    } catch (error) {
      if (!markerSaved) {
        setAccessError(
          error instanceof Error
            ? `This device is locked, but logout could not be saved locally: ${error.message}`
            : "This device is locked, but logout could not be saved locally.",
        );
        return;
      }
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setAccessError(
        serverLogoutCompleted
          ? "The server session is revoked. Reconnect to clear the local session."
          : "This device is locked. The server session will be revoked when you reconnect.",
      );
      return;
    }
    try {
      if (!serverLogoutCompleted) {
        await retailApi<{ ok: boolean }>("/api/staff-session", { method: "DELETE" });
      }
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError)
        throw new Error(
          `Server logout completed but local sign-out failed: ${signOutError.message}`,
        );
      await deleteLocal("settings", "active_access_profile");
      await deleteLocal("settings", "staff_logout_pending");
      try {
        window.localStorage.removeItem(PENDING_LOGOUT_KEY);
      } catch {
        throw new Error(
          "Server logout completed, but the local logout marker could not be cleared.",
        );
      }
      setLogoutPending(false);
      window.dispatchEvent(new CustomEvent("retailflow:session-change"));
    } catch (error) {
      setAccessError(
        error instanceof Error
          ? `This device is locked, but logout could not reach the server: ${error.message}`
          : "This device is locked. Reconnect to finish logout.",
      );
    }
  }, [profile, navigate]);

  const value = useMemo(
    () => ({ profile, online, signOut, refresh }),
    [profile, online, signOut, refresh],
  );
  if (!loaded)
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
        Loading this device’s access profile…
      </div>
    );
  if (!profile && pageAccessClass(pathname) === "public")
    return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
  if (!profile)
    return (
      <SignInScreen
        online={online}
        onSignedIn={acceptSignedInProfile}
        initialError={accessError}
        logoutPending={logoutPending}
      />
    );
  if (profile.must_change_password) return <ChangePasswordScreen onComplete={refresh} />;
  if (!roleCanOpenPath(profile.role, pathname))
    return (
      <div className="grid h-dvh place-items-center text-sm text-muted-foreground">
        Opening your permitted workspace…
      </div>
    );
  return (
    <AccessContext.Provider value={value}>
      <CashierShiftGate profile={profile}>
        <StaffIdleScreen profile={profile} online={online}>
          {children}
        </StaffIdleScreen>
      </CashierShiftGate>
    </AccessContext.Provider>
  );
}

function CashierShiftGate({
  profile,
  children,
}: {
  profile: UserAccessProfile;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    const refreshShift = async () => {
      const sessions = await getAllLocal<KeyedRecord>("cash_sessions");
      if (!active) return;
      const savedLocation =
        typeof window === "undefined"
          ? ""
          : (window.localStorage.getItem(ACTIVE_LOCATION_KEY) ?? "");
      const requiredLocation = profile.location_ids.includes(savedLocation)
        ? savedLocation
        : profile.location_ids.length === 1
          ? profile.location_ids[0]
          : null;
      setHasOpenShift(
        !!requiredLocation &&
          sessions.some(
            (session) =>
              session["status"] === "OPEN" &&
              session["location_id"] === requiredLocation &&
              session["opened_by_id"] === profile.user_id,
          ),
      );
      setChecked(true);
    };
    void refreshShift();
    const unsubscribe = subscribeLocalChanges((store) => {
      if (store === "cash_sessions") void refreshShift();
    });
    window.addEventListener("retailflow:location-change", refreshShift);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("retailflow:location-change", refreshShift);
    };
  }, [profile.location_ids, profile.user_id]);

  useEffect(() => {
    if (profile.role === "CASHIER" && checked && !hasOpenShift && pathname !== "/cash-drawer")
      void navigate({ to: "/cash-drawer" });
  }, [profile.role, checked, hasOpenShift, pathname, navigate]);

  if (profile.role === "CASHIER" && pathname !== "/cash-drawer" && (!checked || !hasOpenShift))
    return (
      <div className="grid h-dvh place-items-center text-sm text-muted-foreground">
        Opening the cash drawer…
      </div>
    );
  return children;
}

type IdleStats = {
  bills: number;
  sales: number;
  lowStock: number;
  pendingSync: number;
  syncAlerts: number;
  enrichment: number;
  purchases: number;
  salesTrend: Array<{ day: string; sales: number }>;
};
const EMPTY_IDLE_STATS: IdleStats = {
  bills: 0,
  sales: 0,
  lowStock: 0,
  pendingSync: 0,
  syncAlerts: 0,
  enrichment: 0,
  purchases: 0,
  salesTrend: [],
};

function pinDigest(pin: string, salt: string) {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`))
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

function StaffIdleScreen({
  profile,
  online,
  children,
}: {
  profile: UserAccessProfile;
  online: boolean;
  children: ReactNode;
}) {
  const [idle, setIdle] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [stats, setStats] = useState(EMPTY_IDLE_STATS);
  const [savedPin, setSavedPin] = useState<{ salt: string; hash: string } | null>(null);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirmation, setPinConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const resumeFormRef = useRef<HTMLFormElement>(null);
  const idleRef = useRef(false);
  const lastActivity = useRef(Date.now());
  const pinSettingKey = `staff_device_resume_pin:${profile.user_id}`;

  useEffect(() => {
    let timer = 0;
    const enterIdle = () => {
      idleRef.current = true;
      setShowUnlock(false);
      setIdle(true);
    };
    const resetActivity = () => {
      if (idleRef.current) {
        setShowUnlock(true);
        return;
      }
      lastActivity.current = Date.now();
      window.clearTimeout(timer);
      timer = window.setTimeout(enterIdle, 5 * 60 * 1000);
    };
    const checkInactivity = () => {
      if (!idleRef.current && Date.now() - lastActivity.current >= 5 * 60 * 1000) enterIdle();
    };
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "keydown",
      "touchstart",
      "scroll",
    ];
    events.forEach((eventName) =>
      window.addEventListener(eventName, resetActivity, { passive: true }),
    );
    document.addEventListener("visibilitychange", checkInactivity);
    timer = window.setTimeout(enterIdle, 5 * 60 * 1000);
    const checkTimer = window.setInterval(checkInactivity, 10000);
    void getSetting<{ salt: string; hash: string }>(pinSettingKey).then((value) =>
      setSavedPin(value ?? null),
    );
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(checkTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, resetActivity));
      document.removeEventListener("visibilitychange", checkInactivity);
    };
  }, [profile.user_id, pinSettingKey]);

  useEffect(() => {
    if (showUnlock) resumeFormRef.current?.querySelector("input")?.focus();
  }, [showUnlock]);

  useEffect(() => {
    if (!idle) return;
    let active = true;
    const refreshStats = async () => {
      const [locations, salesRows, products, inventory, outbox, purchases, alerts] =
        await Promise.all([
          getAllLocal<KeyedRecord>("locations"),
          getAllLocal<KeyedRecord>("bills"),
          getAllLocal<KeyedRecord>("catalog"),
          getAllLocal<KeyedRecord>("inventory_snapshot"),
          getAllLocal<KeyedRecord>("outbox"),
          getAllLocal<KeyedRecord>("purchases"),
          getAllLocal<KeyedRecord>("sync_alerts"),
        ]);
      if (!active) return;
      const selected =
        typeof window === "undefined"
          ? ""
          : (window.localStorage.getItem(ACTIVE_LOCATION_KEY) ?? "");
      const available =
        profile.role === "ADMIN"
          ? locations.map((row) => String(row["id"] ?? ""))
          : profile.location_ids;
      const scope =
        selected && (profile.role === "ADMIN" || profile.location_ids.includes(selected))
          ? [selected]
          : available;
      const scopedBills = salesRows.filter(
        (row) =>
          scope.includes(String(row["location_id"] ?? "")) &&
          String(row["status"] || row["invoice_status"] || "").toUpperCase() === "COMPLETED" &&
          (profile.role !== "CASHIER" || row["cashier_id"] === profile.user_id),
      );
      const { bills, sales, salesTrend } = summarizeIdleSales(
        scopedBills.map((row) => ({
          business_date: String(row["business_date"] ?? ""),
          created_at: String(row["created_at"] ?? ""),
          total_amount: Number(row["total_amount"] ?? 0),
          status: String(row["status"] ?? ""),
          invoice_status: String(row["invoice_status"] ?? ""),
        })),
      );
      const productById = new Map(products.map((row) => [String(row["id"] ?? ""), row]));
      const lowStock = inventory.filter((row) => {
        if (!scope.includes(String(row["location_id"] ?? ""))) return false;
        const product = productById.get(String(row["product_id"] ?? ""));
        return (
          !!product &&
          Number(product["min_stock"] ?? 0) > 0 &&
          Number(row["quantity_on_hand"] ?? 0) <= Number(product["min_stock"] ?? 0)
        );
      }).length;
      const pendingSync = outbox.filter(
        (row) =>
          row["sync_status"] === "PENDING" &&
          (!row["outlet_id"] || scope.includes(String(row["outlet_id"]))),
      ).length;
      const syncAlerts = alerts.filter(
        (row) => !row["resolved_at"] && scope.includes(String(row["location_id"] ?? "")),
      ).length;
      const scopedProductIds = new Set(
        inventory
          .filter((row) => scope.includes(String(row["location_id"] ?? "")))
          .map((row) => String(row["product_id"] ?? "")),
      );
      const enrichment = canManage(profile)
        ? products.filter(
            (row) =>
              row["enrichment_status"] === "PENDING" &&
              scopedProductIds.has(String(row["id"] ?? "")),
          ).length
        : 0;
      const openPurchases = canManage(profile)
        ? purchases.filter(
            (row) =>
              scope.includes(String(row["warehouse_location_id"] ?? "")) &&
              ["DRAFT", "REVIEW", "PENDING"].includes(String(row["status"] ?? "").toUpperCase()),
          ).length
        : 0;
      setStats({
        bills,
        sales,
        lowStock,
        pendingSync,
        syncAlerts,
        enrichment,
        purchases: openPurchases,
        salesTrend,
      });
    };
    void refreshStats();
    const timer = window.setInterval(() => void refreshStats(), 30000);
    const unsubscribe = subscribeLocalChanges((store) => {
      if (
        ["bills", "inventory_snapshot", "outbox", "catalog", "purchases", "sync_alerts"].includes(
          store,
        )
      )
        void refreshStats();
    });
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [idle, profile]);

  async function resume(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setMessage("");
    try {
      if (online) {
        if (!password) throw new Error("Enter this staff account’s password to resume.");
        const { data: previous } = await supabase.auth.getSession();
        const result = await retailApi<{
          ok: boolean;
          profile: UserAccessProfile;
          session: { access_token: string; refresh_token: string };
        }>("/api/pos/login", { method: "POST", json: { identifier: profile.username, password } });
        const { data, error } = await supabase.auth.setSession(result.session);
        if (error || !data.user) throw new Error("Password verification failed. Try again.");
        if (data.user.id !== profile.user_id || result.profile.user_id !== profile.user_id) {
          if (previous.session)
            await supabase.auth.setSession({
              access_token: previous.session.access_token,
              refresh_token: previous.session.refresh_token,
            });
          else await supabase.auth.signOut({ scope: "local" });
          throw new Error("Use the credentials for the staff member who opened this screen.");
        }
      } else {
        if (!/^\d{6,8}$/.test(pin)) throw new Error("Enter the 6 to 8 digit device PIN.");
        if (!savedPin) {
          if (pin !== pinConfirmation) throw new Error("The device PIN entries do not match.");
          const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          const stored = { salt, hash: await pinDigest(pin, salt) };
          await setSetting(pinSettingKey, stored);
          setSavedPin(stored);
        } else if ((await pinDigest(pin, savedPin.salt)) !== savedPin.hash) {
          throw new Error("That device PIN is incorrect.");
        }
      }
      idleRef.current = false;
      lastActivity.current = Date.now();
      setIdle(false);
      setPassword("");
      setPin("");
      setPinConfirmation("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify this staff member.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      {children}
      {idle && (
        <div
          className={`retailflow-lock-screen fixed inset-0 z-[100] overflow-y-auto p-4 text-white transition-colors sm:p-8 ${showUnlock ? "bg-black/50" : ""}`}
          onPointerMove={() => setShowUnlock(true)}
          onPointerDown={() => setShowUnlock(true)}
          onTouchStart={() => setShowUnlock(true)}
          onKeyDown={() => setShowUnlock(true)}
          tabIndex={-1}
        >
          <div className="retailflow-lock-glow" aria-hidden="true" />
          <div
            aria-hidden={showUnlock}
            inert={showUnlock}
            className={`relative mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-5 transition-all duration-200 ${showUnlock ? "pointer-events-none scale-[0.99] opacity-20 blur-sm" : ""}`}
          >
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-emerald-200/80">
                  RetailFlow · {profile.role.toLowerCase()}
                </p>
                <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Store at a glance</h1>
              </div>
              <p className="text-sm text-white/60">
                {new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeStyle: "short" }).format(
                  new Date(),
                )}
              </p>
            </header>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.3fr_1fr]">
              <div className="retailflow-lock-panel min-h-56 rounded-2xl border border-white/15 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/65">Sales · last 7 days</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-IN", {
                        style: "currency",
                        currency: "INR",
                        maximumFractionDigits: 0,
                      }).format(stats.sales)}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                    {stats.bills} bills today
                  </span>
                </div>
                <div className="mt-3 h-36 w-full">
                  <Suspense
                    fallback={
                      <div className="grid h-full place-items-center text-xs text-white/55">
                        Loading sales chart…
                      </div>
                    }
                  >
                    <IdleSalesChart data={stats.salesTrend} />
                  </Suspense>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <IdleMetric label="Bills today" value={String(stats.bills)} />
                <IdleMetric label="Low stock" value={String(stats.lowStock)} />
                <IdleMetric label="Pending sync" value={String(stats.pendingSync)} />
                <IdleMetric label="Stock alerts" value={String(stats.syncAlerts)} />
              </div>
            </section>
            <section className="retailflow-lock-panel rounded-2xl border border-white/15 p-4">
              <h2 className="font-medium">Action items</h2>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <IdleAction label="Records waiting to sync" value={stats.pendingSync} />
                <IdleAction label="Stock sync alerts" value={stats.syncAlerts} />
                <IdleAction label="Items for Manager review" value={stats.enrichment} />
                <IdleAction label="Purchases awaiting receipt" value={stats.purchases} />
              </div>
            </section>
            {!showUnlock && (
              <button
                type="button"
                className="retailflow-lock-prompt ml-auto rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm text-white/85 transition hover:bg-white/15"
                onClick={() => setShowUnlock(true)}
              >
                Move the mouse or press a key to unlock
              </button>
            )}
          </div>
          {showUnlock && (
            <Dialog open={showUnlock} onOpenChange={setShowUnlock}>
              <DialogContent
                className="z-[120] max-w-md border-white/20 bg-slate-950 p-5 text-white shadow-2xl [&>button]:hidden"
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  window.requestAnimationFrame(() =>
                    resumeFormRef.current?.querySelector("input")?.focus(),
                  );
                }}
                onEscapeKeyDown={() => setShowUnlock(false)}
              >
                <DialogHeader className="space-y-1 text-left">
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <LockKeyhole className="h-4 w-4" />
                    Resume as {profile.display_name}
                  </DialogTitle>
                  <DialogDescription className="text-white/65">
                    Verify your identity to unlock this POS session.
                  </DialogDescription>
                </DialogHeader>
                <form
                  ref={resumeFormRef}
                  onSubmit={(event) => void resume(event)}
                  className="space-y-3"
                >
                  {online ? (
                    <div className="space-y-1">
                      <Label htmlFor="idle-password" className="text-white/80">
                        Staff password
                      </Label>
                      <Input
                        id="idle-password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      <p className="flex items-center gap-2 text-xs text-white/65">
                        <WifiOff className="h-3.5 w-3.5" />
                        Offline resume uses this device’s PIN.
                      </p>
                      <div className="space-y-1">
                        <Label htmlFor="idle-pin" className="text-white/80">
                          {savedPin ? "Device PIN" : "Create a 6 to 8 digit device PIN"}
                        </Label>
                        <Input
                          id="idle-pin"
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          value={pin}
                          onChange={(event) => setPin(event.target.value)}
                        />
                      </div>
                      {!savedPin && (
                        <div className="space-y-1">
                          <Label htmlFor="idle-pin-confirm" className="text-white/80">
                            Confirm device PIN
                          </Label>
                          <Input
                            id="idle-pin-confirm"
                            type="password"
                            inputMode="numeric"
                            autoComplete="off"
                            value={pinConfirmation}
                            onChange={(event) => setPinConfirmation(event.target.value)}
                          />
                        </div>
                      )}
                    </>
                  )}
                  {message && (
                    <p role="alert" className="text-sm text-rose-200">
                      {message}
                    </p>
                  )}
                  <Button className="w-full" disabled={working}>
                    {working ? "Verifying…" : "Resume POS"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
    </>
  );
}

function IdleMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
      <p className="text-sm text-white/60">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function IdleAction({ label, value }: { label: string; value: number }) {
  return (
    <p className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </p>
  );
}

function ChangePasswordScreen({
  onComplete,
}: {
  onComplete: () => Promise<UserAccessProfile | null>;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [changed, setChanged] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    if (password.length < 10) {
      setMessage("Choose a password with at least 10 characters.");
      return;
    }
    if (password !== confirmation) {
      setMessage("The passwords do not match.");
      return;
    }
    setWorking(true);
    setMessage("");
    try {
      await retailApi<{ ok: boolean }>("/api/staff-password", {
        method: "POST",
        json: { password },
      });
      setChanged(true);
    } catch (error) {
      setMessage(userFacingError(error, "Could not update your password. Try again."));
      setWorking(false);
    }
  }

  async function continueToPos() {
    await deleteLocal("settings", "active_access_profile");
    window.dispatchEvent(new CustomEvent("retailflow:session-change"));
    await onComplete();
  }

  async function backToLogin() {
    try {
      await retailApi<{ ok: boolean }>("/api/staff-session", { method: "DELETE" });
    } finally {
      await supabase.auth.signOut({ scope: "local" });
      await deleteLocal("settings", "active_access_profile");
      window.dispatchEvent(new CustomEvent("retailflow:session-change"));
      await onComplete();
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-lg"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold">
            {changed ? "Password changed" : "Set your password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {changed
              ? "Your new password is active. Continue into RetailFlow or return to sign in and verify your new credentials."
              : "Use a personal password before opening RetailFlow. The one-time password cannot be used again after this step."}
          </p>
        </div>
        {changed ? (
          <div className="space-y-2">
            <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">
              Password updated successfully.
            </p>
            <Button type="button" className="w-full" onClick={() => void continueToPos()}>
              Continue to RetailFlow
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void backToLogin()}
            >
              Return to sign-in
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                placeholder="Enter a new password"
                minLength={10}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm your new password"
                minLength={10}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            <Button className="w-full" disabled={working}>
              {working ? "Updating…" : "Set password and continue"}
            </Button>
          </>
        )}
      </form>
    </main>
  );
}

function SignInScreen({
  online,
  onSignedIn,
  initialError,
  logoutPending,
}: {
  online: boolean;
  onSignedIn: (profile: UserAccessProfile) => Promise<UserAccessProfile>;
  initialError: string;
  logoutPending: boolean;
}) {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(initialError);

  useEffect(() => {
    setMessage(initialError);
  }, [initialError]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!online || working || logoutPending) return;
    setWorking(true);
    setMessage("");
    try {
      const { session, profile } = await retailApi<{
        ok: boolean;
        session: { access_token: string; refresh_token: string };
        profile: UserAccessProfile;
      }>("/api/pos/login", {
        method: "POST",
        json: { identifier: identifier.trim(), password },
      });
      const { error } = await supabase.auth.setSession(session);
      if (error) throw error;
      await onSignedIn(profile);
      window.dispatchEvent(new CustomEvent("retailflow:session-change", { detail: { profile } }));
      await navigate({
        to:
          profile.role === "ADMIN"
            ? "/admin"
            : profile.role === "MANAGER"
              ? "/manager"
              : profile.role === "WAREHOUSE"
                ? "/inventory"
                : "/cash-drawer",
      });
    } catch (error) {
      if (error instanceof RetailApiError && error.status === 401) {
        setMessage(
          "Supabase Auth could not verify these credentials. Check the email, username or mobile number and password, then try again.",
        );
      } else {
        setMessage(userFacingError(error, "Could not sign in. Check your details and connection."));
      }
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-lg"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Sign in to RetailFlow</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your email, username or confirmed mobile number and password. Your account
            also needs an active RetailFlow role profile.
          </p>
        </div>
        {!online && (
          <p className="flex items-center gap-2 rounded-lg bg-warning/10 p-3 text-sm">
            <WifiOff className="h-4 w-4" /> Offline. Sign in on this device while online once to
            continue with its cached access.
          </p>
        )}
        {logoutPending && (
          <p role="status" className="rounded-lg bg-warning/10 p-3 text-sm">
            This device is locked until the pending logout reaches the server. Reconnect to finish
            logout before another staff member signs in.
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="login-email">Email, username or mobile number</Label>
          <Input
            id="login-email"
            type="text"
            autoComplete="username"
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Email, username or +91 98765 43210"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <Button className="w-full" disabled={!online || working || logoutPending}>
          {working ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-xs text-muted-foreground">
          One sign-in form works for every role. An active RetailFlow profile and location
          assignments are required for POS access.
        </p>
      </form>
    </main>
  );
}
