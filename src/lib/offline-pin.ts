export const OFFLINE_PIN_ITERATIONS = 310_000;

export interface OfflinePinVerifier {
  salt: string;
  verifier: string;
  iterations: number;
}

export async function deriveOfflinePinVerifier(
  pin: string,
  salt: string,
  iterations = OFFLINE_PIN_ITERATIONS,
) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createOfflinePinVerifier(pin: string): Promise<OfflinePinVerifier> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    salt,
    verifier: await deriveOfflinePinVerifier(pin, salt),
    iterations: OFFLINE_PIN_ITERATIONS,
  };
}

export function isOfflinePinVerifier(value: unknown): value is OfflinePinVerifier {
  return (
    value !== null &&
    typeof value === "object" &&
    "salt" in value &&
    typeof value.salt === "string" &&
    /^[a-f0-9]{32}$/.test(value.salt) &&
    "verifier" in value &&
    typeof value.verifier === "string" &&
    /^[a-f0-9]{64}$/.test(value.verifier) &&
    "iterations" in value &&
    value.iterations === OFFLINE_PIN_ITERATIONS
  );
}
