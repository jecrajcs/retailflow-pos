import { retailApi, RetailApiError, userFacingError } from "@/lib/retail-api";
import {
  getAllLocal,
  getLocal,
  getPendingOperations,
  putLocal,
  replaceLocalCollection,
  settleOperation,
  type KeyedRecord,
  type LocalStoreName,
  type OutboxOperation,
} from "@/lib/local-db";
import { mergeReplicaRows } from "@/lib/replica-merge-policy";

type SyncResult = { synced: number; pending: number; failed: number };

let syncPromise: Promise<SyncResult> | null = null;
let started = false;
let retryAttempt = 0;
let retryTimer: number | null = null;

const REMOTE_COLLECTIONS: Array<{ table: string; store: LocalStoreName }> = [
  { table: "locations", store: "locations" },
  { table: "products", store: "catalog" },
  { table: "customers", store: "customers" },
  { table: "inventory", store: "inventory_snapshot" },
  { table: "invoices", store: "bills" },
  { table: "invoice_items", store: "invoice_items" },
  { table: "payments", store: "payments" },
  { table: "stock_movements", store: "stock_movements" },
  { table: "cashier_shortcuts", store: "shortcuts" },
  { table: "cash_drawer_sessions", store: "cash_sessions" },
  { table: "purchase_receipts", store: "purchases" },
  { table: "cash_transactions", store: "cash_transactions" },
  { table: "stock_transfers", store: "stock_transfers" },
  { table: "stock_transfer_items", store: "transfer_items" },
  { table: "stock_adjustments", store: "stock_adjustments" },
  { table: "inventory_sync_alerts", store: "sync_alerts" },
  { table: "location_product_assignments", store: "location_products" },
  { table: "uncounted_sales", store: "uncounted_sales" },
  { table: "barcode_candidates", store: "barcode_candidates" },
  { table: "category_reviews", store: "category_reviews" },
];

function online() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function emitSyncStatus(detail: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("retailflow:sync-status", { detail }));
  }
}

/** Refreshes the local replica in the background. It never gates screen rendering. */
export async function refreshLocalReplica() {
  if (!online()) return;
  try {
    let snapshot: { tables: Record<string, KeyedRecord[]> };
    try {
      snapshot = await retailApi<{ tables: Record<string, KeyedRecord[]> }>("/api/retail-snapshot");
    } catch (error) {
      if (error instanceof RetailApiError && error.status === 401) return;
      throw error;
    }
    await Promise.all(
      REMOTE_COLLECTIONS.map(async ({ table, store }) => {
        const data = snapshot.tables[table] ?? [];
        let purchaseItemsByReceipt = new Map<string, KeyedRecord[]>();
        if (table === "purchase_receipts") {
          purchaseItemsByReceipt = new Map();
          for (const item of snapshot.tables["purchase_receipt_items"] ?? []) {
            const receiptId = String(item["receipt_id"] ?? "");
            purchaseItemsByReceipt.set(receiptId, [
              ...(purchaseItemsByReceipt.get(receiptId) ?? []),
              item,
            ]);
          }
        }
        await mergeRemoteCollection(table, store, data, purchaseItemsByReceipt);
      }),
    );
    emitSyncStatus({ kind: "replica-refreshed", at: new Date().toISOString() });
  } catch (error) {
    emitSyncStatus({
      kind: "replica-refresh-failed",
      message: userFacingError(
        error,
        "Could not refresh POS data. Saved work remains on this device.",
      ),
      at: new Date().toISOString(),
    });
    throw error;
  }
}

async function mergeRemoteCollection(
  table: string,
  store: LocalStoreName,
  data: KeyedRecord[],
  purchaseItemsByReceipt: Map<string, KeyedRecord[]>,
) {
  const remoteRows = data.map((row) => {
    if (table === "inventory")
      return { ...row, id: `${row["product_id"]}:${row["location_id"]}`, sync_status: "SYNCED" };
    if (table === "invoices")
      return { ...row, status: row["invoice_status"] ?? "COMPLETED", sync_status: "SYNCED" };
    if (table === "cashier_shortcuts")
      return { ...row, id: `location:${row["location_id"]}`, sync_status: "SYNCED" };
    if (table === "purchase_receipts")
      return {
        ...row,
        attachment_name: row["attachment_path"]
          ? String(row["attachment_path"]).split("/").at(-1)
          : null,
        items: (purchaseItemsByReceipt.get(String(row.id)) ?? []).map((item) => ({
          product_id: item["product_id"],
          quantity: item["quantity"],
          unit_cost: item["unit_cost"],
          manufactured_on: item["manufactured_on"],
          expires_on: item["expires_on"],
        })),
        sync_status: "SYNCED",
      };
    return { ...row, sync_status: "SYNCED" };
  });
  const localRows = await getAllLocal<KeyedRecord>(store);
  await replaceLocalCollection(store, mergeReplicaRows(table, remoteRows, localRows));
}

