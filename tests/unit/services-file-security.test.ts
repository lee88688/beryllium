import * as fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import asar from "@electron/asar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Book } from "@/server/db/schema";
import { RequestError } from "@/server/domain/errors";
import {
  asarFileDir,
  convertEpubToAsar,
  deleteEpubFile,
  readAsarFile,
  saveEpubFile,
  type EpubLimits,
} from "@/server/services/file";
import { sampleEpubEntries } from "../fixtures/sample-book";
import { buildZip } from "../fixtures/zip";
import { expectRequestError } from "../fixtures/errors";
import {
  buildFatMemberEpub,
  buildLyingZipBomb,
  buildZipBomb,
  fatMemberChapter,
} from "../fixtures/zip-bomb";
import {
  createTestDb,
  createTestStorage,
  insertUser,
} from "../fixtures/test-db";

// `readAsarFile` defaults its budgets from `getEnv()`, which requires the
// mandatory variables (.env on a dev machine, nothing in CI).
process.env.ADMIN_USER_PASSWORD ??= "unit-test-admin-password";
process.env.SESSION_SECRET ??= "unit_test_session_secret_at_least_32_chars";

const MB = 1024 * 1024;

/** Budgets generous enough for real fixtures unless a test says otherwise. */
const ROOMY: EpubLimits = {
  maxExtractedBytes: 64 * MB,
  maxMemberBytes: 32 * MB,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extraction budget (B1 zip bomb)", () => {
  it("rejects a high-compression-ratio archive, keeping DB, temp and asar dirs empty", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "bomb-uploader");
      const bomb = buildZipBomb(8 * MB);
      // The premise of the fixture: megabytes on disk become kilobytes on the wire.
      expect(bomb.byteLength).toBeLessThan(64 * 1024);

      const error = await expectRequestError(() =>
        saveEpubFile(ctx.db, user.id, Readable.from(bomb), storage, {
          maxExtractedBytes: 1 * MB,
          maxMemberBytes: 1 * MB,
        }),
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

  it("counts the bytes actually produced, so a lying size header is caught too", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "liar-uploader");
      const lying = buildLyingZipBomb({
        memberBytes: 8 * MB,
        declaredBytes: 32 * 1024,
      });

      const error = await expectRequestError(() =>
        saveEpubFile(ctx.db, user.id, Readable.from(lying), storage, {
          maxExtractedBytes: 1 * MB,
          maxMemberBytes: 1 * MB,
        }),
      );

      expect(error.code).toBe("BAD_REQUEST");
      expect(await fsp.readdir(storage.tempDir)).toEqual([]);
      expect(await fsp.readdir(storage.asarDir)).toEqual([]);
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });
});

describe("member read budget (B1 413)", () => {
  it("refuses to buffer a member over the read budget, and serves it under one", async () => {
    const storage = await createTestStorage();
    try {
      const fat = buildFatMemberEpub(2 * MB);
      const asarPath = await convertEpubToAsar(
        Readable.from(fat),
        "fat-member",
        storage,
        ROOMY,
      );

      const error = await expectRequestError(() =>
        readAsarFile(asarPath, "OEBPS/text/chapter1.xhtml", {
          maxExtractedBytes: 16 * MB,
          maxMemberBytes: 1 * MB,
        }),
      );
      expect(error.code).toBe("PAYLOAD_TOO_LARGE");
      expect(error.status).toBe(413);

      const served = await readAsarFile(asarPath, "OEBPS/text/chapter1.xhtml", {
        maxExtractedBytes: 16 * MB,
        maxMemberBytes: 8 * MB,
      });
      const expected = fatMemberChapter(2 * MB);
      expect(served.byteLength).toBe(Buffer.byteLength(expected, "utf8"));
      expect(served.toString("utf8")).toBe(expected);
    } finally {
      await storage.cleanup();
    }
  });
});

