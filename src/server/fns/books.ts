import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { Book, CategoryBook, Mark } from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import type { TocItem } from "@/server/domain/epub";
import { deleteEpubFile } from "@/server/services/file";
import { getBookSpineSizes, getBookToc } from "@/server/services/book";
import { requireSession } from "@/server/session";
import { inputValidator } from "./input";
import { listBooksWithCategories, type BookListItem } from "./queries";
import { bookFilesBaseUrl } from "./urls";

/** What `/reader/{id}` needs before it can render anything. */
export interface ReaderBookInfo {
  id: number;
  title: string;
  current: string;
  /** Member-URL prefix of the book's archive. */
  filesBaseUrl: string;
  /** Spine member path → uncompressed size, drives the section progress. */
  spineSizes: Record<string, number>;
}

export interface ReaderData {
  book: ReaderBookInfo;
  toc: TocItem[];
  highlights: (typeof Mark.$inferSelect)[];
  bookmarks: (typeof Mark.$inferSelect)[];
}

/** Books of the logged-in user, each with its category links. */
export const getBooks = createServerFn({ method: "GET" }).handler(
  async (): Promise<BookListItem[]> => {
    const { user } = await requireSession();
    return listBooksWithCategories(getDb(), user.id);
  },
);

/**
 * Removes a book with everything that references it (marks, category links,
 * then the ASAR file). Ownership is checked before anything is deleted; the
 * `RESTRICT` foreign keys make the delete order explicit.
 */
export const deleteBook = createServerFn({ method: "POST" })
  .validator(inputValidator(z.object({ id: z.number().int() })))
  .handler(async ({ data }) => {
    const { user } = await requireSession();
    const db = getDb();

    const book = db
      .select({ id: Book.id, userId: Book.userId, fileName: Book.fileName })
      .from(Book)
      .where(eq(Book.id, data.id))
      .get();
    if (!book) throw new RequestError("NOT_FOUND", "书籍不存在");
    if (book.userId !== user.id) {
      throw new RequestError("FORBIDDEN", "无法删除他人的书籍");
    }

    db.transaction((tx) => {
      tx.delete(Mark).where(eq(Mark.bookId, book.id)).run();
      tx.delete(CategoryBook).where(eq(CategoryBook.bookId, book.id)).run();
      tx.delete(Book).where(eq(Book.id, book.id)).run();
    });

    await deleteEpubFile(book.fileName);
    return { id: book.id };
  });

const readingProgressSchema = z.object({
  bookId: z.number().int(),
  current: z.string(),
  /** 已读百分比（0–100）；服务端只接受整数，越界直接拒。 */
  percent: z.number().int().min(0).max(100),
});

/** Persists the reading position (the reader throttles calls to ~1/s). */
export const updateBookCurrent = createServerFn({ method: "POST" })
  .validator(inputValidator(readingProgressSchema))
  .handler(async ({ data }) => {
    const { user } = await requireSession();
    const updated = getDb()
      .update(Book)
      .set({
        current: data.current,
        percent: data.percent,
        lastReadAt: Date.now(),
      })
      .where(and(eq(Book.id, data.bookId), eq(Book.userId, user.id)))
      .run();
    if (updated.changes === 0) {
      throw new RequestError("NOT_FOUND", "书籍不存在");
    }
    return { bookId: data.bookId };
  });

/**
 * One round trip for the reader: book basics, TOC (EPUB3 nav preferred, NCX
 * fallback — D8) and both mark lists.
 */
export const getReaderData = createServerFn({ method: "POST" })
  .validator(inputValidator(z.object({ bookId: z.number().int() })))
  .handler(async ({ data }): Promise<ReaderData> => {
    const { user } = await requireSession();
    const db = getDb();

    const book = db
      .select()
      .from(Book)
      .where(and(eq(Book.id, data.bookId), eq(Book.userId, user.id)))
      .get();
    if (!book) throw new RequestError("NOT_FOUND", "书籍不存在");
    const marks = db
      .select()
      .from(Mark)
      .where(and(eq(Mark.bookId, book.id), eq(Mark.userId, user.id)))
      .orderBy(Mark.id)
      .all();

    const [toc, spineSizes] = await Promise.all([
      getBookToc(db, book),
      getBookSpineSizes(db, book),
    ]);

    return {
      book: {
        id: book.id,
        title: book.title,
        current: book.current,
        filesBaseUrl: bookFilesBaseUrl(book.id),
        spineSizes,
      },
      toc,
      highlights: marks.filter((mark) => mark.type === "highlight"),
      bookmarks: marks.filter((mark) => mark.type === "bookmark"),
    };
  });
