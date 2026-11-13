import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canDeactivateLocation, normalizeLocationInput } from "@/lib/location-policy";
import { getStaffSession } from "@/lib/retail-auth.server";
import { errorResponse, isSameOriginMutation, jsonResponse } from "@/lib/retail-server-api.server";

async function requireAdmin(request: Request) {
  const session = await getStaffSession(request);
  if (!session)
    return { error: jsonResponse({ error: "Sign in as an active staff member." }, 401) };
  if (session.profile.must_change_password)
    return {
      error: jsonResponse(
        { error: "Change your temporary password before managing locations." },
        403,
      ),
    };
  if (session.profile.role !== "ADMIN")
    return { error: jsonResponse({ error: "Only an Admin can manage store locations." }, 403) };
  return { session };
}

export const Route = createFileRoute("/api/admin/locations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireAdmin(request);
          if (access.error) return access.error;
          const { data, error } = await supabaseAdmin
            .from("locations")
            .select("*")
            .order("name", { ascending: true });
          if (error) throw new Error(`Could not load locations: ${error.message}`);
          return jsonResponse({ locations: data ?? [] });
        } catch (error) {
          return errorResponse(error, "Could not load location management.");
        }
      },
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin location changes are not allowed." }, 403);
        try {
          const access = await requireAdmin(request);
          if (access.error) return access.error;
          const body = normalizeLocationInput(await request.json());
          if (!body)
            return jsonResponse(
              {
                error:
                  "Check the location details. Enter a name, use a 2–20 character code with letters, numbers, - or _, and choose a supported type.",
              },
              400,
            );
          const { data, error } = await supabaseAdmin
            .from("locations")
            .insert(body)
            .select("*")
            .single();
          if (error) {
            if (error.code === "23505")
              return jsonResponse({ error: "That location code is already in use." }, 409);
            throw new Error(`Could not create location: ${error.message}`);
          }
          return jsonResponse({ location: data }, 201);
        } catch (error) {
          return errorResponse(error, "Could not create this location.");
        }
      },
      PATCH: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin location changes are not allowed." }, 403);
        try {
          const access = await requireAdmin(request);
          if (access.error) return access.error;
          const rawBody: unknown = await request.json();
          if (
            rawBody &&
            typeof rawBody === "object" &&
            !Array.isArray(rawBody) &&
            "set_default_warehouse" in rawBody &&
            rawBody.set_default_warehouse === true
          ) {
            const id = "id" in rawBody && typeof rawBody.id === "string" ? rawBody.id : "";
            if (!id) return jsonResponse({ error: "Select an active Warehouse location." }, 400);
            const { error: defaultError } = await supabaseAdmin.rpc("app_set_default_warehouse", {
              p_actor_user_id: access.session.profile.user_id,
              p_location_id: id,
            });
            if (defaultError) {
              if (defaultError.message.includes("Choose an active Warehouse"))
                return jsonResponse({ error: defaultError.message }, 400);
              throw new Error(`Could not set the default Warehouse: ${defaultError.message}`);
            }
            const { data, error } = await supabaseAdmin
              .from("locations")
              .select("*")
              .eq("id", id)
              .maybeSingle();
            if (error) throw new Error(`Could not reload the Warehouse: ${error.message}`);
            if (!data) return jsonResponse({ error: "Warehouse location not found." }, 404);
            return jsonResponse({ location: data });
          }
          const body = normalizeLocationInput(rawBody);
          if (
            !body ||
            !rawBody ||
            typeof rawBody !== "object" ||
            Array.isArray(rawBody) ||
            !("id" in rawBody) ||
            typeof rawBody.id !== "string"
          )
            return jsonResponse(
              {
                error:
                  "Select a location and check its details. Codes must be 2–20 characters using letters, numbers, - or _.",
              },
              400,
            );
          const id = rawBody.id;
          if (!body.is_active || body.type !== "WAREHOUSE") {
            const { data: current, error: currentError } = await supabaseAdmin
              .from("locations")
              .select("is_default_warehouse")
              .eq("id", id)
              .maybeSingle();
            if (currentError)
              throw new Error(`Could not verify the default Warehouse: ${currentError.message}`);
            if (current?.is_default_warehouse)
              return jsonResponse(
                { error: "Set another default Warehouse before deactivating or changing this location." },
                409,
              );
          }
          if (!body.is_active) {
            const [
              { data: openSessions, error: sessionError },
              { data: assignments, error: accessError },
              { data: unresolvedAlerts, error: alertError },
            ] = await Promise.all([
              supabaseAdmin
                .from("cash_drawer_sessions")
                .select("id")
                .eq("location_id", id)
                .eq("status", "OPEN")
                .limit(1),
              supabaseAdmin.from("staff_location_access").select("user_id").eq("location_id", id),
              supabaseAdmin
                .from("inventory_sync_alerts")
                .select("id")
                .eq("location_id", id)
                .is("resolved_at", null)
                .limit(1),
            ]);
            if (sessionError || accessError || alertError)
              throw new Error(sessionError?.message ?? accessError?.message ?? alertError?.message);
            if (
              !canDeactivateLocation({
                openCashSessions: openSessions?.length ?? 0,
                assignedStaff: assignments?.length ?? 0,
                unresolvedAlerts: unresolvedAlerts?.length ?? 0,
              })
            ) {
              const reasons = [
                openSessions?.length ? "close the open cash shift" : "",
                assignments?.length ? "reassign staff away" : "",
                unresolvedAlerts?.length ? "resolve inventory sync alerts" : "",
              ].filter(Boolean);
              return jsonResponse(
                { error: `Before deactivating this location, ${reasons.join(", ")}.` },
                409,
              );
            }
          }
          const { data, error } = await supabaseAdmin
            .from("locations")
            .update(body)
            .eq("id", id)
            .select("*")
            .maybeSingle();
          if (error) {
            if (error.code === "23505")
              return jsonResponse({ error: "That location code is already in use." }, 409);
            throw new Error(`Could not update location: ${error.message}`);
          }
          if (!data) return jsonResponse({ error: "Location not found." }, 404);
          return jsonResponse({ location: data });
        } catch (error) {
          return errorResponse(error, "Could not update this location.");
        }
      },
    },
  },
});
