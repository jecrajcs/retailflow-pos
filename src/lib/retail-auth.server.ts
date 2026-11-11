import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type StaffRole = "CASHIER" | "MANAGER" | "ADMIN";

export interface StaffAccessProfile {
  user_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  must_change_password: boolean;
  role: StaffRole;
  location_ids: string[];
  cached_at: string;
}

function accessToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function getStaffAccessProfile(userId: string): Promise<StaffAccessProfile | null> {
  const [{ data: staff, error }, { data: assignments, error: assignmentError }] = await Promise.all(
    [
      supabaseAdmin
        .from("users")
        .select("user_id,display_name,email,phone,role,is_active,must_change_password")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin.from("staff_location_access").select("location_id").eq("user_id", userId),
    ],
  );

  if (error) throw new Error(`Could not load staff profile: ${error.message}`);
  if (assignmentError)
    throw new Error(`Could not load staff location access: ${assignmentError.message}`);
  if (!staff || !staff.is_active) return null;

  const role = String(staff.role).toUpperCase();
  if (!["CASHIER", "MANAGER", "ADMIN"].includes(role)) return null;

  return {
    user_id: userId,
    display_name: staff.display_name || "Staff",
    email: staff.email || null,
    phone: staff.phone || null,
    must_change_password: staff.must_change_password,
    role: role as StaffRole,
    location_ids: assignments.map((item) => item.location_id),
    cached_at: new Date().toISOString(),
  };
}

export async function getStaffSession(request: Request) {
  const token = accessToken(request);
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;

  const profile = await getStaffAccessProfile(data.user.id);
  if (!profile) return null;
  return {
    authUser: data.user,
    authSession: { token },
    profile,
  };
}

export async function revokeStaffSession(request: Request) {
  const token = accessToken(request);
  if (!token) return;
  const { error } = await supabaseAdmin.auth.admin.signOut(token, "local");
  if (error) throw new Error(`Could not revoke the staff session: ${error.message}`);
}

export function normalizeStaffIdentifier(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Enter a valid email address or mobile number.");
    return `email:${email}`;
  }
  const compact = trimmed.replace(/[\s().-]/g, "");
  let phone = compact;
  if (!phone.startsWith("+")) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) phone = `+91${digits}`;
    else if (digits.length === 12 && digits.startsWith("91")) phone = `+${digits}`;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new Error("Enter a valid mobile number in international format.");
  return `phone:${phone}`;
}

export function normalizeStaffPhone(value: string) {
  const identifier = normalizeStaffIdentifier(value);
  if (!identifier.startsWith("phone:"))
    throw new Error("Enter a valid mobile number in international format.");
  return identifier.slice("phone:".length);
}

export async function createStaffAuthUser(input: {
  displayName: string;
  email: string | null;
  phone: string | null;
  password: string;
}) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    ...(input.email ? { email: input.email, email_confirm: true } : {}),
    ...(input.phone ? { phone: input.phone, phone_confirm: true } : {}),
    password: input.password,
    user_metadata: { display_name: input.displayName },
  });
  if (error) throw new Error(`Could not create the Supabase Auth user: ${error.message}`);
  if (!data.user) throw new Error("Supabase Auth did not return the created user.");
  return data.user.id;
}

export async function updateStaffAuthUser(
  userId: string,
  input: { displayName: string; email: string | null; phone: string | null; password?: string },
) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    ...(input.email ? { email: input.email } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.password ? { password: input.password } : {}),
    ...(input.email ? { email_confirm: true } : {}),
    ...(input.phone ? { phone_confirm: true } : {}),
    user_metadata: { display_name: input.displayName },
  });
  if (error) throw new Error(`Could not update the Supabase Auth user: ${error.message}`);
}

export async function replaceStaffPassword(userId: string, password: string) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
  if (error) throw new Error(`Could not update the staff password: ${error.message}`);
}

export async function verifyStaffPasswordLogin(
  userId: string,
  login: string | Array<string | null>,
  password: string,
) {
  const logins = (Array.isArray(login) ? login : [login]).filter(
    (value): value is string => !!value,
  );
  if (!logins.length) return false;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Supabase Auth verification is not configured.");

  const authClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  for (const value of logins) {
    const normalized = normalizeStaffIdentifier(value);
    const credentials = normalized.startsWith("email:")
      ? { email: normalized.slice("email:".length), password }
      : { phone: normalized.slice("phone:".length), password };
    const { data, error } = await authClient.auth.signInWithPassword(credentials);
    if (error || data.user?.id !== userId) {
      await authClient.auth.signOut({ scope: "local" });
      continue;
    }
    const { error: signOutError } = await authClient.auth.signOut({ scope: "local" });
    if (signOutError)
      throw new Error(
        `Password sign-in succeeded, but verification cleanup failed: ${signOutError.message}`,
      );
    return true;
  }
  return false;
}

export async function removeStaffAuthUser(userId: string) {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Could not remove the incomplete staff account: ${error.message}`);
}
