import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStaffSession } from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/category-review")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin category changes are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.must_change_password)
            return jsonResponse(
              { error: "Change your temporary password before reviewing categories." },
              403,
            );
          if (session.profile.role !== "MANAGER" && session.profile.role !== "ADMIN")
            return jsonResponse({ error: "Manager access is required to review categories." }, 403);
          const value: unknown = await request.json();
          if (!value || typeof value !== "object" || Array.isArray(value))
            return jsonResponse({ error: "Category review details are invalid." }, 400);
          const body = value as Record<string, unknown>;
          const categoryId = typeof body["category_id"] === "string" ? body["category_id"] : "";
          const status = typeof body["status"] === "string" ? body["status"].toUpperCase() : "";
          const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";
          if (!categoryId || !["APPROVED", "REJECTED"].includes(status))
            return jsonResponse({ error: "Choose a category and review decision." }, 400);
          if (status === "REJECTED" && reason.length < 5)
            return jsonResponse(
              { error: "Enter a clear reason of at least five characters." },
              400,
            );
          const { error } = await supabaseAdmin.rpc("app_review_category_suggestion", {
            p_actor_user_id: session.profile.user_id,
            p_category_id: categoryId,
            p_status: status,
            p_reason: reason,
          });
          if (error) throw new Error(error.message);
          return jsonResponse({ ok: true });
        } catch (error) {
          return errorResponse(error, "Could not review this category suggestion.");
        }
      },
    },
  },
});
