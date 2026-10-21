import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, type Database } from "@/server/db/client";
import {
  Book,
  Category,
  CategoryBook,
  Mark,
  User,
  type BookSelect,
  type UserSelect,
} from "@/server/db/schema";
import type { EpubStorage } from "@/server/services/file";

export interface TestDb {
  db: Database;
  client: DatabaseSync;
  close: () => void;
}

/**
 * Fresh in-memory database with the real, checked-in migrations applied — the
 * same `openDatabase` entry point the app uses via `getDb()`.
 */
export function createTestDb(): TestDb {
  const db = openDatabase(":memory:");

  return {
    db,
    client: db.$client,
    close: () => db.$client.close(),
  };
}

interface TestStorage extends EpubStorage {
  root: string;
  cleanup: () => Promise<void>;
}

/** Throwaway asar/temp directories so upload tests never touch `data/`. */
export async function createTestStorage(): Promise<TestStorage> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "beryllium-unit-"));
  const asarDir = path.join(root, "asar");
  const tempDir = path.join(root, "temp");
  await fsp.mkdir(asarDir, { recursive: true });
  await fsp.mkdir(tempDir, { recursive: true });

  return {
    root,
    asarDir,
    tempDir,
    cleanup: () => fsp.rm(root, { recursive: true, force: true }),
  };
}

/** Minimal valid `Book.content` for services that never parse it. */
const SEEDED_PACKAGE = {
  package: { metadata: [{}], manifest: [{}], spine: [{}] },
};

export function insertUser(
  db: Database,
  username: string,
  options: { password?: string; isAdmin?: boolean } = {},
): UserSelect {
  return db
    .insert(User)
    .values({
      username,
      password: options.password ?? `hash-of-${username}`,
      isAdmin: options.isAdmin ?? false,
    })
    .returning()
    .get();
}

let bookSequence = 0;

export function insertBook(
  db: Database,
  userId: number,
  options: {
    title?: string;
    fileName?: string;
    cover?: string;
    contentPath?: string;
  } = {},
): BookSelect {
  return db
    .insert(Book)
    .values({
      title: options.title ?? "Seeded Book",
      author: "Seeded Author",
      description: "Seeded description",
      cover: options.cover ?? "",
      fileName: options.fileName ?? `seed-book-${(bookSequence += 1)}`,
      contentPath: options.contentPath ?? "OEBPS/content.opf",
      current: "",
      content: SEEDED_PACKAGE,
      userId,
    })
    .returning()
    .get();
}

export function insertCategory(db: Database, userId: number, name: string) {
  return db.insert(Category).values({ name, userId }).returning().get();
}

export function insertCategoryBook(
  db: Database,
  bookId: number,
  categoryId: number,
) {
  return db
    .insert(CategoryBook)
    .values({ bookId, categoryId })
    .returning()
    .get();
}

export function insertMark(db: Database, bookId: number, userId: number) {
  return db
    .insert(Mark)
    .values({
      type: "bookmark",
      epubcfi: "epubcfi(/6/2!/4/2/1:0)",
      color: "",
      title: "Seeded mark",
      content: "",
      selectedString: "",
      bookId,
      userId,
    })
    .returning()
    .get();
}
