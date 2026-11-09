import { createFileRoute } from "@tanstack/react-router";

import {
  getRetailAuth,
  normalizeStaffIdentifier,
  resolveStaffAuthEmail,
} from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

async function anonymousLoginEmail(identifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identifier));
  const suffix = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `missing-${suffix}@accounts.retailflow.invalid`;
}

export function staffLoginErrorResponse(status: number) {
  if (status === 403)
    return jsonResponse(
      {
        error:
          "This sign-in address is not trusted. Open RetailFlow using its configured local address and try again.",
      },
      403,
    );
  if (status === 429)
    return jsonResponse(
      { error: "Too many sign-in attempts. Wait a moment, then try again." },
      429,
    );
  if (status >= 500)
    return jsonResponse(
      { error: "Staff sign-in is temporarily unavailable. Please try again later." },
      503,
    );
  return jsonResponse(
    { error: "Invalid login or password, or this staff account is inactive." },
    401,
  );
}

export const Route = createFileRoute("/api/staff-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin sign-in requests are not allowed." }, 403);

        try {
          const body = (await request.json()) as Record<string, unknown>;
          const identifier = typeof body["identifier"] === "string" ? body["identifier"] : "";
          const password = typeof body["password"] === "string" ? body["password"] : "";
          if (!identifier || !password || password.length > 128)
            return jsonResponse({ error: "Enter a valid login and password." }, 400);

          let normalizedIdentifier: string;
          try {
            normalizedIdentifier = normalizeStaffIdentifier(identifier);
          } catch {
            normalizedIdentifier = `invalid:${identifier.trim().toLowerCase()}`;
          }
          const staff = normalizedIdentifier.startsWith("invalid:")
            ? null
            : await resolveStaffAuthEmail(identifier);
          const email = staff?.email ?? (await anonymousLoginEmail(normalizedIdentifier));
          const headers = new Headers(request.headers);
          headers.set("Content-Type", "application/json");
          headers.delete("Content-Length");
          const authRequest = new Request(new URL("/api/auth/sign-in/email", request.url), {
            method: "POST",
            headers,
            body: JSON.stringify({ email, password, callbackURL: new URL("/", request.url).href }),
          });
          const authResponse = await getRetailAuth().handler(authRequest);
          if (!authResponse.ok) return staffLoginErrorResponse(authResponse.status);

          const responseHeaders = new Headers(authResponse.headers);
          responseHeaders.delete("Content-Length");
          responseHeaders.set("Content-Type", "application/json; charset=utf-8");
          responseHeaders.set("Cache-Control", "no-store");
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: responseHeaders,
          });
        } catch (error) {
          return errorResponse(error, "Could not sign in. Try again or contact an Admin.");
        }
      },
    },
  },
});
