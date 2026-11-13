import { createFileRoute } from "@tanstack/react-router";

import {
  getStaffSession,
  replaceStaffPassword,
  verifyStaffPasswordLogin,
} from "@/lib/retail-auth.server";
import { createOfflinePinVerifier, type OfflinePinVerifier } from "@/lib/offline-pin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

type ProfileQuery = PromiseLike<{ error: { message: string } | null }> & {
  eq: (field: string, value: string) => ProfileQuery;
};
type StaffProfileService = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => ProfileQuery;
  };
};
type OfflinePinQuery = PromiseLike<{ error: { message: string } | null }> & {
  upsert: (
    values: OfflinePinVerifier & { user_id: string; updated_at: string },
    options: { onConflict: string },
  ) => OfflinePinQuery;
};
type OfflinePinService = {
  from: (table: "staff_offline_pin_verifiers") => OfflinePinQuery;
};

export const Route = createFileRoute("/api/staff-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin password changes are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          const body = (await request.json()) as Record<string, unknown>;
          const password = typeof body["password"] === "string" ? body["password"] : "";
          const offlinePin = typeof body["offline_pin"] === "string" ? body["offline_pin"] : "";
          if (password.length < 10 || password.length > 128)
            return jsonResponse({ error: "Choose a password with 10 to 128 characters." }, 400);
          if (!/^\d{6,8}$/.test(offlinePin))
            return jsonResponse({ error: "Choose an offline device PIN with 6 to 8 digits." }, 400);

          await replaceStaffPassword(session.profile.user_id, password);
          if (
            !(await verifyStaffPasswordLogin(
              session.profile.user_id,
              [session.profile.email, session.profile.phone],
              password,
            ))
          )
            throw new Error(
              "Supabase updated the password but could not verify a sign-in. Your forced-change status remains active; re-enter the new password or ask an Admin to issue another temporary password.",
            );
          const verifier = await createOfflinePinVerifier(offlinePin);
          const pinService = supabaseAdmin as unknown as OfflinePinService;
          const { error: pinError } = await pinService.from("staff_offline_pin_verifiers").upsert(
            {
              user_id: session.profile.user_id,
              ...verifier,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          if (pinError)
            throw new Error(
              `Password changed but the offline device PIN could not be saved: ${pinError.message}`,
            );
          const service = supabaseAdmin as unknown as StaffProfileService;
          const { error } = await service
            .from("users")
            .update({ must_change_password: false, updated_at: new Date().toISOString() })
            .eq("user_id", session.profile.user_id);
          if (error)
            throw new Error(`Password changed but profile update failed: ${error.message}`);
          return jsonResponse({ ok: true });
        } catch (error) {
          return errorResponse(error, "Could not update the password.");
        }
      },
    },
  },
});
