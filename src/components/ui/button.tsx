import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * 原型 `.btn`：34px 高的胶囊按钮，平面 + 1px 发丝线，主操作才上色。
 * `variant`/`size` 的名字与旧版一致，只换外观（调用点不需要改）。
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-line bg-surface-1 bg-clip-padding text-base font-medium whitespace-nowrap transition-[background-color,border-color,transform] outline-none select-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary-button text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary-button)_88%,var(--fg))] disabled:bg-primary-soft disabled:text-muted-foreground disabled:opacity-100",
        outline: "border-line bg-surface-1 hover:bg-hover",
        secondary: "border-transparent bg-surface-2 hover:bg-active",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:brightness-95",
        link: "border-transparent bg-transparent p-0 text-primary underline-offset-4 hover:bg-transparent hover:underline",
      },
      size: {
        default:
          "h-[34px] px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-7 gap-1 px-2.5 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-sm has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-4 text-lg has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-[34px]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
