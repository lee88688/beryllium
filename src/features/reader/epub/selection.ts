import type { Overlayer } from "foliate-js/overlayer.js";

import { frameForDocument, toHostSpace } from "./dom";
import type { Rect } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Key of the throwaway overlay entry used to anchor the selection popover. */
const PROBE_KEY = "bery-selection";

/**
 * Anchors a selection to the screen position the *highlighter* would use.
 *
 * foliate-js positions its overlay element itself: the paginator scrolls a
 * container and keeps the overlay in the same coordinate space as a section's
 * client rects. Deriving parent-document coordinates by hand would have to
 * re-implement that private maths, so the selection is instead drawn as an
 * invisible box through the same `overlayer.add` a highlight goes through —
 * the drawn element's own client rect *is* the answer, and it stays correct
 * across page turns because the renderer redraws the overlay.
 *
 * Returns a re-measure function; `undefined` once the overlay is gone.
 */
export function addSelectionProbe(
  overlayer: Overlayer,
  range: Range,
): () => Rect | undefined {
  let drawn: Element | undefined;

  overlayer.add(PROBE_KEY, range, (rects) => {
    // The box unions every client rect of the selection with the range's own
    // bounding rect: multi-line selections need all of them, and the bounding
    // rect covers the engine quirk of an empty `getClientRects()`.
    const boxes = [range.getBoundingClientRect(), ...rects];
    const left = Math.min(...boxes.map((rect) => rect.left));
    const top = Math.min(...boxes.map((rect) => rect.top));
    const right = Math.max(...boxes.map((rect) => rect.right));
    const bottom = Math.max(...boxes.map((rect) => rect.bottom));

    const group = document.createElementNS(SVG_NS, "g");
    const box = document.createElementNS(SVG_NS, "rect");
    box.setAttribute("x", String(left));
    box.setAttribute("y", String(top));
    box.setAttribute("width", String(Math.max(0, right - left)));
    box.setAttribute("height", String(Math.max(0, bottom - top)));
    box.setAttribute("fill", "none");
    box.setAttribute("stroke", "none");
    group.append(box);
    drawn = group;
    return group;
  });

  return () =>
    drawn?.isConnected
      ? toHostSpace(drawn.getBoundingClientRect(), drawn.ownerDocument)
      : undefined;
}

/** Removes the probe; the popover calls this when the selection ends. */
export function removeSelectionProbe(overlayer: Overlayer): void {
  overlayer.remove(PROBE_KEY);
}

/**
 * Selection geometry for one section: the anchor rect (through the probe when
 * an overlay is available), a re-measure function, and the owning frame.
 */
export function describeSelection(
  range: Range,
  overlayer: Overlayer | undefined,
): {
  rect: Rect | undefined;
  measure: () => Rect | undefined;
  frame: HTMLIFrameElement | undefined;
} {
  const frame = frameForDocument(range.startContainer.ownerDocument ?? null);
  if (!overlayer) {
    const doc = range.startContainer.ownerDocument;
    const measure = () => toHostSpace(range.getBoundingClientRect(), doc);
    return { rect: measure(), measure, frame };
  }
  const measure = addSelectionProbe(overlayer, range);
  return { rect: measure(), measure, frame };
}
