import type { ReaderAnchor } from "./reader-anchor";

/** `Mark.type` values stored server-side. */
export const MARK_TYPE = {
  highlight: "highlight",
  bookmark: "bookmark",
} as const;

export type MarkType = (typeof MARK_TYPE)[keyof typeof MARK_TYPE];

/**
 * Structural mirror of a `Mark` row, with the storage-level anchor already
 * parsed into the format-independent union. Extra server fields are tolerated.
 */
export type ReadingMark = {
  id: number;
  bookId: number;
  type: MarkType | string;
  color: string;
  content: string;
  anchor: ReaderAnchor;
  selectedString: string;
  title: string;
};

/** Payload for creating a mark. */
export type NewReadingMark = Omit<ReadingMark, "id">;

/** Payload for updating an existing mark; the anchor is immutable. */
export type ReadingMarkPatch = { id: number } & Partial<
  Omit<ReadingMark, "id" | "bookId" | "anchor">
>;

/** The CFI of an EPUB mark, or `undefined` for a PDF mark. */
export function markCfi(mark: ReadingMark): string | undefined {
  return mark.anchor.type === "cfi" ? mark.anchor.cfi : undefined;
}

/** The first page of a PDF mark, or `undefined` for an EPUB mark. */
export function markFirstPage(mark: ReadingMark): number | undefined {
  return mark.anchor.type === "pdf" ? mark.anchor.pages[0]?.page : undefined;
}

/** Parses `/reader/$id?mark=` into the id the reader should jump to. */
export function parseMarkSearchParam(value: unknown): { mark?: number } {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? { mark: value } : {};
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const mark = Number(value);
    return Number.isSafeInteger(mark) && mark > 0 ? { mark } : {};
  }
  return {};
}
