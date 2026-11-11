import { createFileRoute } from "@tanstack/react-router";

import { getStaffSession, revokeStaffSession } from "@/lib/retail-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/staff-session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          return jsonResponse({ profile: session.profile });
        } catch (error) {
          return errorResponse(error, "Could not verify the staff session.");
        }
      },
      DELETE: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin logout requests are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.role === "CASHIER") {
            if (session.profile.location_ids.length) {
              const { data, error } = await supabaseAdmin
                .from("cash_drawer_sessions")
                .select("id,location_id,opened_by_id")
                .in("location_id", session.profile.location_ids)
                .eq("status", "OPEN");
              if (error) throw new Error(`Could not verify the cashier shift: ${error.message}`);
              const hasOpenShift = (data ?? []).some(
                (shift) =>
                  shift.opened_by_id === session.profile.user_id || shift.opened_by_id === null,
              );
              if (hasOpenShift)
                return jsonResponse(
                  { error: "Close and reconcile the cash drawer before signing out." },
                  409,
                );
            }
          }
          await revokeStaffSession(request);
          return jsonResponse({ ok: true });
        } catch (error) {
          return errorResponse(error, "Could not revoke the staff session.");
        }
      },
    },
  },
});
