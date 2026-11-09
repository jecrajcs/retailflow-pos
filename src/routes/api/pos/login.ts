import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

import { SupabaseServerConfigurationError } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  getStaffAccessProfile,
  normalizeStaffIdentifier,
  type StaffAccessProfile,
} from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

export function posLoginErrorResponse(status: number) {
  if (status === 429)
    return jsonResponse(
      { error: "Too many sign-in attempts. Wait a moment, then try again." },
      429,
    );
  if (status >= 500)
    return jsonResponse(
      { error: "Sign-in is temporarily unavailable. Please try again later." },
      503,
    );
  return jsonResponse({ error: "Supabase Auth could not verify those credentials." }, 401);
}

export function posLoginOriginErrorResponse() {
  return jsonResponse({ error: "Cross-origin sign-in requests are not allowed." }, 403);
}

export function posProfileRequiredErrorResponse() {
  return jsonResponse(
    {
      error:
        "Your Supabase sign-in succeeded, but this account is not linked to an active RetailFlow staff role. Ask the project administrator to complete POS access setup.",
    },
    403,
  );
}

export const Route = createFileRoute("/api/pos/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request)) return posLoginOriginErrorResponse();

        try {
          const body = (await request.json()) as Record<string, unknown>;
          const identifier = typeof body["identifier"] === "string" ? body["identifier"] : "";
          const password = typeof body["password"] === "string" ? body["password"] : "";
          if (!identifier || !password || password.length > 128)
            return jsonResponse({ error: "Enter a valid login and password." }, 400);

          let normalized: string;
          try {
            normalized = normalizeStaffIdentifier(identifier);
          } catch {
            return posLoginErrorResponse(401);
          }

          const url = process.env["SUPABASE_URL"];
          const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
          if (!url || !key) {
            const missing = [
              ...(!url ? ["SUPABASE_URL"] : []),
              ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
            ];
            throw new SupabaseServerConfigurationError(
              `Missing Supabase environment variable(s): ${missing.join(", ")}`,
            );
          }
          const authClient = createClient<Database>(url, key, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
          });
          const credentials = normalized.startsWith("email:")
            ? { email: normalized.slice("email:".length), password }
            : { phone: normalized.slice("phone:".length), password };
          const { data, error } = await authClient.auth.signInWithPassword(credentials);
          if (error) return posLoginErrorResponse(error.status ?? 401);
          if (!data.session) return posLoginErrorResponse(503);

          const profile: StaffAccessProfile | null = await getStaffAccessProfile(data.user.id);
          if (!profile) return posProfileRequiredErrorResponse();

          return jsonResponse(
            {
              ok: true,
              profile,
              session: {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
              },
            },
            200,
            new Headers({ "Cache-Control": "no-store" }),
          );
        } catch (error) {
          return errorResponse(
            error,
            "Could not sign in. Try again or contact the project administrator.",
          );
        }
      },
    },
  },
});
