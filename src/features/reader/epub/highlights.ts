import { Overlayer } from "foliate-js/overlayer.js";
import type { View } from "foliate-js/view.js";

import { markCfi } from "@/lib/reader-mark";
import { getMarkColorValue } from "@/components/color-radio";

import type { ReadingMark } from "./types";

/**
 * Highlights as foliate-js overlays (the replacement for epubjs' private
 * `annotations._annotations` store, which was the D13 liability).
 *
 * One annotation per mark, keyed by its stored CFI:
 *
 * - foliate-js resolves the CFI to a `Range` in the right section by itself
 *   (`epub.js:688` — it even works around the wrong id assertions epub.js used
 *   to write), so nothing here knows about spine positions.
 * - The overlay only exists while its section is rendered, so marks are
 *   re-annotated whenever a section is created (`create-overlay`).
 * - The drawn `<g>` keeps the attributes the reader's contract had before
 *   (`data-epubcfi`, `data-color`, `fill`), which is what the e2e suite and the
 *   editor rely on.
 */

/** Annotation payload handed to `view.addAnnotation`. */
type HighlightAnnotation = {
  value: string;
  color: string;
  id: number;
};

export type HighlightsController = {
  /** Index marks so click payloads resolve back to a full row. */
  remember(marks: readonly ReadingMark[]): void;
  add(mark: ReadingMark): void;
  remove(cfiRange: string): void;
  update(mark: ReadingMark): void;
  /** Re-draws every remembered mark of a freshly rendered section. */
  renderSection(index: number): void;
  findElement(cfiRange: string): Element | undefined;
  markForClick(
    cfiRange: string,
    markId?: number | string,
  ): ReadingMark | undefined;
  clear(): void;
  dispose(): void;
};

function drawHighlight(
  rects: DOMRectList | DOMRect[],
  annotation: { value: string; color?: unknown },
): SVGGElement {
  const color = typeof annotation.color === "string" ? annotation.color : "";
  const fill = getMarkColorValue(color) ?? (color === "" ? "red" : color);
  const group = Overlayer.highlight(rects, { color: fill });
  group.dataset.epubcfi = annotation.value;
  group.dataset.color = color;
  group.setAttribute("fill", fill);
  return group;
}

export function createHighlights({
  view,
}: {
  view: View;
}): HighlightsController {
  const byCfi = new Map<string, ReadingMark>();
  const byId = new Map<string, ReadingMark>();
  /** Section index → CFIs drawn in it, rebuilt on every `remember`. */
  const byIndex = new Map<number, Set<string>>();
  const elements = new Map<string, Element>();

  const indexOf = (cfiRange: string): number | undefined => {
    try {
      return view.resolveCFI(cfiRange)?.index;
    } catch {
      // A malformed or stale CFI simply has no section; the mark stays
      // clickable through `markForClick` but is never drawn.
      return undefined;
    }
  };

  const annotate = (mark: ReadingMark) => {
    const cfi = markCfi(mark);
    if (!cfi) return;
    const annotation: HighlightAnnotation = {
      value: cfi,
      color: mark.color,
      id: mark.id,
    };
    void view.addAnnotation(annotation).catch((error: unknown) => {
      console.warn(`[reader] highlight not drawn: ${cfi}`, error);
    });
  };

  const handleDrawAnnotation = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        annotation: HighlightAnnotation;
        draw: (
          draw: (rects: DOMRectList) => Element,
          options?: Record<string, unknown>,
        ) => void;
      }>
    ).detail;
    const { annotation } = detail;
    let drawn: Element | undefined;
    detail.draw((rects) => {
      drawn = drawHighlight(rects, annotation);
      return drawn;
    });
    if (drawn) elements.set(annotation.value, drawn);
  };
  view.addEventListener("draw-annotation", handleDrawAnnotation);

  return {
    remember(marks) {
      for (const mark of marks) {
        const cfi = markCfi(mark);
        if (!cfi) continue;
        const previous = byId.get(String(mark.id));
        const previousCfi = previous ? markCfi(previous) : undefined;
        if (previous && previousCfi !== cfi) {
          // A mark that moved keeps exactly one entry: the index must not
          // resolve an id or a cfi to a stale row.
          if (previousCfi) {
            byCfi.delete(previousCfi);
            elements.delete(previousCfi);
          }
        }
        byCfi.set(cfi, mark);
        byId.set(String(mark.id), mark);
        const index = indexOf(cfi);
        if (index === undefined) continue;
        const bucket = byIndex.get(index);
        if (bucket) bucket.add(cfi);
        else byIndex.set(index, new Set([cfi]));
      }
    },

    add(mark) {
      this.remember([mark]);
      annotate(mark);
    },

    remove(cfiRange) {
      void view.deleteAnnotation({ value: cfiRange }).catch(() => {});
      const mark = byCfi.get(cfiRange);
      byCfi.delete(cfiRange);
      elements.delete(cfiRange);
      if (mark) byId.delete(String(mark.id));
      const index = indexOf(cfiRange);
      if (index !== undefined) byIndex.get(index)?.delete(cfiRange);
    },

    update(mark) {
      // A3: the index is what a later click reads, so the edited row must be
      // merged back — otherwise reopening the editor shows the values from
      // before the edit and 确定 writes those stale values back.
      this.remember([mark]);
      // `addAnnotation` drops the previous overlay for the same CFI first, so
      // re-annotating is the redraw.
      annotate(mark);
    },

    renderSection(index) {
      const bucket = byIndex.get(index);
      if (!bucket) return;
      for (const cfiRange of bucket) elements.delete(cfiRange);
      for (const cfiRange of bucket) {
        const mark = byCfi.get(cfiRange);
        if (mark) annotate(mark);
      }
    },

    findElement(cfiRange) {
      return elements.get(cfiRange);
    },

    markForClick(cfiRange, markId) {
      const byIdentifier =
        markId === undefined ? undefined : byId.get(String(markId));

      // Intentional fallback: when foliate-js reports a click for a mark whose
      // id is unknown to us (e.g. the overlay survived a refetch that
      // renumbered the row), still resolve it by CFI so the editor opens on the
      // right mark instead of silently doing nothing.
      return byIdentifier ?? byCfi.get(cfiRange);
    },

    clear() {
      byCfi.clear();
      byId.clear();
      byIndex.clear();
      elements.clear();
    },

    dispose() {
      view.removeEventListener("draw-annotation", handleDrawAnnotation);
      this.clear();
    },
  };
}
