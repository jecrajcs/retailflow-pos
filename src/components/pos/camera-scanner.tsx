import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Camera, ImageUp, LoaderCircle, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

async function lowResolutionJpeg(source: CanvasImageSource, width: number, height: number) {
  for (const maxEdge of [640, 480, 360]) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the review image.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.42, 0.32, 0.24]) {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not prepare the review image.")), "image/jpeg", quality),
      );
      if (blob.size <= 32_000) return blob;
    }
  }
  throw new Error("Could not reduce this photo enough for local POS review.");
}

export function CameraScannerPanel({
  active,
  onScan,
  onImageReview,
  requestReviewImage = false,
  compact = false,
}: {
  active: boolean;
  onScan: (value: string) => void;
  onImageReview?: (image: Blob) => void | Promise<void>;
  requestReviewImage?: boolean;
  compact?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onScan);
  const imageReviewRef = useRef(onImageReview);
  const lastCode = useRef({ value: "", at: 0 });
  const [cameraState, setCameraState] = useState<"starting" | "ready" | "failed">("starting");
  const [cameraError, setCameraError] = useState("");
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    callbackRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    imageReviewRef.current = onImageReview;
  }, [onImageReview]);

  useEffect(() => {
    if (!active || !videoRef.current) return;
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserMultiFormatReader();
    setCameraState("starting");
    setCameraError("");
    void reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result || cancelled) return;
        const value = result.getText().trim();
        const now = Date.now();
        if (!value || (value === lastCode.current.value && now - lastCode.current.at < 1400)) return;
        lastCode.current = { value, at: now };
        setCameraState("ready");
        callbackRef.current(value);
      })
      .then((nextControls) => {
        controls = nextControls;
        if (!cancelled) setCameraState("ready");
        else nextControls.stop();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCameraState("failed");
        const detail = error instanceof Error ? error.message : "Camera access was denied.";
        setCameraError(
          detail.includes("secure") || detail.includes("HTTPS")
            ? "Camera scanning requires this RetailFlow page to be opened over HTTPS or localhost."
            : "Allow camera access in the browser, then try again. A USB barcode scanner can still type into the billing search field.",
        );
      });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [active]);

  async function decodeImage(file?: File) {
    if (!file || imageBusy) return;
    setImageBusy(true);
    let reviewBlob: Blob | null = null;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This image could not be prepared for barcode reading.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Could not prepare this image."))), "image/jpeg", 0.72),
      );
      reviewBlob = await lowResolutionJpeg(canvas, canvas.width, canvas.height);
      const imageUrl = URL.createObjectURL(blob);
      try {
        const result = await new BrowserMultiFormatReader().decodeFromImageUrl(imageUrl);
        const value = result.getText().trim();
        if (!value) throw new Error("No barcode was found. Try a clearer photo or use live camera scanning.");
        callbackRef.current(value);
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error) {
      if (reviewBlob && imageReviewRef.current) {
        try {
          await imageReviewRef.current(reviewBlob);
          toast.info("Photo sent to the POS for staff review");
        } catch {
          toast.error("Could not send the photo to the POS");
        }
      }
      toast.error("Could not read this barcode image", {
        description: error instanceof Error ? error.message : "Try another photo.",
      });
    } finally {
      setImageBusy(false);
    }
  }

  async function sendCurrentFrameForReview() {
    const video = videoRef.current;
    if (!video || !imageReviewRef.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      toast.error("Wait for the camera preview before sending a review image.");
      return;
    }
    setImageBusy(true);
    try {
      const blob = await lowResolutionJpeg(video, video.videoWidth, video.videoHeight);
      await imageReviewRef.current(blob);
      toast.success("Low-resolution photo sent to the POS");
    } catch (error) {
      toast.error("Could not send the camera image", {
        description: error instanceof Error ? error.message : "Try again on the same local network.",
      });
    } finally {
      setImageBusy(false);
    }
  }

  useEffect(() => {
    if (active && requestReviewImage && cameraState === "ready")
      void sendCurrentFrameForReview();
    // A single requested photo is sent per true request; the parent clears it on acknowledgement.
  }, [active, requestReviewImage, cameraState]);

  return (
    <div className="space-y-3">
      <div className={`relative overflow-hidden rounded-xl bg-slate-950 ${compact ? "aspect-[4/3]" : "aspect-video"}`}>
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" aria-label="Live barcode camera" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-20 -translate-y-1/2 rounded-xl border-2 border-emerald-300/90 shadow-[0_0_35px_rgba(52,211,153,.4)]" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 animate-pulse bg-emerald-300/80" />
        {cameraState === "starting" && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-sm text-white">
            <span className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" /> Starting camera…</span>
          </div>
        )}
        {cameraState === "failed" && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/85 p-5 text-center text-sm text-white/85">
            <div><Camera className="mx-auto mb-2 h-6 w-6 text-emerald-200" />{cameraError}</div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ScanBarcode className="h-4 w-4" /> Keep the code in the frame. Scans stay on this device.
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          {imageBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
          Read a photo
          <input
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={imageBusy}
            onChange={(event) => {
              void decodeImage(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {onImageReview && (
          <Button type="button" variant="outline" size="sm" disabled={imageBusy || cameraState !== "ready"} onClick={() => void sendCurrentFrameForReview()}>
            Send photo to POS for review
          </Button>
        )}
      </div>
    </div>
  );
}

export function CameraScannerDialog({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (value: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scan a product barcode</DialogTitle>
          <DialogDescription>Use this device camera, or read a photo stored on this device.</DialogDescription>
        </DialogHeader>
        {open && (
          <CameraScannerPanel
            active={open}
            onScan={(value) => {
              onScan(value);
              onOpenChange(false);
            }}
          />
        )}
        <Button variant="outline" onClick={() => onOpenChange(false)}>Close scanner</Button>
      </DialogContent>
    </Dialog>
  );
}
