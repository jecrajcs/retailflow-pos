export const LOCAL_DB_NAME = "retailflow-pos";
export const LOCAL_DB_VERSION = 3;

export const LOCAL_STORES = [
  "catalog",
  "customers",
  "locations",
  "inventory_snapshot",
  "bills",
  "invoice_items",
  "payments",
  "purchases",
  "cash_sessions",
  "cash_transactions",
  "stock_transfers",
  "transfer_items",
  "stock_adjustments",
  "stock_movements",
  "outbox",
  "settings",
  "profiles",
  "shortcuts",
  "sync_alerts",
] as const;

export type LocalStoreName = (typeof LOCAL_STORES)[number];
export type SyncStatus = "LOCAL" | "PENDING" | "SYNCED" | "REVIEW";

export interface OutboxOperation<T = Record<string, unknown>> {
  operation_id: string;
  device_id: string;
  user_id?: string;
  outlet_id: string | null;
  created_at: string;
  type: string;
  payload: T;
  sync_status: SyncStatus;
  sync_error?: string | null;
}

export interface LocalEnvelope<T> {
  id: string;
  sync_status?: SyncStatus;
  updated_at?: string;
  [key: string]: unknown;
}

export type KeyedRecord = Record<string, unknown> & {
  id?: string;
  key?: string;
  operation_id?: string;
};

const KEY_PATHS: Record<LocalStoreName, string> = {
  catalog: "id",
  customers: "id",
  locations: "id",
  inventory_snapshot: "id",
  bills: "id",
  invoice_items: "id",
  payments: "id",
  purchases: "id",
  cash_sessions: "id",
  cash_transactions: "id",
  stock_transfers: "id",
  transfer_items: "id",
  stock_adjustments: "id",
  stock_movements: "id",
  outbox: "operation_id",
  settings: "key",
  profiles: "id",
  shortcuts: "id",
  sync_alerts: "id",
};

const memory = new Map<LocalStoreName, Map<IDBValidKey, KeyedRecord>>();
for (const store of LOCAL_STORES) memory.set(store, new Map());

let databasePromise: Promise<IDBDatabase | null> | undefined;
const CHANGE_EVENT = "retailflow:local-change";

function isBrowser() {
  return typeof window !== "undefined";
}

function emitChange(store: LocalStoreName) {
  if (isBrowser()) window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { store } }));
}

export function subscribeLocalChanges(listener: (store: LocalStoreName) => void) {
  if (!isBrowser()) return () => undefined;
  const handler = (event: Event) => {
    const store = (event as CustomEvent<{ store: LocalStoreName }>).detail?.store;
    if (store) listener(store);
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function openLocalDatabase(): Promise<IDBDatabase | null> {
  if (!isBrowser() || !window.indexedDB) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    const request = window.indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of LOCAL_STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: KEY_PATHS[store] });
        }
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function recordKey(store: LocalStoreName, value: KeyedRecord): IDBValidKey {
  const keyPath = KEY_PATHS[store];
  const key = value[keyPath];
  if (typeof key !== "string" && typeof key !== "number") {
    throw new Error(`A ${keyPath} is required for local ${store} data.`);
  }
  return key;
}

export async function getLocal<T extends KeyedRecord>(
  store: LocalStoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  const db = await openLocalDatabase();
  if (!db) return memory.get(store)?.get(key) as T | undefined;
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${store}.`));
  });
}

export async function getAllLocal<T extends KeyedRecord>(store: LocalStoreName): Promise<T[]> {
  const db = await openLocalDatabase();
  if (!db) return [...(memory.get(store)?.values() ?? [])] as T[];
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${store}.`));
  });
}

export async function putLocal<T extends KeyedRecord>(
  store: LocalStoreName,
  value: T,
): Promise<void> {
  const key = recordKey(store, value);
  const db = await openLocalDatabase();
  if (!db) {
    memory.get(store)?.set(key, value);
    emitChange(store);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Could not save ${store}.`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`Could not save ${store}.`));
  });
  emitChange(store);
}

export async function putManyLocal<T extends KeyedRecord>(
  store: LocalStoreName,
  values: T[],
): Promise<void> {
  const db = await openLocalDatabase();
  if (!db) {
    const target = memory.get(store);
    for (const value of values) target?.set(recordKey(store, value), value);
    emitChange(store);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    for (const value of values) objectStore.put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Could not save ${store}.`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`Could not save ${store}.`));
  });
  emitChange(store);
}

