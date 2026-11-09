import { createFileRoute } from "@tanstack/react-router";

import { getStaffSession } from "@/lib/retail-auth.server";
import {
  asRecord,
  errorResponse,
  isSameOriginMutation,
  jsonResponse,
} from "@/lib/retail-server-api.server";

type AdminClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const Route = createFileRoute("/api/resolve-sync-alert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin alert updates are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.must_change_password)
            return jsonResponse(
              { error: "Change your temporary password before using the POS." },
              403,
            );
          if (session.profile.role === "CASHIER")
            return jsonResponse({ error: "Manager access is required." }, 403);
          const body = asRecord(await request.json());
          const alertId = typeof body?.["alert_id"] === "string" ? body["alert_id"] : "";
          if (!/^[0-9a-f-]{36}$/i.test(alertId))
            return jsonResponse({ error: "Invalid inventory alert ID." }, 400);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = supabaseAdmin as unknown as AdminClient;
          const { error } = await admin.rpc("app_resolve_inventory_sync_alert", {
            p_actor_user_id: session.profile.user_id,
            p_alert_id: alertId,
          });
          if (error) throw new Error(error.message);
          return jsonResponse({ ok: true });
        } catch (error) {
          return errorResponse(error, "Could not update the inventory alert.");
        }
      },
    },
  },
});
