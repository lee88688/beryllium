import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import useVirtualKeyboard from "@/hooks/use-virtual-keyboard";

import type { Rect, VirtualAnchor } from "../epub/types";
import { keyboardAnchorRect, toVirtualAnchor } from "../geometry";
import { useViewportSize } from "@/hooks/use-viewport-size";

/** Gap between the anchor and the bubble on precise pointers (mouse/trackpad). */
const ANCHOR_GAP = 8;

/**
 * 触屏上的间距，原因有两条：
 *
 *  1. Android Chrome 的原生选区界面（拖动手柄 + 动作栏）画在网页**上层**，
 *     动作栏就压在选区正上方；浮窗贴着选区会给动作栏让出空间。
 *  2. 手柄本身比选区盒子多出十几像素，浮窗贴着选区时颜色行会被手指挡住。
 *
 * 所以触屏上浮窗改挂在选区**下方**并留出这段间距；手柄在选区两端，动作栏在
 * 上方，颜色行、手柄、动作栏三样都点得到。
 */
const TOUCH_ANCHOR_GAP = 32;

/**
 * 浮窗挂在选区的哪一侧、离多远。
 *
 * 触屏上与桌面的差异都来自**原生选区界面**：手柄画在选区两端、动作栏压在选区
 * 正上方，而且它们都画在网页上层。桌面没有这套界面，浮窗贴着选区上方最紧凑；
 * 触屏则挂到选区下方并让开手柄（见 `TOUCH_ANCHOR_GAP`）。
 */
export function selectionBubblePlacement(coarsePointer: boolean): {
  side: "top" | "bottom";
  gap: number;
} {
  return coarsePointer
    ? { side: "bottom", gap: TOUCH_ANCHOR_GAP }
    : { side: "top", gap: ANCHOR_GAP };
}

/**
 * `pointer: coarse` 覆盖手机/平板，桌面（含 Playwright 的桌面 Chromium）是
 * `fine`。
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)")?.matches === true,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(pointer: coarse)");
    if (!query) return;
    const update = () => setCoarse(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return coarse;
}

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
  side,
  children,
}: SelectionPopoverProps) {
  // 触屏上浮窗挂在选区下方并让开原生选区界面（见 TOUCH_ANCHOR_GAP）。
  const placement = selectionBubblePlacement(useCoarsePointer());
  const resolvedSide = side ?? placement.side;
  const anchorGap = placement.gap;

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
        side={resolvedSide}
        sideOffset={anchorGap}
        collisionAvoidance={{ side: "flip", align: "shift" }}
        collisionBoundary={container ?? undefined}
        positionMethod="absolute"
        // Keep focus inside the section frame: on Android Chrome the native
        // touch-selection UI (the draggable handles and the action-mode toolbar)
        // is hidden as soon as the frame loses focus, so a bubble that grabbed
        // focus would take the only way to adjust the selection with it.
        initialFocus={false}
        finalFocus={false}
        className="w-auto p-2"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
