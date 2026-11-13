import { afterEach, describe, expect, it, vi } from "vitest";

import {
  errorResponse,
  projectStaffSensitiveTables,
  summarizePublicInvoices,
} from "@/lib/retail-server-api.server";
import { normalizeStaffIdentifier } from "@/lib/retail-auth.server";
import { retailApi, RetailApiError, userFacingError } from "@/lib/retail-api";
import { accessPolicy, pageAccessClass } from "@/lib/access-policy";
import { canDeactivateLocation, normalizeLocationInput } from "@/lib/location-policy";
import {
  canAssignStaffLocations,
  canManageStaffRole,
  canManageStaffTarget,
  canStaffSyncOperation,
} from "@/lib/staff-access-policy";
import { mergeReplicaRows } from "@/lib/replica-merge-policy";
import {
  posLoginErrorResponse,
  posLoginOriginErrorResponse,
  posProfileRequiredErrorResponse,
} from "@/routes/api/pos/login";

describe("staff login identifiers", () => {
  it("normalizes email addresses case-insensitively", () => {
    expect(normalizeStaffIdentifier("  Owner@Example.com ")).toBe("email:owner@example.com");
  });

  it("normalizes Indian mobile numbers to the same international identifier", () => {
    expect(normalizeStaffIdentifier("98765 43210")).toBe("phone:+919876543210");
    expect(normalizeStaffIdentifier("+91-98765-43210")).toBe("phone:+919876543210");
  });

  it("normalizes usernames for password sign-in", () => {
    expect(normalizeStaffIdentifier("  Store-User_2 ")).toBe("username:store-user_2");
  });

  it("rejects malformed login identifiers", () => {
    expect(() => normalizeStaffIdentifier("x!")).toThrow(
      "Enter a valid email, username or mobile number.",
    );
  });
});

describe("Admin location policy", () => {
  it("normalizes location codes and optional fields before saving", () => {
    expect(
      normalizeLocationInput({
        name: "  Main Store ",
        code: " ms_01 ",
        type: "retail",
        address: " ",
        phone: null,
      }),
    ).toEqual({
      name: "Main Store",
      code: "MS_01",
      type: "RETAIL",
      address: null,
      phone: null,
      upi_vpa: null,
      is_active: true,
    });
  });

  it("rejects malformed, unsupported, or unsafe location inputs", () => {
    expect(normalizeLocationInput({ name: "", code: "1", type: "RETAIL" })).toBeNull();
    expect(normalizeLocationInput({ name: "Store", code: "BAD CODE", type: "RETAIL" })).toBeNull();
    expect(normalizeLocationInput({ name: "Store", code: "MS01", type: "OTHER" })).toBeNull();
    expect(
      normalizeLocationInput({ name: "Store", code: "MS01", type: "RETAIL", upi_vpa: "invalid" }),
    ).toBeNull();
  });

  it("normalizes the optional merchant UPI identifier for checkout QR codes", () => {
    expect(
      normalizeLocationInput({
        name: "Store",
        code: "MS01",
        type: "RETAIL",
        upi_vpa: "  Store.Pay@ExampleBank  ",
      })?.upi_vpa,
    ).toBe("store.pay@examplebank");
  });

  it("blocks deactivation until shifts, assignments, and sync alerts are clear", () => {
    expect(
      canDeactivateLocation({ openCashSessions: 0, assignedStaff: 0, unresolvedAlerts: 0 }),
    ).toBe(true);
    expect(
      canDeactivateLocation({ openCashSessions: 1, assignedStaff: 0, unresolvedAlerts: 0 }),
    ).toBe(false);
    expect(
      canDeactivateLocation({ openCashSessions: 0, assignedStaff: 1, unresolvedAlerts: 0 }),
    ).toBe(false);
    expect(
      canDeactivateLocation({ openCashSessions: 0, assignedStaff: 0, unresolvedAlerts: 1 }),
    ).toBe(false);
  });
});

