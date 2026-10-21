import { defineRelations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { EpubPackage } from "../domain/epub";

/**
 * SQLite schema, keeping the legacy Prisma shape: PascalCase tables, camelCase
 * columns, `INTEGER PRIMARY KEY AUTOINCREMENT` ids, and application-supplied
 * defaults (every column is NOT NULL and no DEFAULT clause — the services write
 * every value, exactly like the Prisma client did).
 */
export const User = sqliteTable(
  "User",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    password: text("password").notNull(),
    isAdmin: integer("isAdmin", { mode: "boolean" }).notNull(),
  },
  (table) => [uniqueIndex("User_username_key").on(table.username)],
);

export const Book = sqliteTable("Book", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  author: text("author").notNull(),
  description: text("description").notNull(),
  cover: text("cover").notNull(),
  fileName: text("fileName").notNull(),
  contentPath: text("contentPath").notNull(),
  current: text("current").notNull(),
  /** 已读百分比 0–100（书架展示用，阅读器在写阅读位置时一起写）。 */
  percent: integer("percent").notNull().default(0),
  /** 最后一次阅读的毫秒时间戳；0 = 还没读过（书架「最近阅读」排序用）。 */
  lastReadAt: integer("lastReadAt").notNull().default(0),
  content: text("content", { mode: "json" }).$type<EpubPackage>().notNull(),
  userId: integer("userId")
    .notNull()
    .references(() => User.id, { onDelete: "restrict", onUpdate: "cascade" }),
});

export const Mark = sqliteTable("Mark", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** `bookmark` | `highlight` (`MarkType`). */
  type: text("type").notNull(),
  epubcfi: text("epubcfi").notNull(),
  color: text("color").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  selectedString: text("selectedString").notNull(),
  bookId: integer("bookId")
    .notNull()
    .references(() => Book.id, { onDelete: "restrict", onUpdate: "cascade" }),
  userId: integer("userId")
    .notNull()
    .references(() => User.id, { onDelete: "restrict", onUpdate: "cascade" }),
});

export const Category = sqliteTable("Category", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  userId: integer("userId")
    .notNull()
    .references(() => User.id, { onDelete: "restrict", onUpdate: "cascade" }),
});

export const CategoryBook = sqliteTable(
  "CategoryBook",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("bookId")
      .notNull()
      .references(() => Book.id, { onDelete: "restrict", onUpdate: "cascade" }),
    categoryId: integer("categoryId")
      .notNull()
      .references(() => Category.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  // PRD D9: the junction table had no uniqueness at all, so a book could be
  // added to the same category twice.
  (table) => [
    uniqueIndex("CategoryBook_bookId_categoryId_key").on(
      table.bookId,
      table.categoryId,
    ),
  ],
);

/** Every table in one object: what `defineRelations` and consumers iterate. */
export const schema = { User, Book, Mark, Category, CategoryBook };

/**
 * Relational query config (Drizzle v1: `defineRelations` + `drizzle(client, { relations })`).
 * Relations are declared explicitly with `from`/`to` so multi-FK tables such as
 * `Mark` (bookId + userId) cannot be inferred wrongly.
 */
export const relations = defineRelations(schema, (r) => ({
  User: {
    books: r.many.Book({ from: r.User.id, to: r.Book.userId }),
    marks: r.many.Mark({ from: r.User.id, to: r.Mark.userId }),
    categories: r.many.Category({ from: r.User.id, to: r.Category.userId }),
  },
  Book: {
    user: r.one.User({ from: r.Book.userId, to: r.User.id }),
    marks: r.many.Mark({ from: r.Book.id, to: r.Mark.bookId }),
    categoryBooks: r.many.CategoryBook({
      from: r.Book.id,
      to: r.CategoryBook.bookId,
    }),
  },
  Mark: {
    book: r.one.Book({ from: r.Mark.bookId, to: r.Book.id }),
    user: r.one.User({ from: r.Mark.userId, to: r.User.id }),
  },
  Category: {
    user: r.one.User({ from: r.Category.userId, to: r.User.id }),
    categoryBooks: r.many.CategoryBook({
      from: r.Category.id,
      to: r.CategoryBook.categoryId,
    }),
  },
  CategoryBook: {
    book: r.one.Book({ from: r.CategoryBook.bookId, to: r.Book.id }),
    category: r.one.Category({
      from: r.CategoryBook.categoryId,
      to: r.Category.id,
    }),
  },
}));

export type UserSelect = typeof User.$inferSelect;
export type UserInsert = typeof User.$inferInsert;
export type BookSelect = typeof Book.$inferSelect;
export type BookInsert = typeof Book.$inferInsert;
export type MarkSelect = typeof Mark.$inferSelect;
export type MarkInsert = typeof Mark.$inferInsert;
export type CategorySelect = typeof Category.$inferSelect;
export type CategoryInsert = typeof Category.$inferInsert;
export type CategoryBookSelect = typeof CategoryBook.$inferSelect;
export type CategoryBookInsert = typeof CategoryBook.$inferInsert;