export async function putLocalBatch(
  entries: Array<{ store: LocalStoreName; value: KeyedRecord }>,
): Promise<void> {
  const stores = [...new Set(entries.map((entry) => entry.store))];
  const db = await openLocalDatabase();
  if (!db) {
    for (const { store, value } of entries) memory.get(store)?.set(recordKey(store, value), value);
    for (const store of stores) emitChange(store);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(stores, "readwrite");
    for (const { store, value } of entries) transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not commit local transaction."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Could not commit local transaction."));
  });
  for (const store of stores) emitChange(store);
}

/** Commit local domain records and their sync operation in one IndexedDB transaction. */
export async function commitLocalOperation<T extends Record<string, unknown>>(
  entries: Array<{ store: LocalStoreName; value: KeyedRecord }>,
  type: string,
  payload: T,
  outletId: string | null,
  coalesceRecordId?: string,
): Promise<OutboxOperation<T>> {
  const access = await getSetting<{ user_id?: string }>("active_access_profile");
  let operation: OutboxOperation<T> = {
    operation_id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    device_id: await getDeviceId(),
    ...(access?.user_id ? { user_id: access.user_id } : {}),
    outlet_id: outletId,
    created_at: new Date().toISOString(),
    type,
    payload,
    sync_status: "PENDING",
  };
  const stores = [...new Set([...entries.map((entry) => entry.store), "outbox" as const])];
  const db = await openLocalDatabase();
  if (!db) {
    if (coalesceRecordId) {
      const existing = [...(memory.get("outbox")?.values() ?? [])].find(
        (entry) =>
          entry["type"] === type &&
          entry["sync_status"] === "PENDING" &&
          (entry["payload"] as Record<string, unknown> | undefined)?.["record_id"] ===
            coalesceRecordId,
      );
      if (existing)
        operation = {
          ...existing,
          outlet_id: outletId,
          payload,
          sync_status: "PENDING",
          sync_error: null,
        } as unknown as OutboxOperation<T>;
    }
    for (const { store, value } of entries) memory.get(store)?.set(recordKey(store, value), value);
    memory
      .get("outbox")
      ?.set(
        recordKey("outbox", operation as unknown as KeyedRecord),
        operation as unknown as KeyedRecord,
      );
  } else {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(stores, "readwrite");
      for (const { store, value } of entries) transaction.objectStore(store).put(value);
      const outbox = transaction.objectStore("outbox");
      if (coalesceRecordId) {
        const request = outbox.getAll();
        request.onsuccess = () => {
          const pending = (request.result as OutboxOperation[]).find(
            (entry) =>
              entry["type"] === type &&
              entry["sync_status"] === "PENDING" &&
              (entry["payload"] as Record<string, unknown> | undefined)?.["record_id"] ===
                coalesceRecordId,
          );
          if (pending)
            operation = {
              ...pending,
              outlet_id: outletId,
              payload,
              sync_status: "PENDING",
              sync_error: null,
            } as unknown as OutboxOperation<T>;
          outbox.put(operation as unknown as KeyedRecord);
        };
      } else outbox.put(operation as unknown as KeyedRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not commit local operation."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Could not commit local operation."));
    });
  }
  for (const store of stores) emitChange(store);
  return operation;
}

export async function replaceLocalCollection<T extends KeyedRecord>(
  store: LocalStoreName,
  values: T[],
): Promise<void> {
  const db = await openLocalDatabase();
  if (!db) {
    const target = memory.get(store);
    target?.clear();
    for (const value of values) target?.set(recordKey(store, value), value);
    emitChange(store);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    objectStore.clear();
    for (const value of values) objectStore.put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error(`Could not refresh ${store}.`));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`Could not refresh ${store}.`));
  });
  emitChange(store);
}

export async function deleteLocal(store: LocalStoreName, key: IDBValidKey): Promise<void> {
  const db = await openLocalDatabase();
  if (!db) {
    memory.get(store)?.delete(key);
    emitChange(store);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    transaction.objectStore(store).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error(`Could not delete from ${store}.`));
  });
  emitChange(store);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await getLocal<KeyedRecord>("settings", key);
  return row?.["value"] as T | undefined;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await putLocal("settings", { key, value } as KeyedRecord);
}

export async function getDeviceId(): Promise<string> {
  const current = await getSetting<string>("device_id");
  if (current) return current;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await setSetting("device_id", id);
  return id;
}

