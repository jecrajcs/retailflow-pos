import { describe, expect, it } from "vitest";
import {
  deriveOfflinePinVerifier,
  isOfflinePinVerifier,
  OFFLINE_PIN_ITERATIONS,
} from "@/lib/offline-pin";

describe("server-backed offline PIN verifier", () => {
  it("derives a deterministic verifier and changes it when the salt changes", async () => {
    const first = await deriveOfflinePinVerifier("123456", "a".repeat(32), 100);
    const repeated = await deriveOfflinePinVerifier("123456", "a".repeat(32), 100);
    const differentSalt = await deriveOfflinePinVerifier("123456", "b".repeat(32), 100);

    expect(first).toHaveLength(64);
    expect(repeated).toBe(first);
    expect(differentSalt).not.toBe(first);
  });

  it("accepts only verifiers with the configured work factor and encoding", () => {
    const valid = {
      salt: "a".repeat(32),
      verifier: "b".repeat(64),
      iterations: OFFLINE_PIN_ITERATIONS,
    };

    expect(isOfflinePinVerifier(valid)).toBe(true);
    expect(isOfflinePinVerifier({ ...valid, iterations: 1 })).toBe(false);
    expect(isOfflinePinVerifier({ ...valid, verifier: "plain-pin" })).toBe(false);
  });
});
