import { eq, sql } from "drizzle-orm";
import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "@/server/db/client";
import * as fsp from "node:fs/promises";
import os from "node:os";
import { runMigrations, seedAdmin } from "@/server/db/migrate";
import { Book, User } from "@/server/db/schema";
import { getPasswordHash } from "@/server/domain/password";
import type { EpubPackage } from "@/server/domain/epub";
import {
  createTestDb,
  createTestStorage,
  insertBook,
  insertCategory,
  insertCategoryBook,
  insertUser,
} from "../fixtures/test-db";

function ledgerRows(client: DatabaseSync): number {
  const row = client
    .prepare("select count(*) as count from __drizzle_migrations")
    .get() as { count: number };
  return row.count;
}

/**
 * Drizzle wraps driver failures in `DrizzleQueryError`, so the SQLite message
 * (UNIQUE/FOREIGN KEY) only shows up on `cause`.
 */
function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    const wrapped = error as { message: string; cause?: { message?: string } };
    return `${wrapped.message}\n${wrapped.cause?.message ?? ""}`;
  }
  throw new Error("expected the callback to throw");
}

describe("migrations", () => {
  it("creates the five tables plus the drizzle ledger", () => {
    const { client, close } = createTestDb();
    try {
      const tables = client
        .prepare("select name from sqlite_master where type = 'table'")
        .all() as unknown as { name: string }[];

      expect(tables.map((table) => table.name).sort()).toEqual([
        "Book",
        "Category",
        "CategoryBook",
        "Mark",
        "User",
        "__drizzle_migrations",
        "sqlite_sequence",
      ]);
    } finally {
      close();
    }
  });

  it("is idempotent: a second run applies nothing", () => {
    const { db, client, close } = createTestDb();
    try {
      const before = ledgerRows(client);

      runMigrations(db);

      expect(ledgerRows(client)).toBe(before);
      expect(before).toBeGreaterThan(0);
      // 记的条数不该钉死（每加一次迁移都会变），改成钉这次真正要的结果：新列在。
      const columns = client
        .prepare("select name from pragma_table_info('Book')")
        .all() as { name: string }[];
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["percent", "lastReadAt"]),
      );
    } finally {
      close();
    }
  });

  it("round-trips boolean and json columns", () => {
    const { db, close } = createTestDb();
    try {
      const admin = insertUser(db, "round-trip-admin", { isAdmin: true });
      const book = insertBook(db, admin.id);

      expect(admin.isAdmin).toBe(true);
      expect((book.content as EpubPackage).package.manifest).toHaveLength(1);

      const reread = db.select().from(Book).where(eq(Book.id, book.id)).get();
      expect(reread?.content).toEqual(book.content);
      expect(typeof reread?.content).toBe("object");
    } finally {
      close();
    }
  });

  it("rejects duplicate (bookId, categoryId) pairs (D9)", () => {
    const { db, close } = createTestDb();
    try {
      const user = insertUser(db, "unique-owner");
      const book = insertBook(db, user.id);
      const category = insertCategory(db, user.id, "Favourites");

      insertCategoryBook(db, book.id, category.id);

      expect(
        thrownMessage(() => insertCategoryBook(db, book.id, category.id)),
      ).toMatch(/UNIQUE constraint failed: CategoryBook/);
    } finally {
      close();
    }
  });

  it("enforces ON DELETE RESTRICT through real foreign keys", () => {
    const { db, close } = createTestDb();
    try {
      const user = insertUser(db, "restrict-owner");
      insertBook(db, user.id);

      expect(
        thrownMessage(() => db.delete(User).where(eq(User.id, user.id)).run()),
      ).toMatch(/FOREIGN KEY constraint failed/);
    } finally {
      close();
    }
  });

  it("rejects a duplicate username", () => {
    const { db, close } = createTestDb();
    try {
      insertUser(db, "duplicate-name");

      expect(thrownMessage(() => insertUser(db, "duplicate-name"))).toMatch(
        /UNIQUE constraint failed: User.username/,
      );
    } finally {
      close();
    }
  });
});

