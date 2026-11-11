import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStaffSession } from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/admin/archive-product")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request)) return jsonResponse({ error: "Cross-origin product changes are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.role !== "ADMIN") return jsonResponse({ error: "Admin access is required to archive a SKU." }, 403);
          const body = await request.json() as Record<string, unknown>;
          const productId = typeof body["product_id"] === "string" ? body["product_id"] : "";
          const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";
          if (!/^[0-9a-f-]{36}$/i.test(productId) || reason.length < 5) return jsonResponse({ error: "Choose a SKU and enter an archive reason." }, 400);
          const { error } = await supabaseAdmin.rpc("app_archive_product_as_admin", {
            p_actor_user_id: session.profile.user_id,
            p_product_id: productId,
            p_reason: reason,
          });
          if (error) throw new Error(error.message);
          return jsonResponse({ ok: true });
        } catch (error) {
          return errorResponse(error, "Could not archive the SKU.");
        }
      },
    },
  },
});
