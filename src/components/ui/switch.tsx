import * as React from "react";
import { cn } from "cn";

/** 原型 `.switch`：44×26 的开关，`role="switch"` + `aria-checked`。 */
function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group relative h-[26px] w-11 shrink-0 rounded-full bg-line-strong transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="bg-background shadow-soft absolute top-[3px] left-[3px] size-5 rounded-full transition-transform group-aria-checked:translate-x-[18px]"
      />
    </button>
  );
}

export { Switch };