describe("member name validation (B9)", () => {
  const REJECTED = [
    "__proto__",
    "constructor",
    "prototype",
    "OEBPS/__proto__",
    "OEBPS/text/../content.opf",
    "OEBPS//text/chapter1.xhtml",
    "C:/Windows/system32/drivers/etc/hosts",
    "OEBPS/text/\u0000null.xhtml",
  ];

  it("rejects prototype-polluting and non-archive member names", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "polluter");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(
          buildZip([
            ...sampleEpubEntries(),
            { name: "__proto__", data: "polluted" },
          ]),
        ),
        storage,
        ROOMY,
      );
      const asarPath = asarFileDir(book.fileName, storage);

      for (const memberPath of REJECTED) {
        const error = await expectRequestError(() =>
          readAsarFile(asarPath, memberPath, ROOMY),
        );
        expect(error.code).toBe("BAD_REQUEST");
      }

      // The control: a normal member of the same archive still reads.
      expect(
        (await readAsarFile(asarPath, "mimetype", ROOMY)).toString("utf8"),
      ).toBe("application/epub+zip");
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });
});

describe("generic errors (B10)", () => {
  it("answers a corrupt archive with the same 404 as a missing member, without leaking paths", async () => {
    const storage = await createTestStorage();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const corrupt = path.join(storage.asarDir, "corrupt.asar");
      await fsp.writeFile(
        corrupt,
        Buffer.from("definitely not an asar archive"),
      );

      const error = await expectRequestError(() =>
        readAsarFile(corrupt, "mimetype", ROOMY),
      );

      expect(error.code).toBe("NOT_FOUND");
      expect(error.message).not.toContain(storage.root);
      expect(logged).toHaveBeenCalled();
    } finally {
      await storage.cleanup();
    }
  });
});

describe("packaging failure (B13)", () => {
  it("removes the half-written asar instead of leaving an orphan", async () => {
    const storage = await createTestStorage();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const createPackage = vi
      .spyOn(asar, "createPackage")
      .mockImplementation(async (_source, destination) => {
        // A failed packaging run leaves something behind at the destination.
        await fsp.writeFile(destination, "half-written");
        throw new Error("packaging exploded");
      });
    try {
      // The packaging error is not a `RequestError`: it is an unexpected server
      // fault (the route answers a generic 500), and the point of this test is
      // the cleanup that must happen on the way out.
      await expect(
        convertEpubToAsar(
          Readable.from(buildFatMemberEpub(1 * MB)),
          "half-packed",
          storage,
          ROOMY,
        ),
      ).rejects.toThrow(/packaging exploded/);

      await expect(
        fsp.access(asarFileDir("half-packed", storage)),
      ).rejects.toThrow();
      expect(await fsp.readdir(storage.asarDir)).toEqual([]);
      expect(await fsp.readdir(storage.tempDir)).toEqual([]);
      expect(logged).toHaveBeenCalled();
    } finally {
      createPackage.mockRestore();
      await storage.cleanup();
    }
  });
});

describe("deleteEpubFile failure (B10)", () => {
  it("reports a generic error instead of the filesystem's message", async () => {
    const storage = await createTestStorage();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // A directory where the archive should be makes the unlink fail for real,
      // with a message that names an absolute path.
      await fsp.mkdir(asarFileDir("undeletable", storage));

      const error = await expectRequestError(() =>
        deleteEpubFile("undeletable", storage),
      );

      expect(error.code).toBe("INTERNAL");
      expect(error.message).not.toContain(storage.root);
      expect(error.message).not.toContain("asar");
      expect(logged).toHaveBeenCalled();
    } finally {
      await storage.cleanup();
    }
  });
});

describe("RequestError surface", () => {
  it("keeps the archive error codes the routes switch on", () => {
    expect(new RequestError("PAYLOAD_TOO_LARGE", "x").status).toBe(413);
    expect(new RequestError("INTERNAL", "x").status).toBe(500);
  });
});
