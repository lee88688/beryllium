import * as React from "react";
import { cn } from "cn";

/**
 * 原型 `.seg`：胶囊分段控件（明暗 / 字体 / 版式 / 排序都用它）。
 *
 * 语义是「一组互斥选项里的当前项」，用 `aria-pressed` 表达当前项 —— 与原型
 * 一致，也比隐藏的 radio 更直接。
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** 只读展示（例如当前项不可再点）。 */
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onValueChange: (value: T) => void;
  "aria-label": string;
  className?: string;
}

function Segmented<T extends string>({
  value,
  options,
  onValueChange,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-hover p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onValueChange(option.value)}
          className="text-muted-foreground hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-soft h-[26px] rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { Segmented };
