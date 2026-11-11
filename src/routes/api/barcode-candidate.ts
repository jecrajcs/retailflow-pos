import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStaffSession } from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/barcode-candidate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request)) return jsonResponse({ error: "Cross-origin barcode changes are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (!["ADMIN", "MANAGER", "WAREHOUSE"].includes(session.profile.role)) return jsonResponse({ error: "Manager, Admin or Warehouse access is required." }, 403);
          const body = await request.json() as Record<string, unknown>;
          const action = typeof body["action"] === "string" ? body["action"] : "review";
          if (action === "assign") {
            const productId = typeof body["product_id"] === "string" ? body["product_id"] : "";
            const locationId = typeof body["location_id"] === "string" ? body["location_id"] : "";
            const code = typeof body["code"] === "string" ? body["code"].trim() : "";
            const type = typeof body["barcode_type"] === "string" ? body["barcode_type"].toUpperCase() : "";
            if (!productId || !locationId || !code || !["MANUFACTURER", "INTERNAL"].includes(type)) {
              return jsonResponse({ error: "Choose a SKU, location, barcode and barcode type." }, 400);
            }
            const { error } = await supabaseAdmin.rpc("app_assign_product_barcode", {
              p_actor_user_id: session.profile.user_id,
              p_product_id: productId,
              p_location_id: locationId,
              p_code: code,
              p_barcode_type: type,
            });
            if (error) throw new Error(error.message);
            return jsonResponse({ ok: true });
          }
          const candidateId = typeof body["candidate_id"] === "string" ? body["candidate_id"] : "";
          const status = typeof body["status"] === "string" ? body["status"].toUpperCase() : "";
          const barcodeType = typeof body["barcode_type"] === "string" ? body["barcode_type"].toUpperCase() : "";
          const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";
          if (!candidateId || !["VERIFIED", "REJECTED"].includes(status)) return jsonResponse({ error: "Choose a barcode candidate and review action." }, 400);
          if (status === "REJECTED" && reason.length < 5) return jsonResponse({ error: "Enter a reason for rejecting this barcode." }, 400);
          const { error } = await supabaseAdmin.rpc("app_review_barcode_candidate", {
            p_actor_user_id: session.profile.user_id,
            p_candidate_id: candidateId,
            p_status: status,
            p_barcode_type: status === "VERIFIED" ? barcodeType : "",
            p_reason: reason,
          });
          if (error) throw new Error(error.message);
          return jsonResponse({ ok: true });
        } catch (error) {
          return errorResponse(error, "Could not review this barcode.");
        }
      },
    },
  },
});
