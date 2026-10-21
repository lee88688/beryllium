import * as fsp from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Book, Category, CategoryBook, Mark, User } from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import { getPasswordHash } from "@/server/domain/password";
import { userHasBook } from "@/server/services/book";
import { asarFileDir } from "@/server/services/file";
import { userHasMark } from "@/server/services/mark";
import {
  changePassword,
  createUser,
  deleteUser,
  isAdmin,
} from "@/server/services/user";
import {
  createTestDb,
  createTestStorage,
  insertBook,
  insertCategory,
  insertCategoryBook,
  insertMark,
  insertUser,
  type TestDb,
} from "../fixtures/test-db";
import { expectRequestError } from "../fixtures/errors";

describe("ownership checks", () => {
  let ctx: TestDb;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.close();
  });

  it("userHasBook matches only the owning user", () => {
    const owner = insertUser(ctx.db, "owner");
    const other = insertUser(ctx.db, "other");
    const book = insertBook(ctx.db, owner.id);

    expect(userHasBook(ctx.db, owner.id, book.id)).toBe(true);
    expect(userHasBook(ctx.db, other.id, book.id)).toBe(false);
    expect(userHasBook(ctx.db, owner.id, book.id + 1000)).toBe(false);
  });

  it("userHasMark matches only the owning user", () => {
    const owner = insertUser(ctx.db, "mark-owner");
    const other = insertUser(ctx.db, "mark-other");
    const book = insertBook(ctx.db, owner.id);
    const mark = insertMark(ctx.db, book.id, owner.id);

    expect(userHasMark(ctx.db, owner.id, mark.id)).toBe(true);
    expect(userHasMark(ctx.db, other.id, mark.id)).toBe(false);
    expect(userHasMark(ctx.db, owner.id, mark.id + 1000)).toBe(false);
  });
});

describe("deleteUser", () => {
  it("removes categories, links, marks, books and their ASAR files", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const doomed = insertUser(ctx.db, "doomed");
      const survivor = insertUser(ctx.db, "survivor");

      const doomedBooks = [
        insertBook(ctx.db, doomed.id),
        insertBook(ctx.db, doomed.id),
      ];
      const doomedCategory = insertCategory(ctx.db, doomed.id, "Doomed");
      insertCategoryBook(ctx.db, doomedBooks[0]!.id, doomedCategory.id);
      insertMark(ctx.db, doomedBooks[0]!.id, doomed.id);
      insertMark(ctx.db, doomedBooks[1]!.id, doomed.id);

      const survivorBook = insertBook(ctx.db, survivor.id);
      const survivorCategory = insertCategory(ctx.db, survivor.id, "Kept");
      insertCategoryBook(ctx.db, survivorBook.id, survivorCategory.id);
      const survivorMark = insertMark(ctx.db, survivorBook.id, survivor.id);

      for (const book of [...doomedBooks, survivorBook]) {
        await fsp.writeFile(
          asarFileDir(book.fileName, storage),
          Buffer.from("asar"),
        );
      }

      await deleteUser(ctx.db, doomed.id, storage);

      expect(
        ctx.db
          .select()
          .from(User)
          .all()
          .map((user) => user.username),
      ).toEqual(["survivor"]);
      expect(
        ctx.db
          .select()
          .from(Book)
          .all()
          .map((book) => book.id),
      ).toEqual([survivorBook.id]);
      expect(
        ctx.db
          .select()
          .from(Mark)
          .all()
          .map((mark) => mark.id),
      ).toEqual([survivorMark.id]);
      expect(
        ctx.db
          .select()
          .from(Category)
          .all()
          .map((category) => category.id),
      ).toEqual([survivorCategory.id]);
      expect(ctx.db.select().from(CategoryBook).all()).toHaveLength(1);

      for (const book of doomedBooks) {
        await expect(
          fsp.access(asarFileDir(book.fileName, storage)),
        ).rejects.toThrow();
      }
      await expect(
        fsp.access(asarFileDir(survivorBook.fileName, storage)),
      ).resolves.toBeUndefined();
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("does nothing for an unknown user", async () => {
    const ctx = createTestDb();
    try {
      const user = insertUser(ctx.db, "untouched");

      await deleteUser(ctx.db, user.id + 1000);

      expect(ctx.db.select().from(User).all()).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it("survives an already deleted ASAR file", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "no-file");
      insertBook(ctx.db, user.id);

      await expect(
        deleteUser(ctx.db, user.id, storage),
      ).resolves.toBeUndefined();
      expect(ctx.db.select().from(Book).all()).toHaveLength(0);
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });
});

describe("user service", () => {
  let ctx: TestDb;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(() => {
    ctx.close();
  });

  it("createUser stores the digest and isAdmin reads the flag back", () => {
    const user = createUser(ctx.db, {
      username: "created",
      password: "secret",
    });
    const admin = createUser(ctx.db, {
      username: "created-admin",
      password: "secret",
      isAdmin: true,
    });

    expect(user.password).toBe(getPasswordHash("secret"));
    expect(isAdmin(ctx.db, user.id)).toBe(false);
    expect(isAdmin(ctx.db, admin.id)).toBe(true);
    expect(isAdmin(ctx.db, admin.id + 1000)).toBe(false);
  });

  it("changePassword stores a digest usable by the login lookup (D2)", () => {
    const user = createUser(ctx.db, { username: "pw", password: "old-secret" });

    changePassword(ctx.db, user.id, {
      newPassword: "newpass99",
      confirmPassword: "newpass99",
    });

    const loginMatch = ctx.db
      .select()
      .from(User)
      .where(
        and(
          eq(User.username, "pw"),
          eq(User.password, getPasswordHash("newpass99")),
        ),
      )
      .get();
    expect(loginMatch?.id).toBe(user.id);
  });

  it("changePassword rejects mismatched confirmation and keeps the old password (D3)", () => {
    const user = createUser(ctx.db, { username: "mismatch", password: "old" });

    expect(() =>
      changePassword(ctx.db, user.id, {
        newPassword: "newpass99",
        confirmPassword: "newpass100",
      }),
    ).toThrowError(RequestError);

    const row = ctx.db.select().from(User).where(eq(User.id, user.id)).get();
    expect(row?.password).toBe(getPasswordHash("old"));
  });

  it("changePassword rejects short passwords", () => {
    const user = createUser(ctx.db, { username: "short", password: "old" });

    expect(() =>
      changePassword(ctx.db, user.id, {
        newPassword: "12345",
        confirmPassword: "12345",
      }),
    ).toThrowError(/at least 6 characters/);
  });

  it("changePassword reports NOT_FOUND instead of success when no row matches (B14)", async () => {
    const user = createUser(ctx.db, { username: "gone", password: "old" });
    ctx.db.delete(User).where(eq(User.id, user.id)).run();

    const error = await expectRequestError(async () => {
      changePassword(ctx.db, user.id, {
        newPassword: "newpass99",
        confirmPassword: "newpass99",
      });
    });

    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
  });
});
