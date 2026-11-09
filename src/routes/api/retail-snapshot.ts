import { createFileRoute } from "@tanstack/react-router";

import { getStaffSession } from "@/lib/retail-auth.server";
import {
  errorResponse,
  jsonResponse,
  loadAuthorizedSnapshot,
} from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/retail-snapshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.must_change_password)
            return jsonResponse(
              { error: "Change your temporary password before using the POS." },
              403,
            );
          return jsonResponse(await loadAuthorizedSnapshot(session.profile));
        } catch (error) {
          return errorResponse(error, "Could not refresh the local POS data.");
        }
      },
    },
  },
});
