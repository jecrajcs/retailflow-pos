import { createFileRoute } from "@tanstack/react-router";

import { errorResponse, jsonResponse, loadPublicOverview } from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/public-overview")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return jsonResponse(await loadPublicOverview());
        } catch (error) {
          return errorResponse(error, "Today's overview is temporarily unavailable.");
        }
      },
    },
  },
});