describe("role and location-scoped staff access", () => {
  it("limits Managers to Cashiers and to their assigned locations", () => {
    expect(canManageStaffRole("MANAGER", "CASHIER")).toBe(true);
    expect(canManageStaffRole("MANAGER", "MANAGER")).toBe(false);
    expect(canManageStaffRole("MANAGER", "ADMIN")).toBe(false);
    expect(canAssignStaffLocations("MANAGER", ["store-a"], ["store-a"])).toBe(true);
    expect(canAssignStaffLocations("MANAGER", ["store-a"], ["store-a", "store-b"])).toBe(false);
    expect(canManageStaffTarget("MANAGER", ["store-a"], "CASHIER", ["store-a"])).toBe(true);
    expect(canManageStaffTarget("MANAGER", ["store-a"], "CASHIER", ["store-a", "store-b"])).toBe(
      false,
    );
  });

  it("enforces the Cashier, Manager, Admin and Warehouse operation boundaries", () => {
    expect(canStaffSyncOperation("CASHIER", "invoice.finalize")).toBe(true);
    expect(canStaffSyncOperation("ADMIN", "invoice.finalize")).toBe(false);
    expect(canStaffSyncOperation("CASHIER", "cash.session.open")).toBe(true);
    expect(canStaffSyncOperation("ADMIN", "cash.session.open")).toBe(false);
    expect(canStaffSyncOperation("WAREHOUSE", "inventory.adjustment.create")).toBe(true);
    expect(canStaffSyncOperation("WAREHOUSE", "purchase.receive")).toBe(false);
    expect(canStaffSyncOperation("WAREHOUSE", "customer.create")).toBe(false);
    expect(canStaffSyncOperation("WAREHOUSE", "product.update")).toBe(false);
    expect(canStaffSyncOperation("MANAGER", "purchase.receive")).toBe(true);
  });

  it("preserves offline business rows but drops locations removed from the server snapshot", () => {
    const retainedBills = mergeReplicaRows(
      "bills",
      [],
      [{ id: "local-bill", sync_status: "PENDING" }],
    );
    const locations = mergeReplicaRows(
      "locations",
      [{ id: "active-store", name: "Active" }],
      [
        { id: "active-store", name: "Stale name", sync_status: "SYNCED" },
        { id: "deactivated-store", name: "Inactive", sync_status: "SYNCED" },
      ],
    );

    expect(retainedBills).toEqual([{ id: "local-bill", sync_status: "PENDING" }]);
    expect(locations).toEqual([{ id: "active-store", name: "Active", sync_status: "SYNCED" }]);
  });
});

describe("app access policy and data projections", () => {
  it("allows only the dashboard page before staff sign-in", () => {
    expect(pageAccessClass("/")).toBe("public");
    expect(pageAccessClass("/billing")).toBe("staff");
    expect(pageAccessClass("/manager")).toBe("staff");
    expect(pageAccessClass("/admin")).toBe("staff");
  });

  it("exposes only the allowlisted public overview API", () => {
    expect(accessPolicy.api.public).toEqual(["/api/public-overview"]);
    expect(accessPolicy.api.staff).toContain("/api/retail-snapshot");
    expect(accessPolicy.api.staff).toContain("/api/cash-session-override");
    expect(accessPolicy.api.staff).toContain("/api/retail-workbook-import");
    expect(accessPolicy.api.signIn).toEqual(["/api/pos/login"]);
  });

  it("returns public dashboard aggregates without exposing invoice rows", () => {
    const result = summarizePublicInvoices(
      [
        {
          id: "private-invoice-id",
          invoice_number: "private-number",
          total_amount: "100.25",
          invoice_status: "COMPLETED",
          business_date: "2026-11-08",
          customer_id: "private-customer-id",
        },
        {
          total_amount: 900,
          invoice_status: "DRAFT",
          business_date: "2026-11-08",
        },
        {
          total_amount: 500,
          invoice_status: "COMPLETED",
          business_date: "2026-11-07",
        },
      ],
      "2026-11-08",
    );
    expect(result).toEqual({
      business_date: "2026-11-08",
      completed_bills: 1,
      sales_total: 100.25,
    });
    expect(Object.keys(result)).toEqual(["business_date", "completed_bills", "sales_total"]);
  });

  it("removes cost, supplier, and customer demographic details from cashier snapshots", () => {
    const inputProducts = [
      { id: "p1", name: "Product", purchase_cost: 40, preferred_supplier: "Supplier A" },
    ];
    const inputCustomers = [
      {
        id: "c1",
        name: "Customer",
        mobile: "9999999999",
        credit_limit: 1000,
        age_group: "Adult",
        gender: "Other",
        visits: 4,
        notes: "private note",
      },
    ];
    const cashier = projectStaffSensitiveTables(inputProducts, inputCustomers, "CASHIER");
    expect(cashier.products[0]).not.toHaveProperty("purchase_cost");
    expect(cashier.products[0]).not.toHaveProperty("preferred_supplier");
    expect(cashier.customers[0]).not.toHaveProperty("age_group");
    expect(cashier.customers[0]).not.toHaveProperty("gender");
    expect(cashier.customers[0]).not.toHaveProperty("visits");
    expect(cashier.customers[0]).not.toHaveProperty("notes");
    expect(cashier.customers[0]).toMatchObject({ name: "Customer", mobile: "9999999999" });

    expect(projectStaffSensitiveTables(inputProducts, inputCustomers, "ADMIN")).toEqual({
      products: inputProducts,
      customers: inputCustomers,
    });
  });
});

