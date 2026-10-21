import type { NestedItem } from "@/components/nested-list";

import type { TocNode } from "./epub/types";

/**
 * Maps a parsed TOC into `NestedList` items. The node id is the node's `src`
 * (its href) because that is what `rendition.display()` expects, which also lets
 * the caller highlight the current chapter by comparing with the relocated
 * location (see `resolveCurrentHref`).
 */
export function toNestedItems(nodes: readonly TocNode[]): NestedItem[] {
  return nodes.map((node, index) => {
    const id = node.src || `toc-${index}`;
    const label = node.label || id;
    const children =
      node.children && node.children.length > 0
        ? toNestedItems(node.children)
        : undefined;
    return children ? { id, label, children } : { id, label };
  });
}

/** The relocated location, reduced to what the TOC highlight needs. */
export type LocatedRange = {
  /** `relocated.start.href`: the *first* section the visible page shows. */
  startHref: string;
  /** `relocated.end.href`: the *last* section the visible page shows. */
  endHref?: string;
};

/**
 * The TOC entry to highlight for a relocated location (D4).
 *
 * `relocated.start.href` is the TOC entry foliate-js maps the visible range to,
 * which is the deepest entry whose destination is on screen. The entry the
 * reader picked (`target`) wins as long as the location still reports one of
 * its sections — a jump to a nested entry keeps that entry highlighted even
 * when the library reports the parent — and page turns and mark jumps clear
 * `target` first, falling the highlight back onto the reported entry.
 */
export function resolveCurrentHref(
  located: LocatedRange,
  target?: string,
): string {
  if (!target) return located.startHref;
  const visible = target === located.startHref || target === located.endHref;
  return visible ? target : located.startHref;
}
