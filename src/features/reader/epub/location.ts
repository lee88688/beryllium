import * as CFI from "foliate-js/epubcfi.js";
import type { LastLocation } from "foliate-js/view.js";

import type { DisplayedLocation, ReaderLocation } from "./types";

/**
 * Collapses the CFI foliate-js reports into the single point the reader
 * persists.
 *
 * The relocation CFI covers the *visible range* (`view.js:333`), while
 * `Book.current` has always been one position — and both forms survive a round
 * trip through `goTo`. A CFI that somehow cannot be parsed is stored as-is
 * rather than dropped: the reader falls back to the section it points at.
 */
export function toStoredCfi(cfi: string, toEnd = false): string {
  try {
    return CFI.collapse(cfi, toEnd);
  } catch {
    return cfi;
  }
}

/**
 * Normalizes foliate-js' last location into the reader's plain, serialisable
 * shape. `index` is the rendered section, which the location itself does not
 * carry (`View#onRelocate` keeps `fraction`, `location`, `tocItem`, `cfi`).
 */
export function toReaderLocation(
  last: LastLocation | null | undefined,
  index?: number,
): ReaderLocation {
  const start: DisplayedLocation = {};
  const end: DisplayedLocation = {};
  if (!last) return { start, end };

  const href = last.tocItem?.href;
  if (typeof last.cfi === "string") {
    start.cfi = toStoredCfi(last.cfi);
    end.cfi = toStoredCfi(last.cfi, true);
    start.anchor = { type: "cfi", cfi: start.cfi };
    end.anchor = { type: "cfi", cfi: end.cfi };
  }
  if (typeof href === "string") {
    start.href = href;
    end.href = href;
  }
  if (typeof index === "number") {
    start.index = index;
    end.index = index;
  }
  if (typeof last.location?.current === "number") {
    start.location = last.location.current;
  }
  if (typeof last.location?.next === "number") {
    end.location = last.location.next;
  }
  if (typeof last.fraction === "number") {
    start.percentage = last.fraction;
    end.percentage = last.fraction;
  }
  return { start, end };
}
