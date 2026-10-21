import * as React from "react";
import { cn } from "cn";

/**
 * 原型 `.slider`：3px 轨道 + 主色描边的圆形滑块。
 * 用原生 `input[type=range]`（键盘可达、可访问名字由 `aria-label` 提供）。
 */
function Slider({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="range"
      data-slot="slider"
      className={cn(
        "h-[18px] w-full min-w-0 cursor-pointer appearance-none bg-transparent outline-none disabled:pointer-events-none disabled:opacity-40",
        "[&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-line-strong",
        "[&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:size-[15px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-soft",
        "[&::-moz-range-track]:h-[3px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line-strong",
        "[&::-moz-range-thumb]:size-[15px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    />
  );
}

export { Slider };
