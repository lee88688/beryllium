import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { parseToc } from "@/server/domain/epub";
import { getBookToc } from "@/server/services/book";
import { saveEpubFile } from "@/server/services/file";
import {
  SAMPLE_BOOK_NCX_TOC,
  SAMPLE_BOOK_NAV_TOC,
  buildSampleEpub,
} from "../fixtures/sample-book";
import {
  TOC_SUBDIR_BOOK_OPF_PATH,
  TOC_SUBDIR_NCX_TOC,
  TOC_SUBDIR_NAV_TOC,
  buildTocSubdirEpub,
} from "../fixtures/toc-subdir-book";
import {
  createTestDb,
  createTestStorage,
  insertUser,
} from "../fixtures/test-db";

// The budgets `readAsarFile` defaults to come from `getEnv()`.
process.env.ADMIN_USER_PASSWORD ??= "unit-test-admin-password";
process.env.SESSION_SECRET ??= "unit_test_session_secret_at_least_32_chars";

describe("parseToc href rebasing (B18)", () => {
  const NAV_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="../text/c1.xhtml">One</a></li>
        <li><a href="../text/c2.xhtml">Two</a>
          <ol><li><a href="../text/c3.xhtml">Deep</a></li></ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`;

  it("resolves a nav document's hrefs to archive-rooted member paths", async () => {
    // The reader hands these straight to foliate-js, which matches them against
    // manifest hrefs — archive-rooted, not OPF-relative.
    const toc = await parseToc(NAV_XHTML, "nav", {
      documentPath: "OEBPS/nav/nav.xhtml",
      contentPath: "OEBPS/content.opf",
    });

    expect(toc).toEqual([
      { label: "One", src: "OEBPS/text/c1.xhtml" },
      {
        label: "Two",
        src: "OEBPS/text/c2.xhtml",
        children: [{ label: "Deep", src: "OEBPS/text/c3.xhtml" }],
      },
    ]);
  });

  it("returns the href as written when there is no base to resolve against", async () => {
    const toc = await parseToc(NAV_XHTML, "nav");

    expect(toc).toEqual([
      { label: "One", src: "../text/c1.xhtml" },
      {
        label: "Two",
        src: "../text/c2.xhtml",
        children: [{ label: "Deep", src: "../text/c3.xhtml" }],
      },
    ]);
  });
});

describe("readBookToc with nav/NCX in a subdirectory (B18)", () => {
  it("rebases the EPUB3 nav document onto the OPF directory", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "subdir-nav-reader");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(buildTocSubdirEpub()),
        storage,
      );

      expect(book.contentPath).toBe(TOC_SUBDIR_BOOK_OPF_PATH);
      await expect(getBookToc(ctx.db, book, storage)).resolves.toEqual(
        TOC_SUBDIR_NAV_TOC,
      );
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });

  it("rebases the NCX when the book has no nav document", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "subdir-ncx-reader");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(buildTocSubdirEpub({ navigationDocument: "none" })),
        storage,
      );

      await expect(getBookToc(ctx.db, book, storage)).resolves.toEqual(
        TOC_SUBDIR_NCX_TOC,
      );
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });
});

describe("empty nav document falls back to NCX (B15)", () => {
  it("returns the NCX TOC when the nav document parses to zero entries", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const user = insertUser(ctx.db, "empty-nav-reader");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(buildTocSubdirEpub({ navigationDocument: "empty" })),
        storage,
      );

      await expect(getBookToc(ctx.db, book, storage)).resolves.toEqual(
        TOC_SUBDIR_NCX_TOC,
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("falling back to NCX"),
      );
    } finally {
      warn.mockRestore();
      await storage.cleanup();
      ctx.close();
    }
  });

  it("still returns an empty TOC when neither document has entries", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const user = insertUser(ctx.db, "no-toc-at-all");
      const book = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(
          buildTocSubdirEpub({ navigationDocument: "empty", ncx: false }),
        ),
        storage,
      );

      await expect(getBookToc(ctx.db, book, storage)).resolves.toEqual([]);
    } finally {
      warn.mockRestore();
      await storage.cleanup();
      ctx.close();
    }
  });
});

describe("sample-book TOC regressions", () => {
  it("keeps the EPUB3 preference and the NCX fallback unchanged", async () => {
    const ctx = createTestDb();
    const storage = await createTestStorage();
    try {
      const user = insertUser(ctx.db, "sample-reader");
      const withNav = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(buildSampleEpub()),
        storage,
      );
      const ncxOnly = await saveEpubFile(
        ctx.db,
        user.id,
        Readable.from(buildSampleEpub({ withNavigationDocument: false })),
        storage,
      );

      await expect(getBookToc(ctx.db, withNav, storage)).resolves.toEqual(
        SAMPLE_BOOK_NAV_TOC,
      );
      await expect(getBookToc(ctx.db, ncxOnly, storage)).resolves.toEqual(
        SAMPLE_BOOK_NCX_TOC,
      );
    } finally {
      await storage.cleanup();
      ctx.close();
    }
  });
});
