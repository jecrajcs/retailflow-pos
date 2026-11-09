import { afterEach, describe, expect, it, vi } from "vitest";

import {
  errorResponse,
  projectStaffSensitiveTables,
  summarizePublicInvoices,
} from "@/lib/retail-server-api.server";
import {
  getAuthServerUrl,
  getRetailAuth,
  normalizeStaffIdentifier,
} from "@/lib/retail-auth.server";
import { retailApi, RetailApiError, userFacingError } from "@/lib/retail-api";
import { accessPolicy, pageAccessClass } from "@/lib/access-policy";
import { staffLoginErrorResponse } from "@/routes/api/staff-login";

describe("staff login identifiers", () => {
  it("normalizes email addresses case-insensitively", () => {
    expect(normalizeStaffIdentifier("  Owner@Example.com ")).toBe("email:owner@example.com");
  });

  it("normalizes Indian mobile numbers to the same international identifier", () => {
    expect(normalizeStaffIdentifier("98765 43210")).toBe("phone:+919876543210");
    expect(normalizeStaffIdentifier("+91-98765-43210")).toBe("phone:+919876543210");
  });

  it("rejects malformed login identifiers", () => {
    expect(() => normalizeStaffIdentifier("not-a-login")).toThrow(
      "Enter a valid mobile number in international format.",
    );
  });
});

describe("app access policy and data projections", () => {
  it("allows only the dashboard page before staff sign-in", () => {
    expect(pageAccessClass("/")).toBe("public");
    expect(pageAccessClass("/billing")).toBe("staff");
    expect(pageAccessClass("/manager")).toBe("staff");
  });

  it("exposes only the allowlisted public overview API and bootstrap status", () => {
    expect(accessPolicy.api.public).toEqual(["/api/public-overview", "/api/first-admin"]);
    expect(accessPolicy.api.staff).toContain("/api/retail-snapshot");
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

describe("staff authentication configuration", () => {
  it("requires an explicit canonical server URL", () => {
    const baseUrl = process.env["BETTER_AUTH_URL"];
    delete process.env["BETTER_AUTH_URL"];
    try {
      expect(() => getAuthServerUrl()).toThrow(
        "Staff authentication configuration is incomplete or invalid.",
      );
    } finally {
      if (baseUrl !== undefined) process.env["BETTER_AUTH_URL"] = baseUrl;
    }
  });

  it("uses the configured URL and trusted origin without request-origin inference", () => {
    const baseUrl = process.env["BETTER_AUTH_URL"];
    const trustedOrigin = process.env["BETTER_AUTH_TRUSTED_ORIGIN"];
    process.env["BETTER_AUTH_URL"] = "https://pos.example.test/";
    process.env["BETTER_AUTH_TRUSTED_ORIGIN"] = "https://pos.example.test";
    try {
      expect(getAuthServerUrl()).toEqual({
        baseURL: "https://pos.example.test",
        trustedOrigins: ["https://pos.example.test"],
      });
    } finally {
      if (baseUrl === undefined) delete process.env["BETTER_AUTH_URL"];
      else process.env["BETTER_AUTH_URL"] = baseUrl;
      if (trustedOrigin === undefined) delete process.env["BETTER_AUTH_TRUSTED_ORIGIN"];
      else process.env["BETTER_AUTH_TRUSTED_ORIGIN"] = trustedOrigin;
    }
  });

  it("fails auth operations safely when the server secret is missing", () => {
    const secret = process.env["BETTER_AUTH_SECRET"];
    delete process.env["BETTER_AUTH_SECRET"];
    try {
      let error: unknown;
      try {
        getRetailAuth();
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ name: "AuthConfigurationError" });
      const response = errorResponse(error, "Could not sign in.");
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      if (secret !== undefined) process.env["BETTER_AUTH_SECRET"] = secret;
    }
  });

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
      error: "RetailFlow services are temporarily unavailable. Please try again later.",
    });
  });

  it("does not display internal auth configuration details to users", async () => {
    const secret = process.env["BETTER_AUTH_SECRET"];
    delete process.env["BETTER_AUTH_SECRET"];
    try {
      let error: unknown;
      try {
        getRetailAuth();
      } catch (caught) {
        error = caught;
      }
      const response = errorResponse(error, "Staff authentication is temporarily unavailable.");
      await expect(response.json()).resolves.toEqual({
        error: "Staff sign-in is temporarily unavailable. Please contact your store administrator.",
      });
    } finally {
      if (secret !== undefined) process.env["BETTER_AUTH_SECRET"] = secret;
    }
  });
});

describe("RetailFlow API errors", () => {
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
          "RetailFlow services are temporarily unavailable. Please try again later.",
          503,
        ),
        "Could not sign in. Check your details and connection.",
      ),
    ).toBe("RetailFlow services are temporarily unavailable. Please try again later.");
  });

  it("does not expose arbitrary technical exceptions", () => {
    expect(
      userFacingError(new Error("PostgREST PGRST204: missing column"), "Could not save this item."),
    ).toBe("Could not save this item.");
  });

  it("shows a clear connection message for network failures", () => {
    expect(
      userFacingError(
        new RetailApiError("Could not reach RetailFlow. Check your connection and try again.", 0),
        "Request failed.",
      ),
    ).toBe("Could not reach RetailFlow. Check your connection and try again.");
  });

  it("distinguishes untrusted sign-in origins from credentials and service failures", async () => {
    const originFailure = staffLoginErrorResponse(403);
    expect(originFailure.status).toBe(403);
    await expect(originFailure.json()).resolves.toEqual({
      error:
        "This sign-in address is not trusted. Open RetailFlow using its configured local address and try again.",
    });

    const credentialFailure = staffLoginErrorResponse(401);
    expect(credentialFailure.status).toBe(401);
    await expect(credentialFailure.json()).resolves.toEqual({
      error: "Invalid login or password, or this staff account is inactive.",
    });

    const serviceFailure = staffLoginErrorResponse(500);
    expect(serviceFailure.status).toBe(503);
    await expect(serviceFailure.json()).resolves.toEqual({
      error: "Staff sign-in is temporarily unavailable. Please try again later.",
    });
  });
});
