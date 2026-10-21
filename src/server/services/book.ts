import { and, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { Book } from "@/server/db/schema";
import type { EpubStorage } from "./file";
import type { TocItem } from "@/server/domain/epub";
import { readBookToc, readSpineSizes, type BookContentSource } from "./epub";

/** Ownership check used before every book-scoped read/write. */
export function userHasBook(
  db: Database,
  userId: number,
  bookId: number,
): boolean {
  return (
    db
      .select({ id: Book.id })
      .from(Book)
      .where(and(eq(Book.userId, userId), eq(Book.id, bookId)))
      .limit(1)
      .get() !== undefined
  );
}

/**
 * Parsed TOC of a book (EPUB3 nav preferred, NCX fallback — PRD D8). `db` is
 * part of the service signature contract; resolving the TOC only touches the
 * ASAR, so it is unused here.
 */
export function getBookToc(
  _db: Database,
  book: BookContentSource,
  storage?: EpubStorage,
): Promise<TocItem[]> {
  return readBookToc(book, storage);
}

/**
 * Sizes of the book's spine members, for the reader payload. Same façade rule
 * as `getBookToc`: `db` is part of the service signature contract; the sizes
 * only touch the ASAR.
 */
export function getBookSpineSizes(
  _db: Database,
  book: BookContentSource,
  storage?: EpubStorage,
): Promise<Record<string, number>> {
  return readSpineSizes(book, storage);
}
