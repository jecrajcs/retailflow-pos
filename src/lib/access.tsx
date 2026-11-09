/* eslint-disable react-refresh/only-export-components -- access context and access utilities are intentionally shared from this module. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LockKeyhole, WifiOff } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteLocal, getSetting, setSetting } from "@/lib/local-db";
import { retailApi, RetailApiError, userFacingError } from "@/lib/retail-api";
import { pageAccessClass } from "@/lib/access-policy";

export type AccessRole = "CASHIER" | "MANAGER" | "ADMIN";
export const ACTIVE_LOCATION_KEY = "pos-location-id";

export function saveActiveLocation(locationId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_LOCATION_KEY, locationId);
  window.dispatchEvent(new CustomEvent("retailflow:location-change", { detail: { locationId } }));
}

export interface UserAccessProfile {
  user_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  must_change_password: boolean;
  role: AccessRole;
  location_ids: string[];
  cached_at: string;
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

  const signOut = useCallback(async () => {
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
        "This device is locked. The server session will be revoked when you reconnect.",
      );
      return;
    }
    try {
      try {
        await retailApi<{ ok: boolean }>("/api/staff-session", { method: "DELETE" });
      } catch (error) {
        if (!(error instanceof RetailApiError && error.status === 401)) throw error;
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
  }, []);

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
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
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
      await deleteLocal("settings", "active_access_profile");
      window.dispatchEvent(new CustomEvent("retailflow:session-change"));
      await onComplete();
    } catch (error) {
      setMessage(userFacingError(error, "Could not update your password. Try again."));
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
          <h1 className="text-xl font-bold">Set your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use a personal password before opening RetailFlow. The one-time password cannot be used
            again after this step.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
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
        to: profile.role === "ADMIN" ? "/admin" : profile.role === "MANAGER" ? "/manager" : "/billing",
      });
    } catch (error) {
      if (error instanceof RetailApiError && error.status === 401) {
        setMessage(
          "Supabase Auth could not verify these credentials. Check the email/mobile and password, confirm the sign-in method if required, and make sure this POS uses the same Supabase project.",
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
            Sign in with your Supabase Auth email or confirmed mobile number and password. Your
            account also needs an active RetailFlow role profile.
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
          <Label htmlFor="login-email">Supabase Auth email or mobile number</Label>
          <Input
            id="login-email"
            type="text"
            autoComplete="username"
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="email@example.com or +91 98765 43210"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
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
