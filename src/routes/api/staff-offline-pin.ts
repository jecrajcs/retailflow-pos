import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createOfflinePinVerifier, type OfflinePinVerifier } from "@/lib/offline-pin";
import { getStaffSession, verifyStaffPasswordLogin } from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

type OfflinePinRow = OfflinePinVerifier & { user_id: string };
type OfflinePinQuery = PromiseLike<{
  data: OfflinePinRow | null;
  error: { message: string } | null;
}> & {
  select: (columns?: string) => OfflinePinQuery;
  eq: (field: string, value: string) => OfflinePinQuery;
  maybeSingle: () => OfflinePinQuery;
  upsert: (values: OfflinePinRow, options: { onConflict: string }) => OfflinePinQuery;
};
type OfflinePinService = {
  from: (table: "staff_offline_pin_verifiers") => OfflinePinQuery;
};

export const Route = createFileRoute("/api/staff-offline-pin")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          const service = supabaseAdmin as unknown as OfflinePinService;
          const { data, error } = await service
            .from("staff_offline_pin_verifiers")
            .select("user_id,salt,verifier,iterations")
            .eq("user_id", session.profile.user_id)
            .maybeSingle();
          if (error) throw new Error(`Could not load the device PIN: ${error.message}`);
          return jsonResponse({
            verifier: data
              ? {
                  salt: data.salt,
                  verifier: data.verifier,
                  iterations: data.iterations,
                }
              : null,
          });
        } catch (error) {
          return errorResponse(error, "Could not load the device PIN.");
        }
      },
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin device PIN requests are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.must_change_password)
            return jsonResponse(
              { error: "Change your password before setting a device PIN." },
              403,
            );
          const body = (await request.json()) as Record<string, unknown>;
          const password = typeof body["password"] === "string" ? body["password"] : "";
          const pin = typeof body["pin"] === "string" ? body["pin"] : "";
          if (!/^\d{6,8}$/.test(pin))
            return jsonResponse({ error: "Choose a device PIN with 6 to 8 digits." }, 400);
          const passwordMatches = await verifyStaffPasswordLogin(
            session.profile.user_id,
            [session.profile.email, session.profile.phone],
            password,
          );
          if (!passwordMatches)
            return jsonResponse({ error: "The staff password is incorrect." }, 401);

          const verifier = await createOfflinePinVerifier(pin);
          const service = supabaseAdmin as unknown as OfflinePinService;
          const { error } = await service.from("staff_offline_pin_verifiers").upsert(
            {
              user_id: session.profile.user_id,
              ...verifier,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          if (error) throw new Error(`Could not save the device PIN: ${error.message}`);
          return jsonResponse({
            ok: true,
            verifier,
          });
        } catch (error) {
          return errorResponse(error, "Could not set the device PIN.");
        }
      },
    },
  },
});
