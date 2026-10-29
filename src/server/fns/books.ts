import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { parseStoredAnchor } from "@/lib/reader-anchor";
import { isPdfPackage } from "@/lib/book-content";
import type { ReadingMark } from "@/lib/reader-mark";
import {
  PDF_MAX_OUTLINE_DEPTH,
  PDF_MAX_OUTLINE_NODES,
  type PdfTocItem,
} from "@/lib/pdf-package";
import { getDb } from "@/server/db/client";
import { Book, CategoryBook, Mark } from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import type { EpubPackage, TocItem } from "@/server/domain/epub";
import { deleteBookFile } from "@/server/services/file";
import { getBookSpineSizes, getBookToc } from "@/server/services/book";
import { requireSession } from "@/server/session";
import { inputValidator } from "./input";
import { listBooksWithCategories, type BookListItem } from "./queries";
import { bookFilesBaseUrl } from "./urls";

/** What `/reader/{id}` needs before it can render anything. */
export interface ReaderBookInfo {
  id: number;
  title: string;
  format: "epub" | "pdf";
  current: string;
  /** Member-URL prefix of the book's archive (EPUB). */
  filesBaseUrl: string;
  /** Spine member path → uncompressed size, drives the section progress. */
  spineSizes: Record<string, number>;
  /** Total pages for PDF; `null` while the upload-time parse was skipped. */
  pageCount: number | null;
}

export interface ReaderData {
  book: ReaderBookInfo;
  toc: TocItem[];
  highlights: ReadingMark[];
  bookmarks: ReadingMark[];
}

function pdfTocToItems(
  items: readonly PdfTocItem[],
  depth = 0,
  budget = { nodes: 0 },
): TocItem[] {
  if (depth > PDF_MAX_OUTLINE_DEPTH) return [];
  const result: TocItem[] = [];
  for (const item of items) {
    if (budget.nodes >= PDF_MAX_OUTLINE_NODES) break;
    budget.nodes += 1;
    const children = item.children?.length
      ? pdfTocToItems(item.children, depth + 1, budget)
      : [];
    result.push({
      label: item.label,
      src: `page:${item.page}`,
      ...(children.length > 0 ? { children } : {}),
    });
  }
  return result;
}

/** Turn a stored `Mark` row into the structured mark the reader renders. */
function toReadingMark(row: typeof Mark.$inferSelect): ReadingMark | undefined {
  const anchor = parseStoredAnchor(row.anchorType, row.anchor);
  if (!anchor) {
    console.warn(
      `[getReaderData] dropping mark ${row.id}: invalid ${row.anchorType} anchor`,
    );
    return undefined;
  }
  return {
    id: row.id,
    bookId: row.bookId,
    type: row.type,
    color: row.color,
    content: row.content,
    anchor,
    selectedString: row.selectedString,
    title: row.title,
  };
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
      .select({
        id: Book.id,
        userId: Book.userId,
        fileName: Book.fileName,
        format: Book.format,
      })
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

    await deleteBookFile(book);
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
      .all()
      .flatMap((mark) => {
        const mapped = toReadingMark(mark);
        return mapped ? [mapped] : [];
      });

    if (isPdfPackage(book.content)) {
      return {
        book: {
          id: book.id,
          title: book.title,
          format: "pdf",
          current: book.current,
          filesBaseUrl: "",
          spineSizes: {},
          pageCount: book.content.pageCount,
        },
        toc: book.content.outline ? pdfTocToItems(book.content.outline) : [],
        highlights: marks.filter((mark) => mark.type === "highlight"),
        bookmarks: marks.filter((mark) => mark.type === "bookmark"),
      };
    }

    const epubBook = {
      ...book,
      content: book.content as EpubPackage,
    };
    const [toc, spineSizes] = await Promise.all([
      getBookToc(db, epubBook),
      getBookSpineSizes(db, epubBook),
    ]);

    return {
      book: {
        id: book.id,
        title: book.title,
        format: "epub",
        current: book.current,
        filesBaseUrl: bookFilesBaseUrl(book.id),
        spineSizes,
        pageCount: null,
      },
      toc,
      highlights: marks.filter((mark) => mark.type === "highlight"),
      bookmarks: marks.filter((mark) => mark.type === "bookmark"),
    };
  });
