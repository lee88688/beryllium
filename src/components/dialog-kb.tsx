import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { cn } from "cn";
import useVirtualKeyboard from "../hooks/use-virtual-keyboard";

export type DialogKbProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Dialog that sits above the on-screen keyboard (legacy `dialogKb.tsx`).
 *
 * While the Virtual Keyboard API reports an open keyboard the popup is docked
 * with `position: absolute; bottom: <keyboard height>` inside its nearest
 * positioned ancestor (default: the initial containing block); otherwise it
 * behaves like the regular centered dialog. `boundingRect.height` is unknown
 * on some engines → falls back to `50vh` (same as the legacy implementation).
 */
export function DialogKb({
  open,
  onOpenChange,
  title,
  children,
  className,
}: DialogKbProps) {
  const { isSupported, isKeyboardOpen, boundingRect } = useVirtualKeyboard();
  const docked = isSupported && isKeyboardOpen;
  const bottom = boundingRect?.height ? `${boundingRect.height}px` : "50vh";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="dialog-kb-backdrop"
          className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-50 bg-black/30 duration-100 supports-backdrop-filter:backdrop-blur-xs"
        />
        <DialogPrimitive.Popup
          data-slot="dialog-kb"
          data-docked={docked ? "true" : undefined}
          style={
            docked
              ? {
                  left: "50%",
                  bottom,
                  top: "auto",
                  transform: "translateX(-50%)",
                }
              : undefined
          }
          className={cn(
            "border-line bg-card text-card-foreground shadow-modal z-50 grid w-[calc(100%-2rem)] max-w-sm gap-4 rounded-xl border p-4 text-sm outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            docked
              ? "absolute"
              : "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            {title === undefined ? (
              <span />
            ) : (
              <DialogPrimitive.Title className="font-medium">
                {title}
              </DialogPrimitive.Title>
            )}
            <DialogPrimitive.Close
              render={
                <button
                  type="button"
                  aria-label="关闭"
                  className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex size-6 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-3"
                />
              }
            >
              <XIcon className="size-4" />
              <span className="sr-only">关闭</span>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
