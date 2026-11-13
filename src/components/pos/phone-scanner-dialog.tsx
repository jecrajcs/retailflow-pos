import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listenForPhoneScannerDialog } from "@/lib/phone-scanner-events";

export function PhoneScannerDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return listenForPhoneScannerDialog(() => setOpen(true));
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(90dvh,52rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Connect a phone scanner
          </DialogTitle>
          <DialogDescription>
            Keep this dialog open while pairing over the same Wi-Fi or hotspot.
          </DialogDescription>
        </DialogHeader>
        <iframe
          title="Phone scanner pairing"
          src="/scanner?embedded=1"
          allow="camera"
          className="min-h-0 w-full flex-1 border-0"
        />
      </DialogContent>
    </Dialog>
  );
}
