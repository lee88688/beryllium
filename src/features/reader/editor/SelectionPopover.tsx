import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import useVirtualKeyboard from "@/hooks/use-virtual-keyboard";

import type { Rect, VirtualAnchor } from "../epub/types";
import { keyboardAnchorRect, toVirtualAnchor } from "../geometry";
import { useViewportSize } from "@/hooks/use-viewport-size";

/** Gap between the anchor and the bubble. */
const ANCHOR_GAP = 8;

export type SelectionPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Anchor geometry in parent-document coordinates. */
  rect: Rect | undefined;
  /** Re-measures the anchor (iframe scroll, container scroll, resize). */
  measure?: (() => Rect | undefined) | undefined;
  /** Epub `<iframe>` that owns the anchor, when it lives inside a section. */
  frame?: HTMLIFrameElement | undefined;
  /** Portal container and collision boundary (the reader content area). */
  container?: HTMLElement | null;
  side?: "top" | "bottom";
  children: React.ReactNode;
};

/**
 * Anchored bubble for text selections and clicked highlights.
 *
 * Base UI positions against a *virtual* anchor, which is a snapshot: it neither
 * tracks layout shifts nor reacts to scrolling, so the rect is re-measured on
 * window/iframe scroll and on resize. Page flips are handled by the caller,
 * which re-measures and hands down a fresh `rect` (docs: "iframe scroll /
 * relocated 重算"). While the virtual keyboard overlays the viewport the anchor
 * is replaced by a synthetic rect sitting just above the keyboard.
 */
export function SelectionPopover({
  open,
  onOpenChange,
  rect,
  measure,
  frame,
  container,
  side = "top",
  children,
}: SelectionPopoverProps) {
  // `base` is the prop the measurement came from: when the caller publishes a
  // new rect the derived value switches to it, otherwise the re-measured value
  // (produced by scrolling) wins.
  const [measured, setMeasured] = useState<{
    base: Rect | undefined;
    value: Rect | undefined;
  }>({ base: rect, value: rect });
  const current = measured.base === rect ? measured.value : rect;

  const measureRef = useRef(measure);
  const rectRef = useRef(rect);
  useEffect(() => {
    measureRef.current = measure;
    rectRef.current = rect;
  }, [measure, rect]);

  const remeasure = useCallback(() => {
    const next = measureRef.current?.();
    if (next) setMeasured({ base: rectRef.current, value: next });
  }, []);

  useEffect(() => {
    if (!open) return;
    const frameWindow = frame?.contentWindow ?? undefined;
    // `capture` also catches scrolls of inner elements (the rendition
    // container, the sections) which do not bubble.
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    frameWindow?.addEventListener("scroll", remeasure, true);

    return () => {
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
      frameWindow?.removeEventListener("scroll", remeasure, true);
    };
  }, [open, frame, remeasure]);

  const { isKeyboardOpen, boundingRect } = useVirtualKeyboard();
  const viewport = useViewportSize();

  const anchor: VirtualAnchor | undefined = useMemo(
    () =>
      toVirtualAnchor(
        isKeyboardOpen
          ? keyboardAnchorRect({
              viewportWidth: viewport.width,
              viewportHeight: viewport.height,
              keyboardHeight: boundingRect?.height ?? 0,
              anchorHeight: current?.height ?? 0,
            })
          : current,
      ),
    [current, isKeyboardOpen, viewport.width, viewport.height, boundingRect],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchor}
        container={container ?? undefined}
        side={side}
        sideOffset={ANCHOR_GAP}
        collisionAvoidance={{ side: "flip", align: "shift" }}
        collisionBoundary={container ?? undefined}
        positionMethod="absolute"
        className="w-auto p-2"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
