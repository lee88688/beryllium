import { getElementHeading, truncateText } from "./dom";

export type LocationDescription = {
  /** Nearest heading above the CFI, used as the default bookmark title. */
  heading: string;
  /** Truncated text at the CFI, mirrors the legacy `truncate(textContent)`. */
  selectedString: string;
};

/** Resolves a CFI to a `Range`; the adapter implements it spine-aware (D5). */
export type CfiRangeResolver = (cfi: string) => Range | undefined;

/**
 * Best-effort heading + snippet for a bookmark, empty strings when unknown.
 *
 * The range comes from the adapter's `getRange`, which selects the section by
 * the CFI's spine position. Resolving the CFI here — `new EpubCFI(cfi)
 * .toRange(doc)` over every rendered frame — would return the *first* frame
 * whose document happens to accept the path, so a bookmark taken in chapter
 * two was titled with chapter one's heading (D5).
 */
export function describeCfi(
  cfi: string,
  resolveRange: CfiRangeResolver,
): LocationDescription {
  const range = resolveRange(cfi);
  if (!range) return { heading: "", selectedString: "" };
  return {
    heading: getElementHeading(range.startContainer),
    selectedString: truncateText(range.startContainer.textContent ?? ""),
  };
}
