import { describe, expect, it, vi } from "vitest";
import {
  isBarcodeMessage,
  isImageReviewMessage,
  parseScannerPairPayload,
  sendBarcode,
  sendImageReview,
} from "@/lib/scanner-pairing";

function pairingCode(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    app: "retailflow-scanner",
    version: 1,
    role: "offer",
    session: "test-session",
    createdAt: Date.now(),
    sdp: "local-offer",
    ...overrides,
  });
}

describe("RetailFlow scanner pairing protocol", () => {
  it("accepts a current POS offer and checks the expected QR role", () => {
    expect(parseScannerPairPayload(pairingCode(), "offer")).toMatchObject({
      app: "retailflow-scanner",
      role: "offer",
      session: "test-session",
    });
    expect(() => parseScannerPairPayload(pairingCode(), "answer")).toThrow(
      "Scan the phone reply QR code.",
    );
  });

  it.each([
    ["expired", { createdAt: Date.now() - 5 * 60 * 1000 - 1 }],
    ["from the future", { createdAt: Date.now() + 60_000 }],
    ["wrong application", { app: "other-scanner" }],
    ["oversized SDP", { sdp: "x".repeat(12_001) }],
  ])("rejects a pairing code that is %s", (_reason, overrides) => {
    expect(() => parseScannerPairPayload(pairingCode(overrides))).toThrow();
  });

  it("validates keyboard and phone barcode messages and sends only open-channel scans", () => {
    expect(isBarcodeMessage({ type: "barcode", code: "  12345  " })).toBe(true);
    expect(isBarcodeMessage({ type: "barcode", code: "  " })).toBe(false);
    expect(isBarcodeMessage({ type: "image-review", code: "12345" })).toBe(false);

    const send = vi.fn();
    const channel = { readyState: "open", send } as unknown as RTCDataChannel;
    expect(sendBarcode(channel, "  12345  ")).toBe(true);
    expect(JSON.parse(send.mock.calls[0]![0] as string)).toMatchObject({
      type: "barcode",
      code: "12345",
    });

    const closedChannel = { readyState: "closed", send } as unknown as RTCDataChannel;
    expect(sendBarcode(closedChannel, "12345")).toBe(false);
    expect(sendBarcode(channel, "  ")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends only a small JPEG review image over an open paired channel", async () => {
    expect(
      isImageReviewMessage({
        type: "image-review",
        data_url: "data:image/jpeg;base64,AA==",
      }),
    ).toBe(true);
    expect(
      isImageReviewMessage({
        type: "image-review",
        data_url: `data:image/png;base64,${"A".repeat(16)}`,
      }),
    ).toBe(false);

    const send = vi.fn();
    const channel = { readyState: "open", send } as unknown as RTCDataChannel;
    await sendImageReview(channel, new Blob(["jpeg"], { type: "image/jpeg" }));
    const message = JSON.parse(send.mock.calls[0]![0] as string) as {
      type: string;
      data_url: string;
    };
    expect(message.type).toBe("image-review");
    expect(message.data_url).toMatch(/^data:image\/jpeg;base64,/);

    await expect(
      sendImageReview(channel, new Blob(["x".repeat(32_001)], { type: "image/jpeg" })),
    ).rejects.toThrow("Only a low-resolution review photo under 32 KB can be sent.");
    await expect(
      sendImageReview(channel, new Blob(["png"], { type: "image/png" })),
    ).rejects.toThrow("Only a low-resolution review photo under 32 KB can be sent.");
    await expect(
      sendImageReview(
        { readyState: "closed", send } as unknown as RTCDataChannel,
        new Blob(["jpeg"], { type: "image/jpeg" }),
      ),
    ).rejects.toThrow("The POS connection is not ready yet.");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