export async function nextLocalSequence(scope: string): Promise<number> {
  const key = `sequence:${scope}`;
  const db = await openLocalDatabase();
  if (!db) {
    const next = ((await getSetting<number>(key)) ?? 0) + 1;
    await setSetting(key, next);
    return next;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.get(key);
    let next = 1;
    request.onsuccess = () => {
      next = Number(request.result?.["value"] ?? 0) + 1;
      store.put({ key, value: next });
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not allocate local sequence."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Could not allocate local sequence."));
  });
}

export async function enqueueOperation<T extends Record<string, unknown>>(
  type: string,
  payload: T,
  outletId: string | null,
): Promise<OutboxOperation<T>> {
  const access = await getSetting<{ user_id?: string }>("active_access_profile");
  const coalesceKey = payload["draft_id"] ?? payload["record_id"];
  if (coalesceKey) {
    const pending = await getPendingOperations();
    const existing = pending.find(
      (entry) =>
        entry.type === type &&
        String(entry.payload["draft_id"] ?? entry.payload["record_id"] ?? "") ===
          String(coalesceKey),
    );
    if (existing) {
      const updated: OutboxOperation<T> = {
        ...existing,
        outlet_id: outletId,
        payload,
        sync_status: "PENDING",
        sync_error: null,
      };
      await putLocal("outbox", updated as unknown as KeyedRecord);
      return updated;
    }
  }
  const operation: OutboxOperation<T> = {
    operation_id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    device_id: await getDeviceId(),
    ...(access?.user_id ? { user_id: access.user_id } : {}),
    outlet_id: outletId,
    created_at: new Date().toISOString(),
    type,
    payload,
    sync_status: "PENDING",
  };
  await putLocal("outbox", operation as unknown as KeyedRecord);
  return operation;
}

export async function updateOperation(operation: OutboxOperation): Promise<void> {
  await putLocal("outbox", operation as unknown as KeyedRecord);
}

function newOperationId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function payloadFingerprint(payload: unknown) {
  return JSON.stringify(payload, (_key, value: unknown) => {
    if (typeof Blob !== "undefined" && value instanceof Blob)
      return { __blob: true, size: value.size, type: value.type };
    return value;
  });
}

/** Apply a sync response only if the operation payload was not edited while its request was in flight. */
export async function settleOperation(
  sent: OutboxOperation,
  status: SyncStatus,
  syncError?: string | null,
): Promise<{ operation: OutboxOperation; superseded: boolean }> {
  const db = await openLocalDatabase();
  if (!db) {
    const store = memory.get("outbox");
    const current = store?.get(sent.operation_id) as OutboxOperation | undefined;
    if (!current) return { operation: sent, superseded: false };
    if (payloadFingerprint(current.payload) !== payloadFingerprint(sent.payload)) {
      store?.delete(sent.operation_id);
      const next = {
        ...current,
        operation_id: newOperationId(),
        sync_status: "PENDING" as const,
        sync_error: null,
      };
      store?.set(next.operation_id, next as unknown as KeyedRecord);
      emitChange("outbox");
      return { operation: next, superseded: true };
    }
    const updated = {
      ...current,
      sync_status: status,
      sync_error: syncError ?? current.sync_error ?? null,
    };
    store?.set(sent.operation_id, updated as unknown as KeyedRecord);
    emitChange("outbox");
    return { operation: updated, superseded: false };
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("outbox", "readwrite");
    const store = transaction.objectStore("outbox");
    let result: { operation: OutboxOperation; superseded: boolean } = {
      operation: sent,
      superseded: false,
    };
    const request = store.get(sent.operation_id);
    request.onsuccess = () => {
      const current = request.result as OutboxOperation | undefined;
      if (!current) return;
      if (payloadFingerprint(current.payload) !== payloadFingerprint(sent.payload)) {
        store.delete(sent.operation_id);
        const next = {
          ...current,
          operation_id: newOperationId(),
          sync_status: "PENDING" as const,
          sync_error: null,
        };
        store.put(next as unknown as KeyedRecord);
        result = { operation: next, superseded: true };
      } else {
        const updated = {
          ...current,
          sync_status: status,
          sync_error: syncError ?? current.sync_error ?? null,
        };
        store.put(updated as unknown as KeyedRecord);
        result = { operation: updated, superseded: false };
      }
    };
    transaction.oncomplete = () => {
      emitChange("outbox");
      resolve(result);
    };
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not finalize sync status."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Could not finalize sync status."));
  });
}

export async function getPendingOperations(): Promise<OutboxOperation[]> {
  return (await getAllLocal<OutboxOperation & KeyedRecord>("outbox"))
    .filter((operation) => operation.sync_status === "PENDING")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function localStoragePersistentRequest(): Promise<boolean> {
  if (!isBrowser() || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
