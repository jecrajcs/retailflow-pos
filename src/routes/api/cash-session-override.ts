import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import {
  getStaffAccessProfile,
  getStaffSession,
  normalizeStaffIdentifier,
} from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

export const Route = createFileRoute("/api/cash-session-override")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin cash approvals are not allowed." }, 403);
        try {
          const requester = await getStaffSession(request);
          if (!requester) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (requester.profile.must_change_password)
            return jsonResponse(
              { error: "Change your temporary password before closing a shift." },
              403,
            );
          const body = (await request.json()) as Record<string, unknown>;
          const sessionId = typeof body["session_id"] === "string" ? body["session_id"] : "";
          const counted = Number(body["counted_cash"]);
          const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";
          const identifier =
            typeof body["manager_identifier"] === "string" ? body["manager_identifier"] : "";
          const password =
            typeof body["manager_password"] === "string" ? body["manager_password"] : "";
          const denominations = body["closing_denominations"];
          if (
            !sessionId ||
            !Number.isFinite(counted) ||
            counted < 0 ||
            reason.length < 5 ||
            reason.length > 1000 ||
            !identifier ||
            !password ||
            password.length > 128
          )
            return jsonResponse(
              { error: "Enter a valid counted total, Manager credentials, and approval reason." },
              400,
            );
          if (!denominations || typeof denominations !== "object" || Array.isArray(denominations))
            return jsonResponse({ error: "A closing denomination count is required." }, 400);
          const countMap = denominations as Record<string, unknown>;
          const denominationTotal = Object.entries(countMap).reduce((sum, [value, amount]) => {
            const denomination = Number(value);
            const quantity = Number(amount);
            if (
              !DENOMINATIONS.includes(denomination) ||
              !Number.isInteger(quantity) ||
              quantity < 0
            )
              throw new Error("Closing denominations contain an invalid value.");
            return sum + denomination * quantity;
          }, 0);
          if (Math.abs(denominationTotal - counted) > 0.01)
            return jsonResponse(
              { error: "The denomination total does not match the counted cash." },
              400,
            );

          const normalized = normalizeStaffIdentifier(identifier);
          const url = process.env["SUPABASE_URL"];
          const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
          if (!url || !key) throw new Error("Staff verification is temporarily unavailable.");
          const authClient = createClient<Database>(url, key, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          });
          const credentials = normalized.startsWith("email:")
            ? { email: normalized.slice("email:".length), password }
            : { phone: normalized.slice("phone:".length), password };
          const { data, error } = await authClient.auth.signInWithPassword(credentials);
          if (error || !data.user)
            return jsonResponse({ error: "Manager credentials could not be verified." }, 401);
          const manager = await getStaffAccessProfile(data.user.id);
          if (!manager || !["MANAGER", "ADMIN"].includes(manager.role))
            return jsonResponse(
              { error: "Only an active Manager or Admin can approve a shift variance." },
              403,
            );
          if (manager.must_change_password)
            return jsonResponse(
              { error: "The approving Manager must change their temporary password first." },
              403,
            );

          const { data: cashSession, error: sessionError } = await supabaseAdmin
            .from("cash_drawer_sessions")
            .select("id,location_id,opened_by_id,status")
            .eq("id", sessionId)
            .maybeSingle();
          if (sessionError)
            throw new Error(`Could not load the cash session: ${sessionError.message}`);
          if (!cashSession || cashSession.status !== "OPEN")
            return jsonResponse(
              { error: "This cash shift is already closed or unavailable." },
              409,
            );
          const requesterIsCashierOwner =
            requester.profile.role === "CASHIER" &&
            cashSession.opened_by_id === requester.profile.user_id;
          const requesterIsAuthorizedManager =
            ["MANAGER", "ADMIN"].includes(requester.profile.role) &&
            (requester.profile.role === "ADMIN" ||
              requester.profile.location_ids.includes(cashSession.location_id));
          if (!requesterIsCashierOwner && !requesterIsAuthorizedManager)
            return jsonResponse(
              { error: "The signed-in staff member cannot approve this shift close." },
              403,
            );
          if (manager.role !== "ADMIN" && !manager.location_ids.includes(cashSession.location_id))
            return jsonResponse(
              { error: "The approving Manager is not assigned to this location." },
              403,
            );
          if (requesterIsAuthorizedManager && manager.user_id !== requester.profile.user_id)
            return jsonResponse(
              { error: "Re-enter the password for the Manager or Admin signed in on this device." },
              403,
            );

          const { error: closeError } = await supabaseAdmin.rpc("app_override_cash_session_close", {
            p_session_id: sessionId,
            p_manager_user_id: manager.user_id,
            p_counted_cash: counted,
            p_closing_denominations:
              countMap as Database["public"]["Tables"]["cash_drawer_sessions"]["Row"]["closing_denominations"],
            p_reason: reason,
          });
          if (closeError) throw new Error(closeError.message);
          await authClient.auth.signOut({ scope: "local" });
          return jsonResponse({ ok: true });
        } catch (error) {
          return errorResponse(error, "Could not approve this shift close.");
        }
      },
    },
  },
});
