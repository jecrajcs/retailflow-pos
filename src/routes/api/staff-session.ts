import { createFileRoute } from "@tanstack/react-router";

import { getRetailAuth, getStaffSession } from "@/lib/retail-auth.server";
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
          const headers = new Headers(request.headers);
          headers.delete("Content-Length");
          const authRequest = new Request(new URL("/api/auth/sign-out", request.url), {
            method: "POST",
            headers,
            body: "{}",
          });
          const authResponse = await getRetailAuth().handler(authRequest);
          if (!authResponse.ok)
            return jsonResponse(
              { error: "Could not revoke the staff session." },
              authResponse.status,
              authResponse.headers,
            );
          const responseHeaders = new Headers(authResponse.headers);
          responseHeaders.delete("Content-Length");
          responseHeaders.set("Content-Type", "application/json; charset=utf-8");
          responseHeaders.set("Cache-Control", "no-store");
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: responseHeaders,
          });
        } catch (error) {
          return errorResponse(error, "Could not revoke the staff session.");
        }
      },
    },
  },
});
