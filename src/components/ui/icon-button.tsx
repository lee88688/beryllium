import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * 原型 `.iconbtn`：只有图标的方形触控目标。
 *
 * `aria-pressed="true"` 是「这个视图开着」的唯一表态（原型同理）—— 因此本组件
 * 不提供 variant，按下态由 Tailwind 的 `aria-pressed:` 变体接管。
 */
const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md bg-transparent text-foreground transition-colors outline-none select-none hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary-soft aria-pressed:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      size: {
        sm: "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-[15px]",
        default: "size-[34px]",
        /** 手机上的触控目标：不小于 42px。 */
        touch: "size-[42px]",
      },
    },
    defaultVariants: { size: "default" },
  },
);

function IconButton({
  className,
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof iconButtonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="icon-button"
      className={cn(iconButtonVariants({ size, className }))}
      {...props}
    />
  );
}

export { IconButton, iconButtonVariants };
