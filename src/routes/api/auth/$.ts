import { createFileRoute } from "@tanstack/react-router";

import { getRetailAuth } from "@/lib/retail-auth.server";
import { errorResponse } from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await getRetailAuth().handler(request);
        } catch (error) {
          return errorResponse(error, "Staff authentication is temporarily unavailable.");
        }
      },
      POST: async ({ request }) => {
        try {
          return await getRetailAuth().handler(request);
        } catch (error) {
          return errorResponse(error, "Staff authentication is temporarily unavailable.");
        }
      },
    },
  },
});
