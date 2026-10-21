import * as React from "react";
import { cn } from "cn";

/** 原型 `kbd`：键位提示（设置页的快捷键表、阅读器的快捷键说明）。 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-surface-1 px-1.5 font-mono text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
