import * as fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { Book } from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import { getBookToc } from "@/server/services/book";
import {
  asarFileDir,
  deleteEpubFile,
  readAsarFile,
  saveEpubFile,
} from "@/server/services/file";
import {
  SAMPLE_BOOK_AUTHOR,
  SAMPLE_BOOK_COVER_PATH,
  SAMPLE_BOOK_DESCRIPTION,
  SAMPLE_BOOK_NCX_TOC,
  SAMPLE_BOOK_NAV_TOC,
  SAMPLE_BOOK_OPF_PATH,
  SAMPLE_BOOK_TITLE,
  buildSampleEpub,
  sampleEpubEntries,
} from "../fixtures/sample-book";
import { buildZip } from "../fixtures/zip";
import { expectRequestError } from "../fixtures/errors";
import {
  createTestDb,
  createTestStorage,
  insertUser,
} from "../fixtures/test-db";

const FIXTURES = path.resolve("tests/fixtures");

// `readAsarFile`/`saveEpubFile` default their budgets from `getEnv()`, which
// needs the required variables. `.env` fills them in on a developer machine; CI
// checks out without one, so set them here (real process env still wins).
process.env.ADMIN_USER_PASSWORD ??= "unit-test-admin-password";
process.env.SESSION_SECRET ??= "unit_test_session_secret_at_least_32_chars";

const sampleEpub = await fsp.readFile(path.join(FIXTURES, "sample-book.epub"));
const zipSlipEpub = await fsp.readFile(path.join(FIXTURES, "zip-slip.epub"));

describe("saveEpubFile", () => {
  it("streams the EPUB into an ASAR and stores the OPF metadata", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "uploader");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(sampleEpub),
        storage,
      );

      expect(book).toMatchObject({
        title: SAMPLE_BOOK_TITLE,
        author: SAMPLE_BOOK_AUTHOR,
        description: SAMPLE_BOOK_DESCRIPTION,
        cover: SAMPLE_BOOK_COVER_PATH,
        contentPath: SAMPLE_BOOK_OPF_PATH,
        current: "",
        userId: user.id,
      });
      expect(book.content.package.spine?.[0]?.$?.toc).toBe("ncx");
      expect(ctx.db.select().from(Book).all()).toHaveLength(1);

      const asarPath = asarFileDir(book.fileName, storage);
      const cover = await readAsarFile(asarPath, SAMPLE_BOOK_COVER_PATH);
      expect([...cover.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect((await readAsarFile(asarPath, "mimetype")).toString("utf8")).toBe(
        "application/epub+zip",
      );

      expect(await fsp.readdir(storage.tempDir)).toEqual([]);
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("rejects a non-EPUB ZIP and removes both the temp dir and the ASAR", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "no-container");
      const notAnEpub = buildZip([
        { name: "mimetype", data: "application/epub+zip" },
        { name: "random.txt", data: "no container.xml here" },
      ]);

      await expect(
        saveEpubFile(ctx.db, user.id, Readable.from(notAnEpub), storage),
      ).rejects.toThrowError(RequestError);

      expect(ctx.db.select().from(Book).all()).toHaveLength(0);
      expect(await fsp.readdir(storage.tempDir)).toEqual([]);
      expect(await fsp.readdir(storage.asarDir)).toEqual([]);
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("rejects a zip-slip archive without writing outside the temp dir (D5)", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "attacker");

      await expect(
        saveEpubFile(ctx.db, user.id, Readable.from(zipSlipEpub), storage),
      ).rejects.toThrowError(RequestError);

      await expect(
        fsp.access(path.join(storage.root, "escaped.txt")),
      ).rejects.toThrow();
      expect(ctx.db.select().from(Book).all()).toHaveLength(0);
      expect(await fsp.readdir(storage.tempDir)).toEqual([]);
      expect(await fsp.readdir(storage.asarDir)).toEqual([]);
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("cleans up the temp dir when the upload is not a zip at all (D3/D5)", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "garbage");

      // Bytes that are not an archive are a bad upload, not a server fault, so
      // the error is a `BAD_REQUEST` the route can surface as 400 (D3).
      const error = await expectRequestError(() =>
        saveEpubFile(
          ctx.db,
          user.id,
          Readable.from(Buffer.from("definitely not a zip archive")),
          storage,
        ),
      );
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.status).toBe(400);

      expect(ctx.db.select().from(Book).all()).toHaveLength(0);
      expect(await fsp.readdir(storage.tempDir)).toEqual([]);
      expect(await fsp.readdir(storage.asarDir)).toEqual([]);
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("cleans up the temp dir when the upload stream is aborted (D5)", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "aborted");

      const aborted = new Readable({
        read() {
          this.push(sampleEpub.subarray(0, 64));
          this.destroy(new Error("client aborted the upload"));
        },
      });

      await expect(
        saveEpubFile(ctx.db, user.id, aborted, storage),
      ).rejects.toThrow(/client aborted the upload/);

      expect(ctx.db.select().from(Book).all()).toHaveLength(0);
      expect(await fsp.readdir(storage.tempDir)).toEqual([]);
      expect(await fsp.readdir(storage.asarDir)).toEqual([]);
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });
});

describe("getBookToc", () => {
  it("prefers the EPUB3 navigation document (D8)", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "nav-reader");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(sampleEpub),
        storage,
      );

      await expect(getBookToc(ctx.db, book, storage)).resolves.toEqual(
        SAMPLE_BOOK_NAV_TOC,
      );
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("falls back to NCX for EPUB3 books without a nav document (D8)", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "ncx-reader");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(buildSampleEpub({ withNavigationDocument: false })),
        storage,
      );

      await expect(getBookToc(ctx.db, book, storage)).resolves.toEqual(
        SAMPLE_BOOK_NCX_TOC,
      );
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("falls back to NCX when the declared nav document is missing", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const user = insertUser(ctx.db, "broken-nav");
      const brokenNav = buildZip(
        sampleEpubEntries().filter((entry) => entry.name !== "OEBPS/nav.xhtml"),
      );
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(brokenNav),
        storage,
      );

      await expect(getBookToc(ctx.db, book, storage)).resolves.toEqual(
        SAMPLE_BOOK_NCX_TOC,
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("falling back to NCX"),
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
      await storage.cleanup();
      ctx.close();
    }
  });

  it("returns an empty TOC for books without any TOC document", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "no-toc");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(
          buildSampleEpub({ withNavigationDocument: false, withNcx: false }),
        ),
        storage,
      );

      await expect(getBookToc(ctx.db, book, storage)).resolves.toEqual([]);
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });
});

describe("ASAR helpers", () => {
  it("rejects traversal paths and missing files", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "asar-reader");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(sampleEpub),
        storage,
      );
      const asarPath = asarFileDir(book.fileName, storage);

      await expect(
        readAsarFile(asarPath, "../outside.txt"),
      ).rejects.toThrowError(RequestError);
      await expect(
        readAsarFile(asarPath, "OEBPS/missing.png"),
      ).rejects.toThrow();
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("deleteEpubFile is idempotent", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "deleter");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(sampleEpub),
        storage,
      );
      const asarPath = asarFileDir(book.fileName, storage);

      await deleteEpubFile(book.fileName, storage);
      await expect(fsp.access(asarPath)).rejects.toThrow();
      await expect(
        deleteEpubFile(book.fileName, storage),
      ).resolves.toBeUndefined();
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });
});
