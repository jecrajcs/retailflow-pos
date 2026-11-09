import { createFileRoute } from "@tanstack/react-router";

import {
  createStaffCredential,
  getStaffAccessProfile,
  normalizeStaffIdentifier,
  normalizeStaffPhone,
  removeStaffCredential,
  resolveStaffAuthEmail,
} from "@/lib/retail-auth.server";
import {
  asRecord,
  errorResponse,
  isSameOriginMutation,
  jsonResponse,
} from "@/lib/retail-server-api.server";

type Query = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}> & {
  select: (columns?: string) => Query;
};
type BootstrapService = {
  from: (table: string) => Query;
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
async function getBootstrapService() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as BootstrapService;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/first-admin")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const service = await getBootstrapService();
          const [
            { data: tokens, error },
            { data: admins, error: adminError },
            { data: accounts, error: accountError },
          ] = await Promise.all([
            service.from("auth_bootstrap_tokens").select("consumed_at"),
            service.from("users").select("user_id,role,is_active"),
            service.from("auth_accounts").select("user_id,provider_id"),
          ]);
          if (error || adminError || accountError)
            throw new Error(error?.message ?? adminError?.message ?? accountError?.message);
          const usableToken =
            Array.isArray(tokens) &&
            tokens.some((row) => {
              const token = asRecord(row);
              return token?.["consumed_at"] == null;
            });
          const adminIds = new Set(
            (Array.isArray(admins) ? admins : [])
              .map(asRecord)
              .filter(
                (row): row is NonNullable<typeof row> =>
                  !!row && row["role"] === "ADMIN" && row["is_active"] === true,
              )
              .map((row) => String(row["user_id"])),
          );
          const hasAdminCredential =
            Array.isArray(accounts) &&
            accounts.some((value) => {
              const account = asRecord(value);
              return (
                !!account &&
                account["provider_id"] === "credential" &&
                adminIds.has(String(account["user_id"]))
              );
            });
          return jsonResponse({ available: usableToken && !hasAdminCredential });
        } catch (error) {
          return errorResponse(error, "Could not check first-Admin setup.");
        }
      },
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin setup requests are not allowed." }, 403);
        let createdUser = false;
        let createdCredential = false;
        let userId: string | null = null;
        try {
          const body = asRecord(await request.json());
          if (!body) return jsonResponse({ error: "Invalid first-Admin setup details." }, 400);
          const token = typeof body["setup_token"] === "string" ? body["setup_token"].trim() : "";
          const displayName =
            typeof body["display_name"] === "string" ? body["display_name"].trim() : "";
          const identifier =
            typeof body["identifier"] === "string" ? body["identifier"].trim() : "";
          const password = typeof body["password"] === "string" ? body["password"] : "";
          if (token.length < 24 || token.length > 256)
            return jsonResponse({ error: "Enter the one-time setup code." }, 400);
          if (!displayName) return jsonResponse({ error: "Enter the Admin name." }, 400);
          if (password.length < 10 || password.length > 128)
            return jsonResponse({ error: "Choose a password with 10 to 128 characters." }, 400);

          let email: string | null = null;
          let phone: string | null = null;
          let emailIdentifier: string | null = null;
          let phoneIdentifier: string | null = null;
          let normalized: string;
          try {
            normalized = normalizeStaffIdentifier(identifier);
          } catch {
            return jsonResponse({ error: "Enter a valid email address or mobile number." }, 400);
          }
          if (normalized.startsWith("email:")) {
            email = normalized.slice("email:".length);
            emailIdentifier = normalized;
          } else {
            try {
              phone = normalizeStaffPhone(identifier);
            } catch {
              return jsonResponse({ error: "Enter a valid mobile number." }, 400);
            }
            phoneIdentifier = `phone:${phone}`;
          }

          const existing = await resolveStaffAuthEmail(identifier);
          if (existing && (!existing.profile || existing.profile.role !== "ADMIN"))
            return jsonResponse(
              { error: "This identifier is already assigned to a non-Admin staff member." },
              409,
            );
          userId = existing?.profile.user_id ?? crypto.randomUUID();
          const credential = await createStaffCredential({
            userId,
            displayName,
            temporaryPassword: password,
          });
          createdUser = credential.createdUser;
          createdCredential = true;
          const tokenHash = await sha256(token);
          const service = await getBootstrapService();
          const { error } = await service.rpc("app_complete_first_admin_bootstrap", {
            p_token_hash: tokenHash,
            p_user_id: userId,
            p_display_name: displayName,
            p_email: email,
            p_phone: phone,
            p_email_identifier: emailIdentifier,
            p_phone_identifier: phoneIdentifier,
          });
          if (error) throw new Error(error.message);
          const profile = await getStaffAccessProfile(userId);
          if (!profile) throw new Error("Admin account was created but could not be loaded.");
          return jsonResponse({ ok: true, profile });
        } catch (error) {
          if (createdCredential && userId) {
            try {
              await removeStaffCredential(userId, createdUser);
            } catch (cleanupError) {
              console.error("Could not remove incomplete first-Admin credentials", cleanupError);
            }
          }
          return errorResponse(error, "Could not set up the first Admin.");
        }
      },
    },
  },
});
