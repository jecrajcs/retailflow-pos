import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retailFlowAuthAdapter } from "@/integrations/supabase/better-auth-adapter.server";

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

export class AuthConfigurationError extends Error {
  constructor() {
    super("Staff authentication configuration is incomplete or invalid.");
    this.name = "AuthConfigurationError";
  }
}

export function getAuthServerUrl() {
  const configuredUrl = process.env["BETTER_AUTH_URL"]?.trim();
  if (!configuredUrl) throw new AuthConfigurationError();

  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredUrl);
  } catch {
    throw new AuthConfigurationError();
  }
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    (process.env["NODE_ENV"] === "production" && baseUrl.protocol !== "https:")
  ) {
    throw new AuthConfigurationError();
  }

  const configuredOrigin = process.env["BETTER_AUTH_TRUSTED_ORIGIN"]?.trim();
  let trustedOrigin = baseUrl.origin;
  if (configuredOrigin) {
    try {
      const parsedOrigin = new URL(configuredOrigin);
      if (
        parsedOrigin.origin !== configuredOrigin.replace(/\/$/, "") ||
        !["http:", "https:"].includes(parsedOrigin.protocol)
      ) {
        throw new AuthConfigurationError();
      }
      if (process.env["NODE_ENV"] === "production" && parsedOrigin.protocol !== "https:") {
        throw new AuthConfigurationError();
      }
      trustedOrigin = parsedOrigin.origin;
    } catch (error) {
      if (error instanceof AuthConfigurationError) throw error;
      throw new AuthConfigurationError();
    }
  }

  return { baseURL: baseUrl.origin, trustedOrigins: [trustedOrigin] };
}

function createRetailAuth() {
  const serverSecret = process.env["BETTER_AUTH_SECRET"];
  if (!serverSecret || serverSecret.length < 32) throw new AuthConfigurationError();
  const serverUrl = getAuthServerUrl();

  return betterAuth({
    appName: "RetailFlow POS",
    basePath: "/api/auth",
    database: retailFlowAuthAdapter,
    secret: serverSecret,
    ...serverUrl,
    advanced: {
      database: { validateSchema: false },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env["NODE_ENV"] === "production",
        path: "/",
      },
      useSecureCookies: process.env["NODE_ENV"] === "production",
    },
    user: {
      modelName: "auth_users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "auth_sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
      },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    rateLimit: {
      enabled: true,
      modelName: "auth_rate_limits",
      fields: { lastRequest: "last_request" },
      storage: "database",
      window: 60,
      max: 8,
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    plugins: [tanstackStartCookies()],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const profile = await getStaffAccessProfile(session.userId);
            if (!profile) return false;
            return { data: session };
          },
        },
      },
    },
  });
}

let retailAuthInstance: ReturnType<typeof createRetailAuth> | undefined;

export function getRetailAuth() {
  return (retailAuthInstance ??= createRetailAuth());
}

type AuthDirectoryResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};
type AuthDirectoryQuery = PromiseLike<AuthDirectoryResult> & {
  select: (columns: string) => AuthDirectoryQuery;
  eq: (field: string, value: string) => AuthDirectoryQuery;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
};
type AuthDirectoryClient = { from: (table: string) => AuthDirectoryQuery };

export async function getStaffAccessProfile(userId: string): Promise<StaffAccessProfile | null> {
  const client = supabaseAdmin as unknown as AuthDirectoryClient;
  const [{ data: staff, error }, { data: assignments, error: assignmentError }] = await Promise.all(
    [
      client
        .from("users")
        .select("user_id, display_name, email, phone, role, is_active, must_change_password")
        .eq("user_id", userId)
        .maybeSingle(),
      client.from("staff_location_access").select("location_id").eq("user_id", userId),
    ],
  );
  if (error) throw new Error(`Could not load staff profile: ${error.message}`);
  if (assignmentError)
    throw new Error(`Could not load staff location access: ${assignmentError.message}`);
  if (!staff || staff["is_active"] === false) return null;
  const role = String(staff["role"]).toUpperCase() as StaffRole;
  if (!["CASHIER", "MANAGER", "ADMIN"].includes(role)) return null;
  return {
    user_id: userId,
    display_name: String(staff["display_name"] ?? "Staff"),
    email: staff["email"] ? String(staff["email"]) : null,
    phone: staff["phone"] ? String(staff["phone"]) : null,
    must_change_password: staff["must_change_password"] === true,
    role,
    location_ids: (assignments ?? []).map((item) => String(item["location_id"])),
    cached_at: new Date().toISOString(),
  };
}

