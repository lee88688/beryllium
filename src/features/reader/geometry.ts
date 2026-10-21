import type { Rect, VirtualAnchor } from "./epub/types";

/** Minimal structural stand-in so the maths stays DOM-free and testable. */
export type ClientRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function createRect(
  x: number,
  y: number,
  width: number,
  height: number,
): Rect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
  };
}

/** `DOMRect`/`DOMRectReadOnly` → `Rect` (works for jsdom's zero rects too). */
export function rectFromClientRect(rect: ClientRectLike): Rect {
  return createRect(rect.left, rect.top, rect.width, rect.height);
}

export type KeyboardAnchorInput = {
  viewportWidth: number;
  viewportHeight: number;
  /** Height of the virtual keyboard overlay. */
  keyboardHeight: number;
  /** Height of the originally measured anchor, used to keep the gap consistent. */
  anchorHeight?: number;
};

/**
 * Synthesized anchor used while the virtual keyboard is open: a zero-width
 * point at the horizontal centre of the viewport, sitting exactly on top of the
 * keyboard (mirrors the old MUI Popper behaviour).
 */
export function keyboardAnchorRect({
  viewportWidth,
  viewportHeight,
  keyboardHeight,
  anchorHeight = 0,
}: KeyboardAnchorInput): Rect {
  const height = Math.max(0, anchorHeight);
  const keyboard = Math.max(0, keyboardHeight);
  return createRect(
    viewportWidth / 2,
    Math.max(0, viewportHeight - keyboard - height),
    0,
    height,
  );
}

/**
 * Wrap a rect as a Base UI "virtual element". Base UI caches virtual anchors,
 * so callers must build a fresh anchor for every measurement.
 */
export function toVirtualAnchor(
  rect: Rect | undefined,
): VirtualAnchor | undefined {
  if (!rect) return undefined;
  return { getBoundingClientRect: () => rect };
}