async function sendOperation(
  operation: OutboxOperation,
): Promise<{ reviewNeeded: boolean; message: string | null }> {
  const payload = structuredClone(operation.payload) as Record<string, unknown>;
  const receipt = payload["receipt"] as Record<string, unknown> | undefined;
  const attachment = receipt?.["attachment"];
  const request = new FormData();
  if (receipt && attachment instanceof Blob && attachment.size > 0) {
    request.append("attachment", attachment, String(receipt["attachment_name"] ?? "invoice-file"));
    receipt["attachment"] = null;
  }
  request.append(
    "operation",
    JSON.stringify({
      ...operation,
      payload,
    }),
  );
  const data = await retailApi<{
    review_needed?: boolean;
    message?: string | null;
    attachment_path?: string;
  }>("/api/retail-sync", {
    method: "POST",
    body: request,
  });
  if (receipt && attachment instanceof Blob && receipt["id"]) {
    const localReceipt = await getLocal<KeyedRecord>("purchases", String(receipt["id"]));
    if (localReceipt && typeof data.attachment_path === "string")
      await putLocal("purchases", {
        ...localReceipt,
        attachment_path: data.attachment_path,
        attachment_sync_status: "SYNCED",
      } as KeyedRecord);
  }
  return { reviewNeeded: data?.review_needed === true, message: data?.message ?? null };
}

async function markRecordStatus(
  operation: OutboxOperation,
  status: "SYNCED" | "REVIEW",
  message: string | null,
) {
  const recordId = operation.payload["record_id"];
  if (typeof recordId !== "string") return;
  const targetStore =
    operation.type.startsWith("invoice.") || operation.type === "payment.add"
      ? "bills"
      : operation.type.startsWith("purchase.")
        ? "purchases"
        : operation.type.startsWith("product.")
          ? "catalog"
          : operation.type.startsWith("customer.")
            ? "customers"
            : null;
  if (!targetStore) return;
  const record = await getLocal<KeyedRecord>(targetStore, recordId);
  if (record)
    await putLocal(targetStore, {
      ...record,
      sync_status: status,
      sync_error: message,
    } as KeyedRecord);
}

export function syncOutbox(): Promise<SyncResult> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    if (!online()) return { synced: 0, pending: (await getPendingOperations()).length, failed: 0 };
    let activeUserId: string;
    try {
      const { profile } = await retailApi<{
        profile: { user_id: string; must_change_password: boolean };
      }>("/api/staff-session");
      activeUserId = profile.user_id;
      if (profile.must_change_password)
        return { synced: 0, pending: (await getPendingOperations()).length, failed: 0 };
    } catch (error) {
      if (error instanceof RetailApiError && error.status === 401)
        return { synced: 0, pending: (await getPendingOperations()).length, failed: 0 };
      throw error;
    }
    if (!activeUserId)
      return { synced: 0, pending: (await getPendingOperations()).length, failed: 0 };
    const operations = await getPendingOperations();
    let synced = 0;
    let failed = 0;
    for (const operation of operations) {
      if (!online()) break;
      if (operation.user_id && operation.user_id !== activeUserId) {
        await settleOperation(
          operation,
          "REVIEW",
          "This operation was created by another staff account on this device. Sign in as that user or ask a manager to review it.",
        );
        await markRecordStatus(
          operation,
          "REVIEW",
          "Created by a different staff account on this device.",
        );
        continue;
      }
      if (!operation.user_id) {
        const message = "This older offline operation has no staff owner and needs manager review.";
        await settleOperation(operation, "REVIEW", message);
        await markRecordStatus(operation, "REVIEW", message);
        continue;
      }
      try {
        const ack = await sendOperation(operation);
        const status = ack.reviewNeeded ? "REVIEW" : "SYNCED";
        const settled = await settleOperation(operation, status, ack.message);
        if (!settled.superseded) await markRecordStatus(operation, status, ack.message);
        synced++;
      } catch (error) {
        const message = userFacingError(
          error,
          "This POS operation could not sync yet. It remains saved and will be retried.",
        );
        const needsReview =
          (error instanceof RetailApiError && [400, 403].includes(error.status)) ||
          /access denied|manager access|required.*account|not permitted|permission|unsupported operation|staff owner/i.test(
            message,
          );
        if (needsReview) {
          const settled = await settleOperation(operation, "REVIEW", message);
          if (!settled.superseded) await markRecordStatus(operation, "REVIEW", message);
          continue;
        }
        failed++;
        await settleOperation(operation, "PENDING", message);
        // Preserve event order for stock operations; retry on next online window.
        break;
      }
    }
    const pending = (await getPendingOperations()).length;
    emitSyncStatus({
      kind: "sync-complete",
      synced,
      pending,
      failed,
      at: new Date().toISOString(),
    });
    if (pending === 0) {
      retryAttempt = 0;
      if (retryTimer !== null && typeof window !== "undefined") {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    } else if (online() && typeof window !== "undefined") {
      if (failed === 0) {
        retryAttempt = 0;
        window.setTimeout(() => {
          void syncOutbox().catch((error) =>
            console.error("RetailFlow queued sync could not continue", error),
          );
        }, 0);
      } else {
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        const delay = Math.min(60_000, 5_000 * 2 ** retryAttempt);
        retryAttempt += 1;
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          void syncOutbox().catch((error) =>
            console.error("RetailFlow queued sync retry failed", error),
          );
        }, delay);
      }
    }
    return { synced, pending, failed };
  })().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

export function startOfflineSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  void refreshLocalReplica()
    .then(() => syncOutbox())
    .catch((error) => console.error("RetailFlow offline sync could not start", error));
  const onOnline = () => {
    void refreshLocalReplica()
      .then(() => syncOutbox())
      .catch((error) => console.error("RetailFlow reconnect sync failed", error));
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && online()) {
      void syncOutbox().catch((error) => console.error("RetailFlow background sync failed", error));
    }
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("retailflow:session-change", () => {
    if (!online()) return;
    window.setTimeout(() => {
      void refreshLocalReplica()
        .then(() => syncOutbox())
        .catch((error) => console.error("RetailFlow session sync failed", error));
    }, 0);
  });
}
