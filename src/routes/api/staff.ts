import { createFileRoute } from "@tanstack/react-router";

import {
  createStaffAuthUser,
  getStaffSession,
  normalizeStaffIdentifier,
  normalizeStaffPhone,
  removeStaffAuthUser,
  updateStaffAuthUser,
  verifyStaffPasswordLogin,
  type StaffRole,
} from "@/lib/retail-auth.server";
import {
  asRecord,
  errorResponse,
  isSameOriginMutation,
  jsonResponse,
  type RetailRow,
} from "@/lib/retail-server-api.server";
import {
  canAssignStaffLocations,
  canManageStaffRole,
  canManageStaffTarget,
} from "@/lib/staff-access-policy";

type Query = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}> & {
  select: (columns?: string) => Query;
  eq: (field: string, value: unknown) => Query;
  in: (field: string, values: readonly unknown[]) => Query;
  insert: (values: Record<string, unknown>) => Query;
  update: (values: Record<string, unknown>) => Query;
  delete: () => Query;
  maybeSingle: () => Query;
};

type StaffService = {
  from: (table: string) => Query;
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function getStaffService() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as StaffService;
}

function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `Rf!${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}

function normalizeContacts(emailInput: unknown, phoneInput: unknown) {
  const emailText = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
  const phoneText = typeof phoneInput === "string" ? phoneInput.trim() : "";
  const email = emailText || null;
  const phone = phoneText ? normalizeStaffPhone(phoneText) : null;
  if (email) {
    const normalized = normalizeStaffIdentifier(email);
    if (!normalized.startsWith("email:")) throw new Error("Enter a valid email address.");
  }
  if (!email && !phone) throw new Error("Provide an email address or mobile number.");
  return { email, phone };
}

async function saveProfile(
  service: StaffService,
  values: {
    actorId: string;
    userId: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    role: string;
    locationIds: string[];
    active: boolean;
    mustChangePassword: boolean;
  },
) {
  const { error } = await service.rpc("app_save_staff_profile", {
    p_actor_user_id: values.actorId,
    p_user_id: values.userId,
    p_display_name: values.displayName,
    p_email: values.email,
    p_phone: values.phone,
    p_role: values.role,
    p_location_ids: values.locationIds,
    p_is_active: values.active,
    p_must_change_password: values.mustChangePassword,
  });
  if (error) throw new Error(error.message);
}

async function loadStaffRows() {
  const service = await getStaffService();
  const [{ data: profiles, error }, { data: assignments, error: assignmentError }] =
    await Promise.all([
      service
        .from("users")
        .select("user_id,display_name,username,email,phone,role,is_active,must_change_password"),
      service.from("staff_location_access").select("user_id,location_id"),
    ]);
  if (error || assignmentError)
    throw new Error(error?.message ?? assignmentError?.message ?? "Could not load staff.");
  const assignmentRows = Array.isArray(assignments) ? (assignments as RetailRow[]) : [];
  return (Array.isArray(profiles) ? (profiles as RetailRow[]) : []).map((profile) => ({
    user_id: String(profile["user_id"]),
    display_name: String(profile["display_name"] ?? ""),
    username: String(profile["username"] ?? ""),
    email: profile["email"] ? String(profile["email"]) : null,
    phone: profile["phone"] ? String(profile["phone"]) : null,
    role: String(profile["role"]).toUpperCase(),
    is_active: profile["is_active"] !== false,
    must_change_password: profile["must_change_password"] === true,
    has_login: true,
    location_ids: assignmentRows
      .filter((assignment) => assignment["user_id"] === profile["user_id"])
      .map((assignment) => String(assignment["location_id"])),
  }));
}

export const Route = createFileRoute("/api/staff")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.must_change_password)
            return jsonResponse(
              { error: "Change your temporary password before using staff tools." },
              403,
            );
          if (!["ADMIN", "MANAGER"].includes(session.profile.role))
            return jsonResponse(
              { error: "Admin or Manager access is required for staff tools." },
              403,
            );
          const staff = await loadStaffRows();
          return jsonResponse({
            staff:
              session.profile.role === "ADMIN"
                ? staff
                : staff.filter(
                    (member) =>
                      member.role === "CASHIER" &&
                      canManageStaffTarget(
                        session.profile.role,
                        session.profile.location_ids,
                        member.role,
                        member.location_ids,
                      ),
                  ),
          });
        } catch (error) {
          return errorResponse(error, "Could not load staff access.");
        }
      },
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin staff changes are not allowed." }, 403);
        try {
          const session = await getStaffSession(request);
          if (!session) return jsonResponse({ error: "Sign in as an active staff member." }, 401);
          if (session.profile.must_change_password)
            return jsonResponse(
              { error: "Change your temporary password before using staff tools." },
              403,
            );
          if (!["ADMIN", "MANAGER"].includes(session.profile.role))
            return jsonResponse(
              { error: "Admin or Manager access is required for staff tools." },
              403,
            );
          const body = asRecord(await request.json());
          if (!body) return jsonResponse({ error: "Invalid staff details." }, 400);
          const displayName =
            typeof body["display_name"] === "string" ? body["display_name"].trim() : "";
          const role = typeof body["role"] === "string" ? body["role"].toUpperCase() : "";
          const locationIds = Array.isArray(body["location_ids"])
            ? [
                ...new Set(
                  body["location_ids"].filter((id): id is string => typeof id === "string"),
                ),
              ]
            : [];
          const active = body["is_active"] !== false;
          const resetPassword = body["reset_password"] === true;
          const requestedUserId =
            typeof body["user_id"] === "string" && body["user_id"].trim()
              ? body["user_id"].trim()
              : null;
          if (!displayName) return jsonResponse({ error: "Enter the staff member’s name." }, 400);
          if (!["CASHIER", "MANAGER", "ADMIN", "WAREHOUSE"].includes(role))
            return jsonResponse({ error: "Choose a valid staff role." }, 400);
          if (!canManageStaffRole(session.profile.role, role as StaffRole))
            return jsonResponse(
              { error: "Managers may create or manage Cashier accounts only." },
              403,
            );
          if (
            role !== "ADMIN" &&
            active &&
            !canAssignStaffLocations(
              session.profile.role,
              session.profile.location_ids,
              locationIds,
            )
          )
            return jsonResponse(
              {
                error:
                  session.profile.role === "MANAGER"
                    ? locationIds.length === 0
                      ? "Assign this active Cashier to at least one of your locations."
                      : "Assign this Cashier only to one or more of your locations."
                    : "Assign at least one location to an active staff member.",
              },
              400,
            );
          if (locationIds.length > 0) {
            const service = await getStaffService();
            const { data: requestedLocations, error: locationError } = await service
              .from("locations")
              .select("id,is_active")
              .in("id", locationIds);
            if (locationError) throw new Error(locationError.message);
            const activeLocationIds = new Set(
              (Array.isArray(requestedLocations) ? (requestedLocations as RetailRow[]) : [])
                .filter((location) => location["is_active"] === true)
                .map((location) => String(location["id"])),
            );
            if (activeLocationIds.size !== locationIds.length)
              return jsonResponse({ error: "Assign staff only to active locations." }, 400);
          }
          if (requestedUserId && !/^[0-9a-f-]{36}$/i.test(requestedUserId))
            return jsonResponse({ error: "Invalid staff account ID." }, 400);
          let contacts: ReturnType<typeof normalizeContacts>;
          try {
            contacts = normalizeContacts(body["email"], body["phone"]);
          } catch (error) {
            return jsonResponse(
              {
                error:
                  error instanceof Error ? error.message : "Enter valid staff contact details.",
              },
              400,
            );
          }
          if (!requestedUserId && !contacts.email && !contacts.phone)
            return jsonResponse({ error: "Provide an email address or mobile number." }, 400);

          const previous = requestedUserId
            ? (await loadStaffRows()).find((staff) => staff.user_id === requestedUserId)
            : undefined;
          if (requestedUserId && !previous)
            return jsonResponse({ error: "Staff account not found." }, 404);
          if (
            session.profile.role === "MANAGER" &&
            previous &&
            !canManageStaffTarget(
              session.profile.role,
              session.profile.location_ids,
              previous.role as StaffRole,
              previous.location_ids,
            )
          )
            return jsonResponse(
              { error: "Managers may manage only Cashiers assigned entirely to their locations." },
              403,
            );
          if (requestedUserId === session.profile.user_id && role !== session.profile.role)
            return jsonResponse({ error: "You cannot change your own staff role." }, 400);

          const email = contacts.email ?? previous?.["email"] ?? null;
          const phone = contacts.phone ?? previous?.["phone"] ?? null;
          const password = !requestedUserId || resetPassword ? temporaryPassword() : null;
          let userId = requestedUserId;
          let createdAuthUserId: string | null = null;
          let authUserUpdated = false;
          try {
            const service = await getStaffService();
            if (!userId) {
              userId = await createStaffAuthUser({
                displayName,
                email,
                phone,
                password: password!,
              });
              createdAuthUserId = userId;
              await saveProfile(service, {
                actorId: session.profile.user_id,
                userId,
                displayName,
                email,
                phone,
                role,
                locationIds,
                active,
                mustChangePassword: true,
              });
            } else if (password && previous) {
              await saveProfile(service, {
                actorId: session.profile.user_id,
                userId,
                displayName,
                email,
                phone,
                role,
                locationIds,
                active,
                mustChangePassword: true,
              });
              try {
                await updateStaffAuthUser(userId, { displayName, email, phone, password });
                authUserUpdated = true;
              } catch (error) {
                try {
                  await saveProfile(service, {
                    actorId: session.profile.user_id,
                    userId,
                    displayName: String(previous["display_name"]),
                    email: previous["email"] ? String(previous["email"]) : null,
                    phone: previous["phone"] ? String(previous["phone"]) : null,
                    role: String(previous["role"]),
                    locationIds: previous["location_ids"] as string[],
                    active: previous["is_active"] !== false,
                    mustChangePassword: previous["must_change_password"] === true,
                  });
                } catch (rollbackError) {
                  console.error(
                    "Could not restore the staff profile after password reset failed",
                    rollbackError,
                  );
                }
                throw error;
              }
            } else {
              await updateStaffAuthUser(userId, {
                displayName,
                email,
                phone,
              });
              authUserUpdated = true;
              await saveProfile(service, {
                actorId: session.profile.user_id,
                userId,
                displayName,
                email,
                phone,
                role,
                locationIds,
                active,
                mustChangePassword: previous?.["must_change_password"] === true,
              });
            }
          } catch (error) {
            if (createdAuthUserId) {
              try {
                await removeStaffAuthUser(createdAuthUserId);
              } catch (cleanupError) {
                console.error("Could not remove incomplete Supabase Auth user", cleanupError);
              }
            } else if (authUserUpdated && previous) {
              try {
                await updateStaffAuthUser(userId!, {
                  displayName: String(previous["display_name"]),
                  email: previous["email"] ? String(previous["email"]) : null,
                  phone: previous["phone"] ? String(previous["phone"]) : null,
                });
              } catch (rollbackError) {
                console.error("Could not restore staff Auth contact details", rollbackError);
              }
            }
            throw error;
          }

          const authLogin = email ?? phone;
          if (!userId) throw new Error("Staff profile was saved without an Auth user ID.");
          const savedProfile = (await loadStaffRows()).find((staff) => staff.user_id === userId);
          const login = savedProfile?.username || authLogin;
          let credentialVerified: boolean | undefined;
          if (password) {
            try {
              credentialVerified = await verifyStaffPasswordLogin(userId, [email, phone], password);
            } catch (error) {
              console.error("Could not verify the new staff password", error);
              credentialVerified = false;
            }
          }
          return jsonResponse({
            user_id: userId,
            login,
            username: savedProfile?.username ?? null,
            ...(password ? { temporary_password: password } : {}),
            ...(password ? { credential_verified: credentialVerified === true } : {}),
          });
        } catch (error) {
          return errorResponse(error, "Could not save staff access.");
        }
      },
    },
  },
});