export async function getStaffSession(request: Request) {
  const session = await getRetailAuth().api.getSession({ headers: request.headers });
  if (!session) return null;
  const profile = await getStaffAccessProfile(session.user.id);
  if (!profile) return null;
  return { authUser: session.user, authSession: session.session, profile };
}

export async function requireStaffSession(request: Request) {
  const session = await getStaffSession(request);
  if (!session) throw new Response("An active staff session is required.", { status: 401 });
  return session;
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

export async function resolveStaffAuthEmail(identifier: string) {
  const normalized = normalizeStaffIdentifier(identifier);
  const client = supabaseAdmin as unknown as AuthDirectoryClient;
  const { data, error } = await client
    .from("auth_login_identifiers")
    .select("user_id")
    .eq("normalized_identifier", normalized)
    .maybeSingle();
  if (error) throw new Error(`Could not resolve staff login: ${error.message}`);
  if (!data?.["user_id"]) return null;
  const profile = await getStaffAccessProfile(String(data["user_id"]));
  if (!profile) return null;
  const result = await getRetailAuth().$context;
  const user = await result.internalAdapter.findUserById(String(data["user_id"]));
  return user ? { profile, email: user.email } : null;
}

export async function createStaffCredential(input: {
  userId?: string;
  displayName: string;
  temporaryPassword: string;
}) {
  const context = await getRetailAuth().$context;
  const userId = input.userId ?? crypto.randomUUID();
  const authEmail = `staff-${userId.replaceAll("-", "")}@accounts.retailflow.invalid`;
  const existingUser = await context.internalAdapter.findUserById(userId);
  const user =
    existingUser ??
    (await context.internalAdapter.createUser(
      { id: userId, name: input.displayName, email: authEmail, emailVerified: false },
      { method: "admin" },
    ));
  const existingCredential = await context.internalAdapter.findCredentialAccount(userId);
  if (existingCredential) {
    if (!existingUser) await context.internalAdapter.deleteUser(userId);
    throw new Error("This staff account already has a password. Use the reset-password action.");
  }
  try {
    const password = await context.password.hash(input.temporaryPassword);
    await context.internalAdapter.linkAccount({
      providerId: "credential",
      accountId: user.id,
      password,
      userId: user.id,
    });
  } catch (error) {
    if (!existingUser) await context.internalAdapter.deleteUser(user.id);
    throw error;
  }
  return { userId: user.id, authEmail: user.email, createdUser: !existingUser };
}

type SessionDeleteQuery = PromiseLike<{ error: { message: string } | null }> & {
  eq: (field: string, value: string) => SessionDeleteQuery;
  neq: (field: string, value: string) => SessionDeleteQuery;
};
type SessionService = {
  from: (table: string) => { delete: () => SessionDeleteQuery };
};

export async function replaceStaffPassword(
  userId: string,
  password: string,
  preserveSessionToken?: string,
) {
  const context = await getRetailAuth().$context;
  const passwordHash = await context.password.hash(password);
  await context.internalAdapter.updatePassword(userId, passwordHash);
  if (!preserveSessionToken) {
    await context.internalAdapter.deleteUserSessions(userId);
    return;
  }
  const client = supabaseAdmin as unknown as SessionService;
  const { error } = await client
    .from("auth_sessions")
    .delete()
    .eq("user_id", userId)
    .neq("token", preserveSessionToken);
  if (error) throw new Error(`Could not revoke the other staff sessions: ${error.message}`);
}

export async function removeStaffCredential(userId: string, deleteUser: boolean) {
  const context = await getRetailAuth().$context;
  if (deleteUser) {
    await context.internalAdapter.deleteUser(userId);
    return;
  }
  const account = await context.internalAdapter.findCredentialAccount(userId);
  if (account) await context.internalAdapter.deleteAccount(account.id);
}
