export type ScannerPairPayload = {
  app: "retailflow-scanner";
  version: 1;
  role: "offer" | "answer";
  session: string;
  createdAt: number;
  sdp: string;
};

export interface ScannerAdapter {
  readonly id: string;
  readonly label: string;
  connect(onCode: (code: string) => void, onError?: (error: unknown) => void): Promise<void>;
  disconnect(): Promise<void>;
}

export function registerScannerAdapter(adapter: ScannerAdapter) {
  const adapters = getScannerAdapterRegistry();
  adapters.set(adapter.id, adapter);
  return () => adapters.delete(adapter.id);
}

const adapterRegistry = new Map<string, ScannerAdapter>();
function getScannerAdapterRegistry() {
  return adapterRegistry;
}

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
};
type SerialNavigator = Navigator & {
  serial?: { requestPort: () => Promise<SerialPortLike> };
};

/** Generic newline-delimited serial adapter; HID keyboard-wedge scanners need no setup. */
export function createWebSerialScannerAdapter(baudRate = 9600): ScannerAdapter {
  let port: SerialPortLike | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stopped = false;
  return {
    id: `webserial-${baudRate}`,
    label: `Web Serial (${baudRate} baud)`,
    async connect(onCode, onError) {
      const serial = (navigator as SerialNavigator).serial;
      if (!serial) throw new Error("Web Serial is not supported by this browser.");
      port = await serial.requestPort();
      await port.open({ baudRate });
      if (!port.readable) throw new Error("The selected scanner has no readable serial stream.");
      reader = port.readable.getReader();
      stopped = false;
      let buffer = "";
      const decoder = new TextDecoder();
      void (async () => {
        try {
          while (!stopped && reader) {
            const { value, done } = await reader.read();
            if (value) buffer += decoder.decode(value, { stream: !done });
            if (done) break;
            const lines = buffer.split(/[\r\n]+/);
            buffer = lines.pop() ?? "";
            for (const line of lines) if (line.trim()) onCode(line.trim());
            if (buffer.length > 512) {
              onCode(buffer.trim());
              buffer = "";
            }
          }
        } catch (error) {
          if (!stopped) onError?.(error);
        }
      })();
    },
    async disconnect() {
      stopped = true;
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
      reader = null;
      await port?.close().catch(() => undefined);
      port = null;
    },
  };
}

const PAIR_TTL_MS = 5 * 60 * 1000;

export function parseScannerPairPayload(value: string, expectedRole?: ScannerPairPayload["role"]) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("This QR code is not a RetailFlow scanner pairing code.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid scanner pairing code.");
  const payload = parsed as Partial<ScannerPairPayload>;
  if (
    payload.app !== "retailflow-scanner" ||
    payload.version !== 1 ||
    (payload.role !== "offer" && payload.role !== "answer") ||
    !payload.session ||
    typeof payload.createdAt !== "number" ||
    typeof payload.sdp !== "string" ||
    payload.sdp.length > 12000
  ) {
    throw new Error("The pairing code is incomplete or unsupported.");
  }
  if (Date.now() - payload.createdAt > PAIR_TTL_MS || payload.createdAt > Date.now() + 30_000) {
    throw new Error("This pairing code has expired. Start a new pairing session.");
  }
  if (expectedRole && payload.role !== expectedRole) {
    throw new Error(
      expectedRole === "offer" ? "Scan the POS pairing QR code." : "Scan the phone reply QR code.",
    );
  }
  return payload as ScannerPairPayload;
}

function waitForIceGathering(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      reject(
        new Error(
          "The device network could not prepare a local pairing connection. Try again on the same Wi-Fi.",
        ),
      );
    }, 12000);
    const onStateChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function newSessionId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createScannerOffer(onChannel: (channel: RTCDataChannel) => void) {
  const peer = new RTCPeerConnection({ iceServers: [] });
  const channel = peer.createDataChannel("retailflow-barcode", { ordered: true });
  onChannel(channel);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await waitForIceGathering(peer);
  const payload: ScannerPairPayload = {
    app: "retailflow-scanner",
    version: 1,
    role: "offer",
    session: newSessionId(),
    createdAt: Date.now(),
    sdp: peer.localDescription?.sdp ?? "",
  };
  if (!payload.sdp) throw new Error("Could not create the local pairing code.");
  return { peer, payload };
}

export async function acceptScannerOffer(
  value: string,
  onChannel: (channel: RTCDataChannel) => void,
) {
  const offer = parseScannerPairPayload(value, "offer");
  const peer = new RTCPeerConnection({ iceServers: [] });
  peer.ondatachannel = (event) => onChannel(event.channel);
  await peer.setRemoteDescription({ type: "offer", sdp: offer.sdp });
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  await waitForIceGathering(peer);
  const payload: ScannerPairPayload = {
    ...offer,
    role: "answer",
    sdp: peer.localDescription?.sdp ?? "",
  };
  if (!payload.sdp) throw new Error("Could not create the phone reply code.");
  return { peer, payload };
}

export async function acceptScannerAnswer(
  peer: RTCPeerConnection,
  value: string,
  expectedSession: string,
) {
  const answer = parseScannerPairPayload(value, "answer");
  if (answer.session !== expectedSession)
    throw new Error("That reply belongs to a different pairing attempt.");
  if (peer.signalingState !== "have-local-offer")
    throw new Error("Start a new pairing before scanning the reply.");
  await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
}

export function sendBarcode(channel: RTCDataChannel, code: string) {
  const value = code.trim();
  if (!value || channel.readyState !== "open") return false;
  channel.send(JSON.stringify({ type: "barcode", code: value, at: Date.now() }));
  return true;
}

export async function sendImageReview(channel: RTCDataChannel, image: Blob) {
  if (channel.readyState !== "open") throw new Error("The POS connection is not ready yet.");
  if (image.type !== "image/jpeg" || image.size > 32_000)
    throw new Error("Only a low-resolution review photo under 32 KB can be sent.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not prepare the review photo."));
    reader.onerror = () => reject(new Error("Could not read the review photo."));
    reader.readAsDataURL(image);
  });
  const message = JSON.stringify({ type: "image-review", data_url: dataUrl, at: Date.now() });
  if (message.length > 48_000)
    throw new Error("The review photo is too large. Move closer to the barcode and try again.");
  channel.send(message);
}

export function isBarcodeMessage(value: unknown): value is { type: "barcode"; code: string } {
  if (!value || typeof value !== "object") return false;
  const message = value as { type?: unknown; code?: unknown };
  return (
    message.type === "barcode" && typeof message.code === "string" && message.code.trim().length > 0
  );
}

export function isImageReviewMessage(
  value: unknown,
): value is { type: "image-review"; data_url: string } {
  if (!value || typeof value !== "object") return false;
  const message = value as { type?: unknown; data_url?: unknown };
  return (
    message.type === "image-review" &&
    typeof message.data_url === "string" &&
    message.data_url.startsWith("data:image/jpeg;base64,") &&
    message.data_url.length <= 48_000
  );
}

export function scannerCapabilities() {
  if (typeof navigator === "undefined")
    return { camera: false, hid: false, serial: false, bluetooth: false };
  const extended = navigator as Navigator & {
    hid?: unknown;
    serial?: unknown;
    bluetooth?: unknown;
  };
  return {
    camera: !!navigator.mediaDevices?.getUserMedia,
    hid: !!extended.hid,
    serial: !!extended.serial,
    bluetooth: !!extended.bluetooth,
  };
}
