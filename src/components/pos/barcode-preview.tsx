import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BarcodePreview({ value, caption }: { value: string; caption?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: "CODE128",
        displayValue: true,
        fontSize: 12,
        height: 48,
        margin: 4,
      });
    } catch {
      svgRef.current.replaceChildren();
    }
  }, [value]);

  function printLabel() {
    if (!svgRef.current) return;
    const printWindow = window.open("", "_blank", "width=420,height=260");
    if (!printWindow) return;
    const style = printWindow.document.createElement("style");
    style.textContent =
      "@page{size:60mm 35mm;margin:2mm}body{font:12px sans-serif;text-align:center;margin:0}svg{max-width:100%;height:auto}";
    const label = printWindow.document.createElement("main");
    label.append(printWindow.document.importNode(svgRef.current, true));
    if (caption) {
      const name = printWindow.document.createElement("p");
      name.textContent = caption;
      label.append(name);
    }
    printWindow.document.head.append(style);
    printWindow.document.body.append(label);
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  }

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border bg-background px-2 py-1">
      <svg ref={svgRef} role="img" aria-label={`Barcode ${value}`} className="h-16 max-w-full" />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={printLabel}
        aria-label="Print barcode label"
      >
        <Printer className="h-4 w-4" />
      </Button>
    </div>
  );
}
