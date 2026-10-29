import { Minus, Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PdfZoom } from "./pdf/engine";

export type PdfZoomControlsProps = {
  zoom: PdfZoom;
  percent: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
};

export function PdfZoomControls({
  zoom,
  percent,
  onZoomOut,
  onZoomIn,
  onFit,
}: PdfZoomControlsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="缩小"
        onClick={onZoomOut}
      >
        <Minus />
      </Button>
      <span
        className="min-w-10 text-center text-xs tabular-nums"
        aria-label="缩放比例"
      >
        {typeof zoom === "number"
          ? `${Math.round(percent)}%`
          : zoom === "fit-width"
            ? "宽"
            : "页"}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="放大"
        onClick={onZoomIn}
      >
        <Plus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="适合页面"
        onClick={onFit}
      >
        <Scan />
      </Button>
    </div>
  );
}
