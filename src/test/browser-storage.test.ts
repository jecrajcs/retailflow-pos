import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserStorage, removeBrowserStorage, setBrowserStorage } from "@/lib/browser-storage";

afterEach(() => vi.restoreAllMocks());

describe("browser settings storage fallback", () => {
  it("keeps settings available for this tab when browser storage is blocked", () => {
    const key = `blocked-storage-${crypto.randomUUID()}`;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });

    setBrowserStorage(key, "value");
    expect(getBrowserStorage(key)).toBe("value");
    removeBrowserStorage(key);
    expect(getBrowserStorage(key)).toBeNull();
  });
});