describe("seedAdmin", () => {
  it("creates the admin from env-ish options with a hashed password, once", () => {
    const { db, close } = createTestDb();
    try {
      expect(
        seedAdmin(db, { username: "root", password: "root-secret" }),
      ).toEqual({ created: true, username: "root" });

      const admin = db.select().from(User).where(eq(User.isAdmin, true)).get();
      expect(admin?.username).toBe("root");
      expect(admin?.password).toBe(getPasswordHash("root-secret"));

      expect(
        seedAdmin(db, { username: "other", password: "other-secret" }),
      ).toEqual({ created: false, username: null });
      expect(db.select({ id: User.id }).from(User).all()).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("does not touch an existing admin, even when the password changes", () => {
    const { db, close } = createTestDb();
    try {
      seedAdmin(db, { username: "root", password: "root-secret" });
      seedAdmin(db, { username: "root", password: "rotated-secret" });

      const admin = db.select().from(User).where(eq(User.isAdmin, true)).get();
      expect(admin?.password).toBe(getPasswordHash("root-secret"));
    } finally {
      close();
    }
  });
});

describe("raw sql entry points", () => {
  it("exposes the connection for ad-hoc queries", () => {
    const { db, close } = createTestDb();
    try {
      const result = db.get<{ one: number }>(sql`select 1 as one`);
      expect(result?.one).toBe(1);
    } finally {
      close();
    }
  });
});

describe("createDatabase", () => {
  it("opens a WAL database with foreign keys and a busy timeout", async () => {
    const storage = await createTestStorage();
    const database = createDatabase(path.join(storage.root, "client.sqlite"));
    try {
      const journal = database.$client.prepare("pragma journal_mode").get() as {
        journal_mode: string;
      };
      const foreignKeys = database.$client
        .prepare("pragma foreign_keys")
        .get() as { foreign_keys: number };
      const busyTimeout = database.$client
        .prepare("pragma busy_timeout")
        .get() as { timeout: number };

      expect(journal.journal_mode).toBe("wal");
      expect(foreignKeys.foreign_keys).toBe(1);
      expect(busyTimeout.timeout).toBe(5000);
    } finally {
      database.$client.close();
      await storage.cleanup();
    }
  });
});

describe("PDF/mark column migration", () => {
  it("renames epubcfi and backfills format/anchorType on populated rows", async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), "beryllium-migrate-"),
    );
    const oldFolder = path.join(root, "drizzle");
    try {
      await fsp.mkdir(oldFolder, { recursive: true });
      for (const migration of [
        "20261013160415_smooth_rocket_raccoon",
        "20261017122527_aberrant_slyde",
      ]) {
        await fsp.cp(
          path.join(process.cwd(), "drizzle", migration),
          path.join(oldFolder, migration),
          { recursive: true },
        );
      }

      const db = createDatabase(":memory:");
      runMigrations(db, oldFolder);
      db.$client
        .prepare(
          "insert into User (id, username, password, isAdmin) values (1, 'legacy', 'hash', 0)",
        )
        .run();
      db.$client
        .prepare(
          "insert into Book (id, title, author, description, cover, fileName, contentPath, current, content, userId) values (1, 'Legacy', '', '', '', 'legacy-book', 'content.opf', '', '{}', 1)",
        )
        .run();
      db.$client
        .prepare(
          "insert into Mark (id, type, epubcfi, color, title, content, selectedString, bookId, userId) values (1, 'highlight', 'epubcfi(/6/2!/4/2)', 'red', 'Old', '', 'text', 1, 1)",
        )
        .run();

      runMigrations(db);

      const columns = db.$client
        .prepare("select name from pragma_table_info('Mark')")
        .all() as { name: string }[];
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["anchor", "anchorType"]),
      );
      const mark = db.$client
        .prepare("select anchor, anchorType from Mark where id = 1")
        .get() as { anchor: string; anchorType: string };
      expect(mark).toEqual({
        anchor: "epubcfi(/6/2!/4/2)",
        anchorType: "cfi",
      });
      const book = db.$client
        .prepare("select format from Book where id = 1")
        .get() as { format: string };
      expect(book.format).toBe("epub");
      db.$client.close();
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
