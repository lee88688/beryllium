import { createRect, type ClientRectLike } from "../geometry";
import type { Rect } from "./types";

/** Returns the range of the current selection, tolerating an empty selection. */
export function getSelectionRange(
  selection: Selection | null | undefined,
): Range | undefined {
  if (!selection || selection.rangeCount === 0) return undefined;
  try {
    return selection.getRangeAt(0) ?? undefined;
  } catch {
    // Chromium throws `IndexSizeError` when the selection has no ranges left
    // between `rangeCount` being read and `getRangeAt` running (PRD §11).
    return undefined;
  }
}

/**
 * The section `<iframe>` that owns `doc`.
 *
 * foliate-js builds its DOM inside two *closed* shadow roots (`view.js:214`,
 * `paginator.js:429`), so no selector can reach the frame from outside — but
 * the section document itself knows its own container.
 */
export function frameForDocument(
  doc: Document | null | undefined,
): HTMLIFrameElement | undefined {
  const frame = doc?.defaultView?.frameElement;
  return frame && frame.localName === "iframe"
    ? (frame as HTMLIFrameElement)
    : undefined;
}

/**
 * Nearest heading text above `node`, mirroring the legacy `getElementHeading`
 * walk (used as the default mark title).
 *
 * The check must not use `instanceof Element`: nodes coming from the epub
 * `<iframe>` belong to a different realm, where the parent's `Element`
 * constructor never matches.
 */
export function getElementHeading(node: Node | null | undefined): string {
  let current: Element | null =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);
  let heading = current?.textContent ?? "";

  while (current && current.tagName.toLowerCase() !== "body") {
    if (/^h[1-6]$/.test(current.tagName.toLowerCase())) {
      heading = current.textContent ?? "";
      break;
    }
    current = current.previousElementSibling ?? current.parentElement;
  }

  return heading;
}

/** Truncated plain text, equivalent to the legacy `lodash/truncate` defaults. */
export function truncateText(
  input: string,
  length = 30,
  omission = "...",
): string {
  const text = input.trim();
  if (text.length <= length) return text;
  return text.slice(0, Math.max(0, length - omission.length)) + omission;
}

/**
 * A client rect measured *inside* a section → host viewport coordinates.
 *
 * `getBoundingClientRect()` in a section answers in that section's own viewport,
 * whose origin is the owning frame's top-left. In paged flow the frame fills the
 * reading area, so the two spaces nearly coincide; in scrolled flow the frame is
 * as tall as the whole section and the paginator scrolls it inside a *closed*
 * shadow container (`paginator.js:511`) — that scroll is only observable through
 * the frame's own rect, so an anchor that skips this step drifts by exactly the
 * scrolled amount.
 */
export function toHostSpace(
  rect: ClientRectLike,
  owner: Document | null | undefined,
): Rect {
  const frameRect = frameForDocument(owner)?.getBoundingClientRect();
  return createRect(
    rect.left + (frameRect?.left ?? 0),
    rect.top + (frameRect?.top ?? 0),
    rect.width,
    rect.height,
  );
}
