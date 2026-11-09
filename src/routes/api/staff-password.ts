import { createFileRoute } from "@tanstack/react-router";

import { getStaffSession, replaceStaffPassword } from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

type ProfileQuery = PromiseLike<{ error: { message: string } | null }> & {
  eq: (field: string, value: string) => ProfileQuery;
};
type StaffProfileService = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => ProfileQuery;
  };
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
          if (password.length < 10 || password.length > 128)
            return jsonResponse({ error: "Choose a password with 10 to 128 characters." }, 400);

          await replaceStaffPassword(session.profile.user_id, password);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
