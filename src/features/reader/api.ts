import type {
  NewReadingMark,
  ReadingMark,
  ReadingMarkPatch,
  TocNode,
} from "./epub/types";

/** Book fields the reader needs (subset of a `Book` row). */
export type ReaderBook = {
  id: number;
  title: string;
  /** Saved CFI of the reading position (`""` when the book was never opened). */
  current: string;
  /** Member-URL prefix of the book's archive, e.g. `/api/books/1/files/`. */
  filesBaseUrl: string;
  /** Spine member path → byte size, used for section progress. */
  spineSizes: Record<string, number>;
};

/** Everything `/reader/{id}` needs, injected by the route (W4). */
export type ReaderData = {
  book: ReaderBook;
  toc: TocNode[];
  highlights: ReadingMark[];
  bookmarks: ReadingMark[];
};

/**
 * Bridge to the server functions. The reader never imports them directly, so it
 * can run in tests with a stub and W4 keeps ownership of the wiring:
 *
 * ```ts
 * const api: ReaderApi = {
 *   addMark: (mark) => addMark({ data: mark }),
 *   updateMark: (mark) => updateMark({ data: mark }),
 *   removeMark: (id) => removeMark({ data: { id } }),
 *   updateBookCurrent: (bookId, current, percent) =>
 *     updateBookCurrent({ data: { bookId, current, percent } }),
 * };
 * ```
 */
export interface ReaderApi {
  /** Persists a new mark; the reader only needs the assigned id back. */
  addMark(mark: NewReadingMark): Promise<{ id: number }>;
  updateMark(mark: ReadingMarkPatch): Promise<void>;
  removeMark(id: number): Promise<void>;
  /** Progress report, already throttled to one write per second. */
  /** 阅读位置 + 已读百分比（0–100），一次请求写完。 */
  updateBookCurrent(
    bookId: number,
    current: string,
    percent: number,
  ): Promise<void>;
}

/** Message for the error toast; server `RequestError`s already carry one. */
export function readerErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "操作失败，请重试";
}
