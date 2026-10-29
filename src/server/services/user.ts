import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import {
  Book,
  Category,
  CategoryBook,
  Mark,
  User,
  type UserSelect,
} from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import { getPasswordHash } from "@/server/domain/password";
import { deleteBookFile, type EpubStorage } from "./file";

export interface CreateUserInput {
  username: string;
  password: string;
  isAdmin?: boolean;
}

export interface ChangePasswordInput {
  newPassword: string;
  confirmPassword: string;
}

/** Creates a user with the sha256 digest the login query compares against. */
export function createUser(db: Database, input: CreateUserInput): UserSelect {
  return db
    .insert(User)
    .values({
      username: input.username,
      password: getPasswordHash(input.password),
      isAdmin: input.isAdmin ?? false,
    })
    .returning()
    .get();
}

export function isAdmin(db: Database, userId: number): boolean {
  const row = db
    .select({ isAdmin: User.isAdmin })
    .from(User)
    .where(eq(User.id, userId))
    .get();
  return row?.isAdmin ?? false;
}

/**
 * The new password is hashed before it reaches the database (the old code
 * stored it in clear text, locking the user out), and the two entered
 * passwords are compared server-side.
 */
export function changePassword(
  db: Database,
  userId: number,
  input: ChangePasswordInput,
): void {
  if (input.newPassword.length < 6) {
    throw new RequestError(
      "BAD_REQUEST",
      "password must be at least 6 characters",
    );
  }
  if (input.newPassword !== input.confirmPassword) {
    throw new RequestError("BAD_REQUEST", "the two passwords do not match");
  }

  const updated = db
    .update(User)
    .set({ password: getPasswordHash(input.newPassword) })
    .where(eq(User.id, userId))
    .run();
  // A deleted user (stale cookie) matches no row; reporting success would tell
  // the caller their password changed when nothing happened (B14).
  if (updated.changes === 0) {
    throw new RequestError("NOT_FOUND", "用户不存在");
  }
}

/**
 * Removes a user and everything hanging off it: category links, categories,
 * marks, books, then the ASAR files (cascades are kept in application code;
 * the FK actions are RESTRICT, so order matters). ASAR deletion happens
 * after the transaction commits, so a filesystem error cannot roll back rows.
 */
export async function deleteUser(
  db: Database,
  id: number,
  storage?: EpubStorage,
): Promise<void> {
  const books = db
    .select({ id: Book.id, fileName: Book.fileName, format: Book.format })
    .from(Book)
    .where(eq(Book.userId, id))
    .all();
  const bookIds = books.map((book) => book.id);
  const categoryIds = db
    .select({ id: Category.id })
    .from(Category)
    .where(eq(Category.userId, id))
    .all()
    .map((category) => category.id);

  db.transaction((tx) => {
    if (categoryIds.length > 0) {
      tx.delete(CategoryBook)
        .where(inArray(CategoryBook.categoryId, categoryIds))
        .run();
    }
    if (bookIds.length > 0) {
      tx.delete(CategoryBook)
        .where(inArray(CategoryBook.bookId, bookIds))
        .run();
      tx.delete(Mark).where(inArray(Mark.bookId, bookIds)).run();
    }
    tx.delete(Category).where(eq(Category.userId, id)).run();
    tx.delete(Mark).where(eq(Mark.userId, id)).run();
    tx.delete(Book).where(eq(Book.userId, id)).run();
    tx.delete(User).where(eq(User.id, id)).run();
  });

  for (const book of books) {
    await deleteBookFile(book, storage);
  }
}
