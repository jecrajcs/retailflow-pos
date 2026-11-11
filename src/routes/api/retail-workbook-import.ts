import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStaffSession } from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

export const Route = createFileRoute("/api/retail-workbook-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin workbook imports are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session)
            return jsonResponse({ error: "Sign in as active staff to import workbook data." }, 401);
          if (session.profile.must_change_password)
            return jsonResponse(
              { error: "Change your temporary password before importing business data." },
              403,
            );
          if (session.profile.role !== "MANAGER" && session.profile.role !== "ADMIN")
            return jsonResponse(
              { error: "Manager or Admin access is required for workbook import." },
              403,
            );
          const body = (await request.json()) as Record<string, unknown>;
          const batchKey = typeof body["batch_key"] === "string" ? body["batch_key"] : "";
          const fileName =
            typeof body["source_file_name"] === "string"
              ? body["source_file_name"].slice(0, 255)
              : "";
          const mapping = body["location_mapping"];
          const summary = body["summary"];
          const payload = body["payload"];
          if (
            !/^[a-f0-9]{64}$/i.test(batchKey) ||
            !fileName ||
            !mapping ||
            typeof mapping !== "object" ||
            !summary ||
            typeof summary !== "object" ||
            !payload ||
            typeof payload !== "object"
          )
            return jsonResponse(
              { error: "Workbook batch details are incomplete or invalid." },
              400,
            );
          const businessLocationId = (mapping as Record<string, unknown>)["business_location_id"];
          if (typeof businessLocationId !== "string" || !businessLocationId)
            return jsonResponse(
              { error: "Choose the destination location before committing the import." },
              400,
            );
          if (
            session.profile.role === "MANAGER" &&
            !session.profile.location_ids.includes(businessLocationId)
          )
            return jsonResponse(
              { error: "The selected location is outside this Manager’s assignment." },
              403,
            );
          const { data: location, error: locationError } = await supabaseAdmin
            .from("locations")
            .select("id,is_active")
            .eq("id", businessLocationId)
            .maybeSingle();
          if (locationError)
            throw new Error(`Could not verify the destination location: ${locationError.message}`);
          if (!location || !location.is_active)
            return jsonResponse({ error: "Choose an active destination location." }, 400);
          const { data, error } = await supabaseAdmin.rpc("app_import_retailflow_workbook_batch", {
            p_actor_user_id: session.profile.user_id,
            p_batch_key: batchKey,
            p_source_file_name: fileName,
            p_location_mapping: mapping as import("@/integrations/supabase/types").Json,
            p_summary: summary as import("@/integrations/supabase/types").Json,
            p_payload: payload as import("@/integrations/supabase/types").Json,
          });
          if (error) throw new Error(error.message);
          if (data && typeof data === "object" && "duplicate" in data && data["duplicate"] === true)
            return jsonResponse({ ok: true, duplicate: true, result: data });
          return jsonResponse({ ok: true, result: data });
        } catch (error) {
          return errorResponse(error, "Could not commit the workbook import.");
        }
      },
    },
  },
});
