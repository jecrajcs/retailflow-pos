const memoryStorage = new Map<string, string>();
let storageWarningLogged = false;

function warnStorageUnavailable(error: unknown) {
  if (storageWarningLogged) return;
  storageWarningLogged = true;
  console.warn(
    "Browser storage is unavailable; this tab will use temporary in-memory settings.",
    error,
  );
}

export function getBrowserStorage(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) memoryStorage.delete(key);
    else memoryStorage.set(key, value);
    return value;
  } catch (error) {
    warnStorageUnavailable(error);
    return memoryStorage.get(key) ?? null;
  }
}

export function setBrowserStorage(key: string, value: string) {
  memoryStorage.set(key, value);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    warnStorageUnavailable(error);
  }
}

export function removeBrowserStorage(key: string) {
  memoryStorage.delete(key);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    warnStorageUnavailable(error);
  }
}
