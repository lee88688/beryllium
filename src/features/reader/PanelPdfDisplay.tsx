import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { PdfMode, PdfZoom } from "./pdf/engine";

export type PanelPdfDisplayProps = {
  mode: PdfMode;
  onModeChange: (mode: PdfMode) => void;
  zoom: PdfZoom;
  onFitWidth: () => void;
  onFitPage: () => void;
};

/** PDF-only replacement for the EPUB typography panel. */
export function PanelPdfDisplay({
  mode,
  onModeChange,
  zoom,
  onFitWidth,
  onFitPage,
}: PanelPdfDisplayProps) {
  return (
    <div className="flex flex-col gap-4 p-3">
      <section className="space-y-2">
        <h3 className="text-muted-foreground text-sm font-semibold tracking-[0.04em]">
          阅读方式
        </h3>
        <div className="flex gap-2">
          <Button
            variant={mode === "scroll" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1"
            aria-pressed={mode === "scroll"}
            onClick={() => onModeChange("scroll")}
          >
            连续滚动
          </Button>
          <Button
            variant={mode === "page" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1"
            aria-pressed={mode === "page"}
            onClick={() => onModeChange("page")}
          >
            单页分页
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-muted-foreground text-sm font-semibold tracking-[0.04em]">
          缩放
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(zoom === "fit-width" && "text-foreground")}
            aria-pressed={zoom === "fit-width"}
            onClick={onFitWidth}
          >
            适合宽度
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(zoom === "fit-page" && "text-foreground")}
            aria-pressed={zoom === "fit-page"}
            onClick={onFitPage}
          >
            适合页面
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          连续滚动默认适合宽度；分页模式默认适合页面。桌面可用 Ctrl +
          滚轮，移动端可双指捏合。
        </p>
      </section>
    </div>
  );
}
