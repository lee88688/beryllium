import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { Book, Category, CategoryBook } from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import { requireSession } from "@/server/session";
import { inputValidator } from "./input";
import { listBooksWithCategories, type BookListItem } from "./queries";

/** A category with the books linked to it. */
export interface CategoryWithBooks {
  id: number;
  name: string;
  books: BookListItem[];
}

/** Categories of the logged-in user with their books; empty ones included. */
export const getCategories = createServerFn({ method: "GET" }).handler(
  async (): Promise<CategoryWithBooks[]> => {
    const { user } = await requireSession();
    const db = getDb();

    const categories = db
      .select({ id: Category.id, name: Category.name })
      .from(Category)
      .where(eq(Category.userId, user.id))
      .orderBy(Category.id)
      .all();
    const books = listBooksWithCategories(db, user.id);

    return categories.map((category) => ({
      ...category,
      books: books.filter((book) =>
        book.categories.some((link) => link.id === category.id),
      ),
    }));
  },
);

/** Creates a category; a duplicate name for the same user is a `BAD_REQUEST`. */
export const createCategory = createServerFn({ method: "POST" })
  .validator(inputValidator(z.object({ name: z.string().trim().min(1) })))
  .handler(async ({ data }) => {
    const { user } = await requireSession();
    const db = getDb();

    const existing = db
      .select({ id: Category.id })
      .from(Category)
      .where(and(eq(Category.userId, user.id), eq(Category.name, data.name)))
      .get();
    if (existing) {
      throw new RequestError("BAD_REQUEST", `分类 ${data.name} 已存在`);
    }

    return db
      .insert(Category)
      .values({ name: data.name, userId: user.id })
      .returning()
      .get();
  });

/** Deletes a category and its links (the books themselves stay). */
export const removeCategory = createServerFn({ method: "POST" })
  .validator(inputValidator(z.object({ id: z.number().int() })))
  .handler(async ({ data }) => {
    const { user } = await requireSession();
    const db = getDb();

    const category = db
      .select({ id: Category.id })
      .from(Category)
      .where(and(eq(Category.id, data.id), eq(Category.userId, user.id)))
      .get();
    if (!category) throw new RequestError("NOT_FOUND", "分类不存在");

    db.transaction((tx) => {
      tx.delete(CategoryBook)
        .where(eq(CategoryBook.categoryId, category.id))
        .run();
      tx.delete(Category).where(eq(Category.id, category.id)).run();
    });

    return { id: category.id };
  });

const categoryBooksSchema = z.object({
  categoryId: z.number().int(),
  bookIds: z.array(z.number().int()).min(1),
});

/**
 * Links books to a category. Idempotent (D9): pairs that already exist are
 * skipped instead of tripping the `(bookId, categoryId)` unique index, and
 * every id is checked against the caller before anything is written.
 */
export const addBooksToCategory = createServerFn({ method: "POST" })
  .validator(inputValidator(categoryBooksSchema))
  .handler(async ({ data }) => {
    const { user } = await requireSession();
    const db = getDb();

    const category = db
      .select({ id: Category.id })
      .from(Category)
      .where(
        and(eq(Category.id, data.categoryId), eq(Category.userId, user.id)),
      )
      .get();
    if (!category) throw new RequestError("NOT_FOUND", "分类不存在");

    const ownedBookIds = db
      .select({ id: Book.id })
      .from(Book)
      .where(and(eq(Book.userId, user.id), inArray(Book.id, data.bookIds)))
      .all()
      .map((book) => book.id);
    if (ownedBookIds.length !== new Set(data.bookIds).size) {
      throw new RequestError("FORBIDDEN", "只能加入自己的书籍");
    }

    const linked = db
      .select({ bookId: CategoryBook.bookId })
      .from(CategoryBook)
      .where(eq(CategoryBook.categoryId, category.id))
      .all()
      .map((link) => link.bookId);
    const missing = ownedBookIds.filter((id) => !linked.includes(id));

    if (missing.length > 0) {
      db.insert(CategoryBook)
        .values(missing.map((bookId) => ({ bookId, categoryId: category.id })))
        .run();
    }

    return { added: missing.length };
  });

/** Unlinks books from a category; unknown pairs are simply not there. */
export const removeBooksFromCategory = createServerFn({ method: "POST" })
  .validator(inputValidator(categoryBooksSchema))
  .handler(async ({ data }) => {
    const { user } = await requireSession();
    const db = getDb();

    const category = db
      .select({ id: Category.id })
      .from(Category)
      .where(
        and(eq(Category.id, data.categoryId), eq(Category.userId, user.id)),
      )
      .get();
    if (!category) throw new RequestError("NOT_FOUND", "分类不存在");

    const removed = db
      .delete(CategoryBook)
      .where(
        and(
          eq(CategoryBook.categoryId, category.id),
          inArray(CategoryBook.bookId, data.bookIds),
        ),
      )
      .run();

    return { removed: removed.changes };
  });
