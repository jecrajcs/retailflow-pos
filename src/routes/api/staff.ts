import { createFileRoute } from "@tanstack/react-router";

import {
  createStaffCredential,
  getStaffAccessProfile,
  getStaffSession,
  normalizeStaffIdentifier,
  normalizeStaffPhone,
  removeStaffCredential,
  replaceStaffPassword,
} from "@/lib/retail-auth.server";
import {
  asRecord,
  errorResponse,
  isSameOriginMutation,
  jsonResponse,
  type RetailRow,
} from "@/lib/retail-server-api.server";

type Query = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}> & {
  select: (columns?: string) => Query;
  eq: (field: string, value: unknown) => Query;
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
  return {
    email,
    phone,
    emailIdentifier: email ? normalizeStaffIdentifier(email) : null,
    phoneIdentifier: phone ? `phone:${phone}` : null,
  };
}

async function loadStaffRows() {
  const service = await getStaffService();
  const [
    { data: profiles, error },
    { data: assignments, error: assignmentError },
    { data: accounts, error: accountError },
  ] = await Promise.all([
    service
      .from("users")
      .select("user_id,display_name,email,phone,role,is_active,must_change_password"),
    service.from("staff_location_access").select("user_id,location_id"),
    service.from("auth_accounts").select("user_id,provider_id"),
  ]);
  if (error || assignmentError || accountError)
    throw new Error(
      error?.message ??
        assignmentError?.message ??
        accountError?.message ??
        "Could not load staff.",
    );
  const assignmentRows = Array.isArray(assignments) ? (assignments as RetailRow[]) : [];
  const accountRows = Array.isArray(accounts) ? (accounts as RetailRow[]) : [];
  return (Array.isArray(profiles) ? (profiles as RetailRow[]) : []).map((profile) => ({
    user_id: String(profile["user_id"]),
    display_name: String(profile["display_name"] ?? ""),
    email: profile["email"] ? String(profile["email"]) : null,
    phone: profile["phone"] ? String(profile["phone"]) : null,
    role: String(profile["role"]).toUpperCase(),
    is_active: profile["is_active"] !== false,
    must_change_password: profile["must_change_password"] === true,
    has_login: accountRows.some(
      (account) =>
        account["user_id"] === profile["user_id"] && account["provider_id"] === "credential",
    ),
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
          if (session.profile.role !== "ADMIN")
            return jsonResponse({ error: "Only an Admin can manage staff accounts." }, 403);
          return jsonResponse({ staff: await loadStaffRows() });
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
          if (session.profile.role !== "ADMIN")
            return jsonResponse({ error: "Only an Admin can manage staff accounts." }, 403);
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
          if (!["CASHIER", "MANAGER", "ADMIN"].includes(role))
            return jsonResponse({ error: "Choose a valid staff role." }, 400);
          if (role !== "ADMIN" && locationIds.length === 0)
            return jsonResponse({ error: "Assign at least one location." }, 400);
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
          if (requestedUserId === session.profile.user_id && role !== "ADMIN")
            return jsonResponse({ error: "An Admin cannot remove their own Admin access." }, 400);

          const userId = requestedUserId ?? crypto.randomUUID();
          const hasLogin = previous?.["has_login"] === true;
          const needsCredential = !hasLogin || resetPassword;
          const password = needsCredential ? temporaryPassword() : null;
          let credentialCreated: { createdUser: boolean } | null = null;
          try {
            const service = await getStaffService();
            if (password && !hasLogin) {
              credentialCreated = await createStaffCredential({
                userId,
                displayName,
                temporaryPassword: password,
              });
            }

            const { error } = await service.rpc("app_save_staff_profile", {
              p_actor_user_id: session.profile.user_id,
              p_user_id: userId,
              p_display_name: displayName,
              p_email: contacts.email,
              p_phone: contacts.phone,
              p_email_identifier: contacts.emailIdentifier,
              p_phone_identifier: contacts.phoneIdentifier,
              p_role: role,
              p_location_ids: locationIds,
              p_is_active: active,
              p_must_change_password: password ? true : previous?.["must_change_password"] === true,
            });
            if (error) throw new Error(error.message);
            if (password && hasLogin)
              await replaceStaffPassword(
                userId,
                password,
                userId === session.profile.user_id ? session.authSession.token : undefined,
              );
          } catch (error) {
            if (credentialCreated) {
              try {
                await removeStaffCredential(userId, credentialCreated.createdUser);
              } catch (cleanupError) {
                console.error("Could not remove incomplete staff credentials", cleanupError);
              }
            }
            throw error;
          }

          const login = contacts.email ?? contacts.phone;
          return jsonResponse({
            user_id: userId,
            login,
            ...(password ? { temporary_password: password } : {}),
            staff: await getStaffAccessProfile(userId),
          });
        } catch (error) {
          return errorResponse(error, "Could not save staff access.");
        }
      },
    },
  },
});
