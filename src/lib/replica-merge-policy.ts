import type { KeyedRecord } from "@/lib/local-db";

export function mergeReplicaRows(
  table: string,
  remoteRows: KeyedRecord[],
  localRows: KeyedRecord[],
) {
  const localById = new Map(localRows.map((row) => [String(row.id), row]));
  const merged = new Map<string, KeyedRecord>();

  for (const row of remoteRows) {
    const id = String(row.id ?? "");
    const local = localById.get(id);
    merged.set(
      id,
      local?.["sync_status"] === "PENDING" || local?.["sync_status"] === "LOCAL"
        ? local
        : { ...local, ...row, sync_status: "SYNCED" },
    );
  }
  for (const row of localRows) {
    const id = String(row.id ?? "");
    if (!merged.has(id) && table !== "locations") merged.set(id, row);
  }

  return [...merged.values()];
}
