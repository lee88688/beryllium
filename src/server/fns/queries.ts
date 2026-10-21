import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { Book, Category, CategoryBook } from "@/server/db/schema";
import { bookFileUrl } from "./urls";

/** One row of the bookshelf: `Book` plus the categories it belongs to. */
export interface BookListItem {
  id: number;
  title: string;
  author: string;
  description: string;
  cover: string;
  /** `Book.cover` through the file route; `""` when the book has no cover. */
  coverUrl: string;
  fileName: string;
  contentPath: string;
  current: string;
  /** 已读百分比 0–100。 */
  percent: number;
  /** 最后一次阅读的毫秒时间戳；0 = 没读过。 */
  lastReadAt: number;
  categories: { id: number; name: string }[];
}

/**
 * All books of one user with their category links. Two queries plus an
 * in-memory join: the bookshelf renders every row anyway, and one flat join
 * would duplicate the book payload per category.
 */
export function listBooksWithCategories(
  db: Database,
  userId: number,
): BookListItem[] {
  const books = db
    .select({
      id: Book.id,
      title: Book.title,
      author: Book.author,
      description: Book.description,
      cover: Book.cover,
      fileName: Book.fileName,
      contentPath: Book.contentPath,
      current: Book.current,
      percent: Book.percent,
      lastReadAt: Book.lastReadAt,
    })
    .from(Book)
    .where(eq(Book.userId, userId))
    .orderBy(Book.id)
    .all();

  const links = db
    .select({
      bookId: CategoryBook.bookId,
      id: Category.id,
      name: Category.name,
    })
    .from(CategoryBook)
    .innerJoin(Category, eq(CategoryBook.categoryId, Category.id))
    .where(eq(Category.userId, userId))
    .all();

  return books.map((book) => ({
    ...book,
    coverUrl: book.cover === "" ? "" : bookFileUrl(book.id, book.cover),
    categories: links
      .filter((link) => link.bookId === book.id)
      .map((link) => ({ id: link.id, name: link.name })),
  }));
}