describe("staff authentication errors", () => {
  it("returns a safe client message for malformed request JSON", async () => {
    const response = errorResponse(new SyntaxError("Unexpected token"), "Could not save.");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Some request details were invalid. Review them and try again.",
    });
  });

  it("maps missing server database configuration to a safe unavailable response", async () => {
    const error = new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    error.name = "SupabaseServerConfigurationError";
    const response = errorResponse(error, "Could not verify the staff session.");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "DailyPlazaa services are temporarily unavailable. Please try again later.",
    });
  });
});

describe("DailyPlazaa API errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves HTTP status and server message for authorization failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Location access denied." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(retailApi("/api/retail-sync")).rejects.toMatchObject({
      name: "RetailApiError",
      message: "Location access denied.",
      status: 403,
    } satisfies Partial<RetailApiError>);
  });

  it("maps technical server failures to a business-friendly fallback", () => {
    expect(
      userFacingError(
        new RetailApiError("Could not load inventory: relation does not exist", 500),
        "Inventory is temporarily unavailable. Try again.",
      ),
    ).toBe("Inventory is temporarily unavailable. Try again.");
  });

  it("shows a safe service-unavailable message returned by the server", () => {
    expect(
      userFacingError(
        new RetailApiError(
          "DailyPlazaa services are temporarily unavailable. Please try again later.",
          503,
        ),
        "Could not sign in. Check your details and connection.",
      ),
    ).toBe("DailyPlazaa services are temporarily unavailable. Please try again later.");
  });

  it("does not expose arbitrary technical exceptions", () => {
    expect(
      userFacingError(new Error("PostgREST PGRST204: missing column"), "Could not save this item."),
    ).toBe("Could not save this item.");
  });

  it("shows a clear connection message for network failures", () => {
    expect(
      userFacingError(
        new RetailApiError("Could not reach DailyPlazaa. Check your connection and try again.", 0),
        "Request failed.",
      ),
    ).toBe("Could not reach DailyPlazaa. Check your connection and try again.");
  });

  it("distinguishes origin, credential, and service failures", async () => {
    const originFailure = posLoginOriginErrorResponse();
    expect(originFailure.status).toBe(403);
    await expect(originFailure.json()).resolves.toEqual({
      error: "Cross-origin sign-in requests are not allowed.",
    });

    const credentialFailure = posLoginErrorResponse(401);
    expect(credentialFailure.status).toBe(401);
    await expect(credentialFailure.json()).resolves.toEqual({
      error: "Supabase Auth could not verify those credentials.",
    });

    const profileFailure = posProfileRequiredErrorResponse();
    expect(profileFailure.status).toBe(403);
    await expect(profileFailure.json()).resolves.toEqual({
      error:
        "Your Supabase sign-in succeeded, but this account is not linked to an active DailyPlazaa staff role. Ask the project administrator to complete POS access setup.",
    });

    const serviceFailure = posLoginErrorResponse(500);
    expect(serviceFailure.status).toBe(503);
    await expect(serviceFailure.json()).resolves.toEqual({
      error: "Sign-in is temporarily unavailable. Please try again later.",
    });
  });
});
