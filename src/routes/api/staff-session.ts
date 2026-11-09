import { createFileRoute } from "@tanstack/react-router";

import { getStaffSession, revokeStaffSession } from "@/lib/retail-auth.server";
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
          await revokeStaffSession(request);
          return jsonResponse({ ok: true });
        } catch (error) {
          return errorResponse(error, "Could not revoke the staff session.");
        }
      },
    },
  },
});
