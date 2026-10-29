import { ChevronRight } from "lucide-react";

import { cn } from "cn";

import { READER_TEXT_COLUMN_RATIO } from "./epub/theme";

import type { ReaderBoundary } from "./epub/types";

export type ChapterTailProps = {
  boundary: ReaderBoundary;
  /** 正文栏宽（px）：分隔线跟正文同宽，而不是铺满整个阅读区。 */
  columnWidth: number;
  /** 上一次跳转没换成功：就地提示重试，而不是把人推进空白页。 */
  failed: boolean;
  onNext: () => void;
};

/**
 * 连续滚动文档末尾的章节出口。
 *
 * 只在滚动模式出现，压在 `theme.ts#READER_TAIL_SPACE` 预留的尾部空白上：
 * 分隔线告诉读者「本章到此为止」，下面一行才是入口 —— 它属于正文的收尾，
 * 不是浮在阅读区上的工具栏，所以 `m` 收起顶栏时照常显示。
 *
 * 始终挂载、用 `data-open` 切换显隐（而不是条件渲染），淡入淡出才有得可做；
 * 收起时 `inert` + `pointer-events-none`，既不可聚焦也吃不到点击。
 */
export function ChapterTail({
  boundary,
  columnWidth,
  failed,
  onNext,
}: ChapterTailProps) {
  const open = boundary.atEnd;
  const label = failed
    ? "加载失败 · 重试"
    : boundary.nextLabel
      ? `下一章 · ${boundary.nextLabel}`
      : "下一章";

  return (
    <div
      data-slot="chapter-tail"
      data-open={open}
      inert={!open}
      aria-hidden={!open}
      className={cn(
        // `px-2` 与 `main` 的 `p-2` 对齐：分隔行要和分页器量到的那一栏同宽。
        "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-2",
        "transition-[opacity,transform] duration-150 ease-[var(--ease-soft)] motion-reduce:transition-none",
        open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
      // 安全区在浏览器里量不到、也不该由 Tailwind 的任意值去猜：留一点下内边距，
      // 让按钮不被 iOS 的 home indicator 压住。
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div
        className="w-full"
        // 正文宽度 = 阅读区宽 ×（1 − foliate 的左右 gap），上限是栏宽偏好。
        style={{
          width: `${String(READER_TEXT_COLUMN_RATIO * 100)}%`,
          maxWidth: columnWidth,
        }}
      >
        <div className="bg-border h-px w-full" />
        {/* 失败时要能重试，哪怕判定已经拿不到「有没有下一章」：加载失败的章节会把
            分页器的索引一起弄坏（`paginator.js:971-999`），`hasNext` 这时不可信。 */}
        {failed || boundary.hasNext ? (
          <button
            type="button"
            onClick={onNext}
            aria-label={
              // 可达名称必须包含可见文字（WCAG 2.5.3 Label in Name）。
              failed
                ? "加载失败 · 重试"
                : boundary.nextLabel
                  ? `下一章：${boundary.nextLabel}`
                  : "下一章"
            }
            className={cn(
              "pointer-events-auto flex h-11 w-full items-center gap-2 text-left text-sm",
              "transition-colors duration-150 outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/50",
              failed ? "text-muted-foreground" : "text-foreground",
            )}
          >
            <span className="truncate">{label}</span>
            <ChevronRight className="text-muted-foreground ml-auto size-4 shrink-0" />
          </button>
        ) : (
          // 全书末章：同一个位置、同一行高，只换成完成态，不给第二个出口
          //（回书架仍在顶栏）。
          <p className="text-muted-foreground flex h-11 items-center text-sm">
            全书完
          </p>
        )}
      </div>
    </div>
  );
}
