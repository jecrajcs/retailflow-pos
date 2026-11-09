import { createFileRoute } from "@tanstack/react-router";

import { getStaffSession } from "@/lib/retail-auth.server";
import {
  asRecord,
  errorResponse,
  isSameOriginMutation,
  jsonResponse,
} from "@/lib/retail-server-api.server";

type ServiceClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: Blob,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
};

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "invoice-file";
}

async function getServiceClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as ServiceClient;
}

export const Route = createFileRoute("/api/retail-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOriginMutation(request))
          return jsonResponse({ error: "Cross-origin sync requests are not allowed." }, 403);
        let session;
        try {
          session = await getStaffSession(request);
        } catch (error) {
          return errorResponse(error, "Could not verify the staff session.");
        }
        if (!session)
          return jsonResponse({ error: "Sign in as an active staff member to sync." }, 401);
        if (session.profile.must_change_password)
          return jsonResponse(
            { error: "Change your temporary password before syncing POS work." },
            403,
          );

        let uploadedPath: string | null = null;
        let uploadedBucket: ReturnType<ServiceClient["storage"]["from"]> | null = null;
        try {
          let operationValue: unknown;
          let attachment: Blob | null = null;
          if (request.headers.get("content-type")?.includes("multipart/form-data")) {
            const form = await request.formData();
            const serialized = form.get("operation");
            if (typeof serialized !== "string")
              return jsonResponse({ error: "Sync operation is missing." }, 400);
            operationValue = JSON.parse(serialized) as unknown;
            const file = form.get("attachment");
            if (file instanceof Blob && file.size > 0) attachment = file;
          } else {
            operationValue = await request.json();
          }

          const operation = asRecord(operationValue);
          const payload = asRecord(operation?.["payload"]);
          if (
            !operation ||
            typeof operation["operation_id"] !== "string" ||
            typeof operation["device_id"] !== "string" ||
            typeof operation["type"] !== "string" ||
            !payload ||
            (operation["user_id"] !== undefined && operation["user_id"] !== session.profile.user_id)
          )
            return jsonResponse(
              { error: "This sync operation is invalid or belongs to another staff account." },
              400,
            );
          if (!operation["user_id"])
            return jsonResponse({ error: "The sync operation has no verified staff owner." }, 403);

          const rpcPayload: Record<string, unknown> = structuredClone(payload);
          const receipt = asRecord(rpcPayload["receipt"]);
          if (attachment && receipt) {
            if (session.profile.role === "CASHIER")
              return jsonResponse(
                { error: "Manager access is required to upload supplier documents." },
                403,
              );
            const warehouseId = String(
              receipt["warehouse_location_id"] ?? operation["outlet_id"] ?? "",
            );
            if (
              session.profile.role !== "ADMIN" &&
              !session.profile.location_ids.includes(warehouseId)
            )
              return jsonResponse(
                { error: "Location access denied for this supplier document." },
                403,
              );
            const receiptId = String(receipt["id"] ?? payload["record_id"] ?? "purchase");
            const originalName = String(receipt["attachment_name"] ?? "invoice-file");
            const path = `${session.profile.user_id}/${warehouseId}/${receiptId}/${safeFilename(originalName)}`;
            const service = await getServiceClient();
            uploadedBucket = service.storage.from("supplier-invoices");
            const { error } = await uploadedBucket.upload(path, attachment, {
              contentType: attachment.type || "application/octet-stream",
              upsert: true,
            });
            if (error) throw new Error(`Supplier document upload failed: ${error.message}`);
            uploadedPath = path;
            receipt["attachment"] = null;
            receipt["attachment_path"] = path;
          }

          const service = await getServiceClient();
          const { data, error } = await service.rpc("app_sync_offline_operation_as_staff", {
            p_actor_user_id: session.profile.user_id,
            p_operation_id: operation["operation_id"],
            p_device_id: operation["device_id"],
            p_outlet_id: typeof operation["outlet_id"] === "string" ? operation["outlet_id"] : null,
            p_operation_type: operation["type"],
            p_payload: rpcPayload,
          });
          if (error) throw new Error(error.message);

          if (operation["type"] === "product.create" || operation["type"] === "product.update") {
            const product = asRecord(rpcPayload["product"]);
            if (product && Array.isArray(product["price_tiers"])) {
              const { error: tierError } = await service.rpc("app_set_product_price_tiers", {
                p_actor_user_id: session.profile.user_id,
                p_product_id: String(product["id"] ?? payload["record_id"]),
                p_price_tiers: product["price_tiers"],
              });
              if (tierError) throw new Error(`Quantity price sync failed: ${tierError.message}`);
            }
          }
          return jsonResponse({
            ...(asRecord(data) ?? {}),
            ...(uploadedPath ? { attachment_path: uploadedPath } : {}),
          });
        } catch (error) {
          if (uploadedPath && uploadedBucket) {
            const { error: cleanupError } = await uploadedBucket.remove([uploadedPath]);
            if (cleanupError)
              console.error("Could not remove orphaned supplier document", cleanupError);
          }
          const message = error instanceof Error ? error.message : String(error);
          const needsReview =
            /access denied|manager access|staff account|required|not permitted|permission|unsupported operation/i.test(
              message,
            );
          if (needsReview)
            return jsonResponse(
              { error: "This operation needs manager review or your account lacks access." },
              403,
            );
          return errorResponse(error, "Could not sync this POS operation.");
        }
      },
    },
  },
});
