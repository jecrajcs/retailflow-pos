import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_ENABLED_CASH_DENOMINATIONS,
  parseEnabledCashDenominations,
} from "@/lib/cash-denominations";
import { getStaffSession } from "@/lib/retail-auth.server";
import {
  asRecord,
  errorResponse,
  isSameOriginMutation,
  jsonResponse,
} from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/cash-denominations")({
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
          const { data, error } = await supabaseAdmin
            .from("cash_denomination_settings")
            .select("enabled_denominations")
            .eq("setting_key", "global")
            .maybeSingle();
          if (error) throw new Error(`Could not load cash denominations: ${error.message}`);
          const enabledDenominations = data
            ? parseEnabledCashDenominations(data.enabled_denominations)
            : DEFAULT_ENABLED_CASH_DENOMINATIONS;
          if (!enabledDenominations)
            throw new Error("The saved cash denomination setting contains invalid values.");
          return jsonResponse({ enabled_denominations: enabledDenominations });
        } catch (error) {
          return errorResponse(error, "Could not load cash denomination settings.");
        }
      },
      PUT: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin cash setting changes are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.must_change_password)
            return jsonResponse(
              { error: "Change your temporary password before using the POS." },
              403,
            );
          if (session.profile.role !== "ADMIN")
            return jsonResponse(
              { error: "Admin access is required to change cash settings." },
              403,
            );
          const body = asRecord(await request.json());
          if (!body)
            return jsonResponse({ error: "Choose at least one supported cash denomination." }, 400);
          const enabledDenominations = parseEnabledCashDenominations(body["enabled_denominations"]);
          if (!enabledDenominations)
            return jsonResponse({ error: "Choose at least one supported cash denomination." }, 400);
          const { error } = await supabaseAdmin.from("cash_denomination_settings").upsert(
            {
              setting_key: "global",
              enabled_denominations: enabledDenominations,
              updated_at: new Date().toISOString(),
              updated_by: session.profile.user_id,
            },
            { onConflict: "setting_key" },
          );
          if (error) throw new Error(`Could not save cash denominations: ${error.message}`);
          return jsonResponse({ ok: true, enabled_denominations: enabledDenominations });
        } catch (error) {
          return errorResponse(error, "Could not save cash denomination settings.");
        }
      },
    },
  },
});
