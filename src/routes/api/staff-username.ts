import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStaffSession } from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

type UsernameService = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const Route = createFileRoute("/api/staff-username")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request)) return jsonResponse({ error: "Cross-origin profile changes are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.must_change_password) return jsonResponse({ error: "Change your temporary password first." }, 403);
          const body = await request.json() as Record<string, unknown>;
          const username = typeof body["username"] === "string" ? body["username"].trim() : "";
          const service = supabaseAdmin as unknown as UsernameService;
          const { data, error } = await service.rpc("app_update_own_username", {
            p_actor_user_id: session.profile.user_id,
            p_username: username,
          });
          if (error) throw new Error(error.message);
          return jsonResponse({ ok: true, username: String(data ?? username) });
        } catch (error) {
          return errorResponse(error, "Could not update your username.");
        }
      },
    },
  },
});
