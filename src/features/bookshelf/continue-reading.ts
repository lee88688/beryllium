import type { BookshelfBook } from "./types";

/**
 * 「继续阅读」= 最后阅读的那本。`current` 非空表示打开过；`lastReadAt`
 * 决定新旧（0 是迁移前只存了位置的历史数据，此时保持服务端顺序）。
 */
export function pickContinueReading(
  books: readonly BookshelfBook[],
): BookshelfBook | undefined {
  let latest: BookshelfBook | undefined;
  for (const book of books) {
    if (book.current === "") continue;
    if (latest === undefined || book.lastReadAt > latest.lastReadAt) {
      latest = book;
    }
  }
  return latest;
}
