import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import QRCodeSVG from "react-qr-code";
import { Camera, Check, Copy, Link2, Radio, ScanBarcode, Smartphone, Wifi } from "lucide-react";
import { toast } from "sonner";
import { AppNav } from "@/components/pos/app-nav";
import { CameraScannerPanel } from "@/components/pos/camera-scanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acceptScannerAnswer,
  acceptScannerOffer,
  createWebSerialScannerAdapter,
  createScannerOffer,
  isBarcodeMessage,
  scannerCapabilities,
  sendBarcode,
  type ScannerPairPayload,
  type ScannerAdapter,
} from "@/lib/scanner-pairing";

export const Route = createFileRoute("/scanner")({ component: BarcodeScannerPage });

function BarcodeScannerPage() {
  const [phoneMode, setPhoneMode] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [offer, setOffer] = useState<ScannerPairPayload | null>(null);
  const [answer, setAnswer] = useState<ScannerPairPayload | null>(null);
  const [connection, setConnection] = useState<"idle" | "waiting" | "connected" | "failed">("idle");
  const [error, setError] = useState("");
  const [lastCode, setLastCode] = useState("");
  const [serialConnected, setSerialConnected] = useState(false);
  const [caps, setCaps] = useState({ camera: false, hid: false, serial: false, bluetooth: false });
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const serialAdapterRef = useRef<ScannerAdapter | null>(null);

  useEffect(() => {
    setPhoneMode(new URLSearchParams(window.location.search).get("mode") === "phone");
    setCaps(scannerCapabilities());
    if (typeof BroadcastChannel !== "undefined") broadcastRef.current = new BroadcastChannel("retailflow-pos-scanner");
    return () => {
      channelRef.current?.close();
      peerRef.current?.close();
      broadcastRef.current?.close();
      void serialAdapterRef.current?.disconnect();
    };
  }, []);

  function attachChannel(channel: RTCDataChannel, isDesktop: boolean) {
    channelRef.current = channel;
    channel.onopen = () => setConnection("connected");
    channel.onclose = () => setConnection("idle");
    channel.onerror = () => setConnection("failed");
    if (isDesktop) {
      channel.onmessage = (event) => {
        let message: unknown;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (!isBarcodeMessage(message)) return;
        setLastCode(message.code);
        broadcastRef.current?.postMessage({ type: "barcode", code: message.code });
      };
    }
  }

  async function startDesktopPairing() {
    setError("");
    setAnswer(null);
    setConnection("waiting");
    try {
      peerRef.current?.close();
      const created = await createScannerOffer((channel) => attachChannel(channel, true));
      peerRef.current = created.peer;
      setOffer(created.payload);
    } catch (cause) {
      setConnection("failed");
      setError(cause instanceof Error ? cause.message : "Could not start phone pairing.");
    }
  }

  async function receivePhoneOffer(value: string) {
    setCameraActive(false);
    setError("");
    try {
      const paired = await acceptScannerOffer(value, (channel) => attachChannel(channel, false));
      peerRef.current?.close();
      peerRef.current = paired.peer;
      setAnswer(paired.payload);
      setConnection("waiting");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not pair with this POS.");
      setCameraActive(true);
    }
  }

  async function receivePhoneAnswer(value: string) {
    setCameraActive(false);
    setError("");
    try {
      if (!peerRef.current || !offer) throw new Error("Start a new pairing before scanning a phone reply.");
      await acceptScannerAnswer(peerRef.current, value, offer.session);
      setAnswer(null);
      setConnection("waiting");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish phone pairing.");
      setCameraActive(true);
    }
  }

  function handleCameraValue(value: string) {
    if (phoneMode) {
      if (!answer) void receivePhoneOffer(value);
      else {
        const channel = channelRef.current;
        if (!channel || !sendBarcode(channel, value)) toast.error("The POS connection is not ready yet.");
        else {
          setLastCode(value);
          if ("vibrate" in navigator) navigator.vibrate?.(45);
        }
      }
      return;
    }
    void receivePhoneAnswer(value);
  }

  async function toggleSerialScanner() {
    if (serialAdapterRef.current) {
      await serialAdapterRef.current.disconnect();
      serialAdapterRef.current = null;
      setSerialConnected(false);
      return;
    }
    const adapter = createWebSerialScannerAdapter(9600);
    serialAdapterRef.current = adapter;
    try {
      await adapter.connect(
        (code) => {
          setLastCode(code);
          broadcastRef.current?.postMessage({ type: "barcode", code });
        },
        (cause) => {
          setSerialConnected(false);
          toast.error("Serial scanner connection ended", { description: cause instanceof Error ? cause.message : "Reconnect the scanner and try again." });
        },
      );
      setSerialConnected(true);
      toast.success("Serial scanner connected");
    } catch (cause) {
      serialAdapterRef.current = null;
      setSerialConnected(false);
      toast.error("Could not connect serial scanner", { description: cause instanceof Error ? cause.message : "Choose a supported serial scanner." });
    }
  }

  const phoneUrl = typeof window === "undefined" ? "" : `${window.location.origin}/scanner?mode=phone`;
  const connectionLabel = connection === "connected" ? "Connected" : connection === "waiting" ? "Waiting for the other device" : connection === "failed" ? "Connection issue" : "Not paired";

  return (
    <div className="pos-shell flex h-dvh flex-col overflow-hidden bg-background">
      {!phoneMode && <AppNav active="/barcodes" />}
      <main className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto p-3 sm:p-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground"><ScanBarcode className="h-4 w-4" /> RetailFlow scanner</p>
            <h1 className="mt-1 text-2xl font-bold">{phoneMode ? "Phone scanner" : "Barcode scanning"}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Scan product barcodes in RetailFlow. Camera frames and decoded values stay on your devices; pairing uses a short-lived QR exchange and a local peer connection.</p>
          </div>
          {phoneMode ? <Badge variant={connection === "connected" ? "default" : "secondary"}>{connectionLabel}</Badge> : <Button asChild variant="outline"><Link to="/barcodes">Manager barcode review</Link></Button>}
        </header>

        {error && <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

        {phoneMode ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Pair this phone</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {answer ? (
                  <>
                    <p className="text-sm text-muted-foreground">Scan this reply QR from the POS screen. Keep this page open while scanning products.</p>
                    <div className="mx-auto w-fit rounded-xl bg-white p-3"><QRCodeSVG value={JSON.stringify(answer)} size={248} /></div>
                    <div className="text-center text-sm">{connectionLabel}</div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">Open the pairing screen on the POS, then scan its QR code here.</p>
                    {!cameraActive && <Button className="w-full" onClick={() => setCameraActive(true)}><Camera className="mr-2 h-4 w-4" /> Scan POS pairing QR</Button>}
                  </>
                )}
              </CardContent>
            </Card>
            {cameraActive && <CameraScannerPanel active onScan={handleCameraValue} />}
            {answer && connection === "connected" && (
              <Card className="lg:col-span-2"><CardContent className="flex items-center gap-3 p-4"><Check className="h-5 w-5 text-success" /><div><div className="font-medium">Phone connected to POS</div><div className="text-sm text-muted-foreground">Point the camera at a product barcode. A vibration confirms the phone sent a scan.</div></div><Button className="ml-auto" onClick={() => setCameraActive((value) => !value)}>{cameraActive ? "Pause camera" : "Start camera"}</Button></CardContent></Card>
            )}
            {lastCode && <div className="rounded-lg border bg-card p-3 font-mono text-sm">Last scan: {lastCode}</div>}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Pair a phone over local Wi-Fi</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Open the phone companion in RetailFlow, scan the POS QR with its camera, then scan the reply QR from the phone here. Both devices must be on the same Wi-Fi or hotspot. Pairing expires after five minutes.</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void startDesktopPairing()}><Radio className="mr-2 h-4 w-4" /> Start pairing</Button>
                  <Button variant="outline" onClick={() => window.open(phoneUrl, "retailflow-phone-scanner", "noopener,noreferrer")}>Open phone companion</Button>
                  <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(phoneUrl).then(() => toast.success("Phone link copied")).catch(() => toast.error("Could not copy the phone link"))}><Copy className="mr-2 h-4 w-4" /> Copy phone link</Button>
                </div>
                <p className="text-sm">Status: <span className="font-medium">{connectionLabel}</span></p>
                {offer && (
                  <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
                    <div className="mx-auto w-fit rounded-xl bg-white p-3"><QRCodeSVG value={JSON.stringify(offer)} size={248} /></div>
                    <div className="space-y-3">
                      <p className="text-sm">1. Scan this QR from the phone companion.</p>
                      <p className="text-sm">2. When the phone shows its reply QR, scan the reply below.</p>
                      <Button variant="outline" onClick={() => setCameraActive((value) => !value)}><Camera className="mr-2 h-4 w-4" />{cameraActive ? "Stop reply scanner" : "Scan phone reply"}</Button>
                      <p className="break-all font-mono text-xs text-muted-foreground">Session {offer.session.slice(0, 12)} · local peer connection</p>
                    </div>
                  </div>
                )}
                {cameraActive && <CameraScannerPanel active onScan={handleCameraValue} />}
                {lastCode && <div className="rounded-lg border bg-card p-3 font-mono text-sm">Phone scan: {lastCode}</div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Wifi className="h-5 w-5" /> Available scan methods</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Capability label="This device camera" available={caps.camera} detail="Web camera with the bundled offline decoder." />
                <Capability label="Phone camera" available={caps.camera} detail="RetailFlow phone companion; no additional app install." />
                <Capability label="Keyboard wedge scanner" available detail="USB and Bluetooth scanners that type the code and press Enter work in Billing search." />
                <Capability label="WebHID / WebSerial / WebBluetooth" available={caps.hid || caps.serial || caps.bluetooth} detail="Feature detected where supported. Model-specific protocols can be added through the ScannerAdapter interface." />
                {caps.serial && <Button className="w-full" variant="outline" onClick={() => void toggleSerialScanner()}>{serialConnected ? "Disconnect serial scanner" : "Connect Web Serial scanner · 9600 baud"}</Button>}
                <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">Camera permission requires HTTPS or localhost. No barcode code or image is uploaded by this scanner.</div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function Capability({ label, available, detail }: { label: string; available: boolean; detail: string }) {
  return <div className="flex items-start gap-3 rounded-lg border p-3"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${available ? "bg-success" : "bg-muted-foreground/40"}`} /><div><div className="font-medium">{label}</div><div className="text-xs text-muted-foreground">{detail}</div></div></div>;
}
