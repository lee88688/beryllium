import { readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { Book, CategoryBook, Mark } from "@/server/db/schema";
import {
  SAMPLE_BOOK_NAV_TOC,
  buildPng,
  sampleEpubEntries,
} from "../fixtures/sample-book";
import {
  callServerFn,
  createAuthenticatedSession,
  createHttpSession,
  createTestServer,
  epubFormData,
  failureMessage,
  parseResult,
  sampleEpubBytes,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

const bookRow = z.object({
  id: z.number(),
  title: z.string(),
  author: z.string(),
  fileName: z.string(),
  cover: z.string(),
  contentPath: z.string(),
  userId: z.number(),
});
const uploadResult = z.object({ book: bookRow });
const idResult = z.object({ id: z.number() });
const bookInfoResult = z.object({
  id: z.number(),
  title: z.string(),
  author: z.string(),
});
const categoryList = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    books: z.array(z.object({ id: z.number(), title: z.string() })),
  }),
);
const markList = z.array(
  z.object({
    id: z.number(),
    type: z.string(),
    color: z.string(),
    content: z.string(),
  }),
);
const readerData = z.object({
  book: z.object({
    id: z.number(),
    title: z.string(),
    current: z.string(),
    filesBaseUrl: z.string(),
    spineSizes: z.record(z.string(), z.number()),
  }),
  toc: z.array(z.unknown()),
  highlights: z.array(z.object({ id: z.number() })),
  bookmarks: z.array(z.object({ id: z.number() })),
});

const CHAPTER = "OEBPS/text/chapter1.xhtml";
const OPF = "OEBPS/content.opf";
const CSS = "OEBPS/styles/book.css";
const FONT = "OEBPS/fonts/book.woff2";
const SVG = "OEBPS/images/art.svg";
const AUDIO = "OEBPS/media/audio.mp3";
const UNKNOWN = "OEBPS/misc/blob.bin";

let server: TestServer;
let ownerHttp: HttpSession;
let intruderHttp: HttpSession;

function entryBytes(name: string): Buffer {
  const entry = sampleEpubEntries().find(
    (candidate) => candidate.name === name,
  );
  if (entry === undefined) throw new Error(`fixture entry ${name} is missing`);
  return typeof entry.data === "string"
    ? Buffer.from(entry.data, "utf8")
    : entry.data;
}

async function upload(http: HttpSession): Promise<z.infer<typeof bookRow>> {
  const response = await http.fetch("/api/books", {
    method: "POST",
    body: epubFormData(sampleEpubBytes()),
  });
  expect(response.status).toBe(201);
  return uploadResult.parse(await response.json()).book;
}

beforeAll(async () => {
  server = await createTestServer();
  const owner = seedUser(server, "owner");
  const intruder = seedUser(server, "intruder");
  ownerHttp = await createAuthenticatedSession(server, owner.id);
  intruderHttp = await createAuthenticatedSession(server, intruder.id);
});

afterAll(async () => {
  await server.close();
});

describe("GET /api/books/{id}/files/{path}", () => {
  it("I10 serves the cover with the extension's MIME type and a private cache", async () => {
    const book = await upload(ownerHttp);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${book.cover}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    // Images keep the long immutable cache the bookshelf relies on; the route
    // gives text members the short one (B7, see the chapter case below).
    expect(response.headers.get("cache-control")).toBe(
      "private,max-age=31536000,immutable",
    );
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      buildPng(2, 2, [200, 60, 60]),
    );
  });

  it("I10 serves a chapter as XHTML with byte-exact content", async () => {
    const book = await upload(ownerHttp);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xhtml+xml");
    // Book text is stored but every use revalidates, so a logged-out browser
    // cannot replay it from the disk cache (B7).
    expect(response.headers.get("cache-control")).toBe("private,no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[^"]+"$/);
    // Cache entries are partitioned by the session cookie (B7).
    expect(response.headers.get("vary")).toBe("cookie");
    // Direct navigation to a chapter cannot script or fetch anything (B8).
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    const body = Buffer.from(await response.arrayBuffer());
    expect(body).toEqual(entryBytes(CHAPTER));
    expect(body.toString("utf8")).toContain("Body of chapter one.");
  });

  it("answers 404 for an unknown member", async () => {
    const book = await upload(ownerHttp);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/OEBPS/text/missing.xhtml`,
    );

    expect(response.status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const book = await upload(ownerHttp);

    const response = await createHttpSession(server).fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
    );

    expect(response.status).toBe(401);
  });

  it("I11 refuses another reader's book without leaking content (IDOR)", async () => {
    const book = await upload(ownerHttp);

    const response = await intruderHttp.fetch(
      `/api/books/${String(book.id)}/files/${CHAPTER}`,
    );

    // Migration plan §5.2: a book belongs to exactly one reader, so a foreign id
    // is a decided 403 — not "403 or 404 depending on the mood".
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: "FORBIDDEN" });
    expect(body).not.toContain("Body of chapter one");
  });
});

describe("member caching and validators", () => {
  it.each([
    [CSS, "text/css", "private,max-age=31536000,immutable"],
    [FONT, "font/woff2", "private,max-age=31536000,immutable"],
    [SVG, "image/svg+xml", "private,no-cache"],
    [AUDIO, "audio/mpeg", "private,max-age=3600"],
    [UNKNOWN, "application/octet-stream", "private,no-cache"],
  ])("I14 tiers %s as %s", async (memberPath, contentType, cacheControl) => {
    const book = await upload(ownerHttp);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${memberPath}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(contentType);
    expect(response.headers.get("cache-control")).toBe(cacheControl);
    expect(response.headers.get("etag")).toMatch(/^"[^"]+"$/);
  });

  it("I14 answers 304 to a matching validator without a body", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/${CHAPTER}`;

    const first = await ownerHttp.fetch(url);
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();

    const second = await ownerHttp.fetch(url, {
      headers: { "if-none-match": etag! },
    });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(second.headers.get("cache-control")).toBe("private,no-cache");
    expect(second.headers.get("vary")).toBe("cookie");
    // A 304 carries no entity headers; the runtime would reject a body anyway.
    expect(second.headers.get("content-length")).toBeNull();
    expect(second.headers.get("content-range")).toBeNull();

    // The tag is derived from immutable index data, so a later 200 reuses it.
    const third = await ownerHttp.fetch(url);
    expect(third.headers.get("etag")).toBe(etag);

    // The tag identifies the member, not just the book.
    const other = await ownerHttp.fetch(`/api/books/${book.id}/files/${OPF}`);
    expect(other.headers.get("etag")).not.toBe(etag);
  });

  it("I14 compares If-None-Match weakly and across a list", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/${CHAPTER}`;
    const etag = (await ownerHttp.fetch(url)).headers.get("etag")!;

    const weak = await ownerHttp.fetch(url, {
      headers: { "if-none-match": `W/${etag}` },
    });
    expect(weak.status).toBe(304);

    const listed = await ownerHttp.fetch(url, {
      headers: { "if-none-match": `"other", ${etag}` },
    });
    expect(listed.status).toBe(304);
  });

  it("I14 serves a zero-byte member on both the read and conditional paths", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/OEBPS/misc/empty.txt`;

    const response = await ownerHttp.fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
    expect((await response.arrayBuffer()).byteLength).toBe(0);

    const etag = response.headers.get("etag")!;
    const conditional = await ownerHttp.fetch(url, {
      headers: { "if-none-match": etag },
    });
    expect(conditional.status).toBe(304);
  });

  it("I14 ignores a stale validator and sends the body", async () => {
    const book = await upload(ownerHttp);
    const full = entryBytes(CHAPTER);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
      { headers: { "if-none-match": '"stale-tag"' } },
    );

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(full);
  });

  it("I14 treats * as a matching validator", async () => {
    const book = await upload(ownerHttp);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
      { headers: { "if-none-match": "*" } },
    );

    expect(response.status).toBe(304);
  });

  it("I14 answers HEAD with 304 and no body", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/${CHAPTER}`;
    const etag = (await ownerHttp.fetch(url)).headers.get("etag")!;

    const response = await ownerHttp.fetch(url, {
      method: "HEAD",
      headers: { "if-none-match": etag },
    });

    expect(response.status).toBe(304);
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("I14 checks authentication and ownership before the validator", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/${CHAPTER}`;
    const etag = (await ownerHttp.fetch(url)).headers.get("etag")!;

    const anonymous = await server.fetch(
      new Request(`http://localhost${url}`, {
        headers: { "if-none-match": etag },
      }),
    );
    expect(anonymous.status).toBe(401);

    const forbidden = await intruderHttp.fetch(url, {
      headers: { "if-none-match": etag },
    });
    expect(forbidden.status).toBe(403);
  });
});

describe("range requests", () => {
  it("I12 answers a byte range with 206 and Content-Range", async () => {
    const book = await upload(ownerHttp);
    const full = entryBytes(CHAPTER);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
      { headers: { range: "bytes=0-9" } },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 0-9/${full.byteLength}`,
    );
    expect(response.headers.get("content-length")).toBe("10");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      full.subarray(0, 10),
    );
  });

  it("I20 honors Range when If-Range carries the current validator", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/${CHAPTER}`;
    const full = entryBytes(CHAPTER);
    const etag = (await ownerHttp.fetch(url)).headers.get("etag")!;

    const response = await ownerHttp.fetch(url, {
      headers: { range: "bytes=0-9", "if-range": etag },
    });

    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      full.subarray(0, 10),
    );
  });

  it("I20 ignores Range when If-Range is stale", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/${CHAPTER}`;
    const full = entryBytes(CHAPTER);

    const response = await ownerHttp.fetch(url, {
      headers: { range: "bytes=0-9", "if-range": '"stale-tag"' },
    });

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(full);
  });

  it("I20 ignores a weak If-Range validator", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/${CHAPTER}`;
    const etag = (await ownerHttp.fetch(url)).headers.get("etag")!;

    const response = await ownerHttp.fetch(url, {
      headers: { range: "bytes=0-9", "if-range": `W/${etag}` },
    });

    expect(response.status).toBe(200);
  });

  it("I20 evaluates If-None-Match before Range", async () => {
    const book = await upload(ownerHttp);
    const url = `/api/books/${book.id}/files/${CHAPTER}`;
    const etag = (await ownerHttp.fetch(url)).headers.get("etag")!;

    const response = await ownerHttp.fetch(url, {
      headers: { range: "bytes=0-9", "if-none-match": etag },
    });

    expect(response.status).toBe(304);
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("I12 answers a suffix range with the last bytes", async () => {
    const book = await upload(ownerHttp);
    const full = entryBytes(CHAPTER);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
      { headers: { range: "bytes=-10" } },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${full.byteLength - 10}-${full.byteLength - 1}/${full.byteLength}`,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      full.subarray(full.byteLength - 10),
    );
  });

  it("I12 answers the whole file with Accept-Ranges when no range is asked", async () => {
    const book = await upload(ownerHttp);
    const full = entryBytes(CHAPTER);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(
      String(full.byteLength),
    );
  });

  it("I12 answers HEAD with the headers and no body", async () => {
    const book = await upload(ownerHttp);
    const full = entryBytes(CHAPTER);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
      { method: "HEAD" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(
      String(full.byteLength),
    );
    expect(await response.text()).toBe("");
  });

  it("I13 answers 416 with the file size for an unsatisfiable range", async () => {
    const book = await upload(ownerHttp);
    const full = entryBytes(CHAPTER);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
      { headers: { range: "bytes=99999999-" } },
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(
      `bytes */${full.byteLength}`,
    );
  });

  it("ignores a multi-range request and answers 200 with the whole member (B11)", async () => {
    const book = await upload(ownerHttp);
    const full = entryBytes(CHAPTER);

    const response = await ownerHttp.fetch(
      `/api/books/${book.id}/files/${CHAPTER}`,
      { headers: { range: "bytes=0-9,20-29" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("content-length")).toBe(
      String(full.byteLength),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(full);
  });
});

describe("getReaderData", () => {
  it("returns the EPUB3 TOC, the member prefix and the spine sizes", async () => {
    const book = await upload(ownerHttp);
    const added = parseResult(
      await callServerFn(ownerHttp, "addMark", {
        bookId: book.id,
        type: "bookmark",
        anchorType: "cfi",
        anchor: "epubcfi(/6/4!/4/2/1:0)",
        title: "My bookmark",
      }),
      idResult,
    );

    const data = parseResult(
      await callServerFn(ownerHttp, "getReaderData", { bookId: book.id }),
      readerData,
    );

    expect(data.book.filesBaseUrl).toBe(`/api/books/${book.id}/files/`);
    // The reader builds every member URL from that prefix and hands the sizes
    // to foliate-js, which reads them synchronously while building the book.
    expect(data.book.spineSizes).toEqual({
      [CHAPTER]: entryBytes(CHAPTER).byteLength,
      "OEBPS/text/chapter2.xhtml": entryBytes("OEBPS/text/chapter2.xhtml")
        .byteLength,
      "OEBPS/text/chapter2-1.xhtml": entryBytes("OEBPS/text/chapter2-1.xhtml")
        .byteLength,
    });
    expect(data.toc).toEqual(SAMPLE_BOOK_NAV_TOC);
    expect(data.bookmarks.map((mark) => mark.id)).toEqual([added.id]);

    const opf = await ownerHttp.fetch(`${data.book.filesBaseUrl}${OPF}`);
    expect(opf.status).toBe(200);
    expect(opf.headers.get("content-type")).toBe(
      "application/oebps-package+xml",
    );
  });

  it("answers 404 for another reader's book", async () => {
    const book = await upload(ownerHttp);

    const call = await callServerFn(intruderHttp, "getReaderData", {
      bookId: book.id,
    });

    expect(failureMessage(call)).toContain("书籍不存在");
  });
});

describe("categories", () => {
  it("I16 links a book idempotently and unlinks it again (D9)", async () => {
    const book = await upload(ownerHttp);
    const category = parseResult(
      await callServerFn(ownerHttp, "createCategory", { name: "Favourites" }),
      idResult,
    );

    const first = await callServerFn(ownerHttp, "addBooksToCategory", {
      categoryId: category.id,
      bookIds: [book.id],
    });
    const second = await callServerFn(ownerHttp, "addBooksToCategory", {
      categoryId: category.id,
      bookIds: [book.id],
    });

    expect(first.result).toMatchObject({ added: 1 });
    expect(second.result).toMatchObject({ added: 0 });
    expect(
      server.db
        .select()
        .from(CategoryBook)
        .where(eq(CategoryBook.categoryId, category.id))
        .all(),
    ).toHaveLength(1);

    const categories = parseResult(
      await callServerFn(ownerHttp, "getCategories"),
      categoryList,
    );
    expect(categories).toEqual([
      {
        id: category.id,
        name: "Favourites",
        books: [{ id: book.id, title: book.title }],
      },
    ]);

    const removed = await callServerFn(ownerHttp, "removeBooksFromCategory", {
      categoryId: category.id,
      bookIds: [book.id],
    });
    expect(removed.result).toMatchObject({ removed: 1 });

    const deleted = await callServerFn(ownerHttp, "removeCategory", {
      id: category.id,
    });
    expect(deleted.error).toBeUndefined();
    expect(
      parseResult(await callServerFn(ownerHttp, "getCategories"), categoryList),
    ).toEqual([]);
  });

  it("rejects a duplicate category name", async () => {
    await callServerFn(ownerHttp, "createCategory", { name: "Duplicated" });
    const duplicate = await callServerFn(ownerHttp, "createCategory", {
      name: "Duplicated",
    });

    expect(failureMessage(duplicate)).toContain("已存在");
  });

  it("refuses to link another reader's book", async () => {
    const book = await upload(ownerHttp);
    const category = parseResult(
      await callServerFn(intruderHttp, "createCategory", { name: "Sneaky" }),
      idResult,
    );

    const call = await callServerFn(intruderHttp, "addBooksToCategory", {
      categoryId: category.id,
      bookIds: [book.id],
    });

    expect(failureMessage(call)).toContain("自己的书籍");
  });

  it("refuses to touch another reader's category (N7)", async () => {
    const book = await upload(ownerHttp);
    const category = parseResult(
      await callServerFn(ownerHttp, "createCategory", { name: "Owner list" }),
      idResult,
    );
    await callServerFn(ownerHttp, "addBooksToCategory", {
      categoryId: category.id,
      bookIds: [book.id],
    });

    // The intruder neither sees the category (NOT_FOUND, not FORBIDDEN — the id
    // must not be confirmed) nor is able to add to it or empty it.
    const linked = await callServerFn(intruderHttp, "addBooksToCategory", {
      categoryId: category.id,
      bookIds: [book.id],
    });
    expect(failureMessage(linked)).toContain("分类不存在");

    const unlinked = await callServerFn(
      intruderHttp,
      "removeBooksFromCategory",
      {
        categoryId: category.id,
        bookIds: [book.id],
      },
    );
    expect(failureMessage(unlinked)).toContain("分类不存在");

    const ownBook = await upload(intruderHttp);
    const renamed = await callServerFn(
      intruderHttp,
      "removeBooksFromCategory",
      {
        categoryId: category.id,
        bookIds: [ownBook.id],
      },
    );
    expect(failureMessage(renamed)).toContain("分类不存在");

    // The owner's link is untouched.
    expect(
      server.db
        .select()
        .from(CategoryBook)
        .where(eq(CategoryBook.categoryId, category.id))
        .all(),
    ).toHaveLength(1);
  });

  it("refuses a book id that does not exist (N7)", async () => {
    const category = parseResult(
      await callServerFn(ownerHttp, "createCategory", { name: "Ghost" }),
      idResult,
    );

    const call = await callServerFn(ownerHttp, "addBooksToCategory", {
      categoryId: category.id,
      bookIds: [999_999],
    });

    expect(failureMessage(call)).toContain("自己的书籍");
  });

  it("keeps one link when two identical links race (N10)", async () => {
    const book = await upload(ownerHttp);
    const category = parseResult(
      await callServerFn(ownerHttp, "createCategory", { name: "Raced" }),
      idResult,
    );

    const [first, second] = await Promise.all([
      callServerFn(ownerHttp, "addBooksToCategory", {
        categoryId: category.id,
        bookIds: [book.id],
      }),
      callServerFn(ownerHttp, "addBooksToCategory", {
        categoryId: category.id,
        bookIds: [book.id],
      }),
    ]);

    // Neither call may trip the `(bookId, categoryId)` unique index: one writes
    // the link, the other observes it already there.
    expect([first.status, second.status]).toEqual([200, 200]);
    const added = [first, second]
      .map((call) => parseResult(call, z.object({ added: z.number() })).added)
      .sort((left, right) => left - right);
    expect(added).toEqual([0, 1]);
    expect(
      server.db
        .select()
        .from(CategoryBook)
        .where(eq(CategoryBook.categoryId, category.id))
        .all(),
    ).toHaveLength(1);
  });
});

describe("marks", () => {
  it("I19 refuses to mark another reader's book", async () => {
    const book = await upload(ownerHttp);

    const call = await callServerFn(intruderHttp, "addMark", {
      bookId: book.id,
      type: "highlight",
      anchorType: "cfi",
      anchor: "epubcfi(/6/4!/4/2/1:0)",
      color: "yellow",
    });

    expect(failureMessage(call)).toContain("自己的书籍");
  });

  it("I19 refuses to update or delete another reader's mark", async () => {
    const book = await upload(ownerHttp);
    const mark = parseResult(
      await callServerFn(ownerHttp, "addMark", {
        bookId: book.id,
        type: "highlight",
        anchorType: "cfi",
        anchor: "epubcfi(/6/4!/4/2/1:0)",
        color: "yellow",
        selectedString: "Body of chapter one",
      }),
      idResult,
    );

    const updated = await callServerFn(intruderHttp, "updateMark", {
      id: mark.id,
      color: "red",
    });
    expect(failureMessage(updated)).toContain("标记不存在");

    const removed = await callServerFn(intruderHttp, "removeMark", {
      id: mark.id,
    });
    expect(failureMessage(removed)).toContain("标记不存在");

    expect(
      parseResult(
        await callServerFn(ownerHttp, "getMarks", { bookId: book.id }),
        markList,
      ),
    ).toHaveLength(1);
  });

  it("I19 refuses to read the marks of another reader's book (N7)", async () => {
    const book = await upload(ownerHttp);
    await callServerFn(ownerHttp, "addMark", {
      bookId: book.id,
      type: "bookmark",
      anchorType: "cfi",
      anchor: "epubcfi(/6/4!/4/2/1:0)",
      title: "private note",
    });

    const call = await callServerFn(intruderHttp, "getMarks", {
      bookId: book.id,
    });

    expect(failureMessage(call)).toContain("书籍不存在");
    expect(call.result).toBeUndefined();
  });

  it("creates, patches and deletes a highlight (D15 flow)", async () => {
    const book = await upload(ownerHttp);
    const mark = parseResult(
      await callServerFn(ownerHttp, "addMark", {
        bookId: book.id,
        type: "highlight",
        anchorType: "cfi",
        anchor: "epubcfi(/6/4!/4/2/2:0)",
        color: "yellow",
        selectedString: "Body of chapter one.",
      }),
      idResult,
    );

    const patched = await callServerFn(ownerHttp, "updateMark", {
      id: mark.id,
      color: "blue",
      content: "note text",
    });
    expect(patched.error).toBeUndefined();

    const marks = parseResult(
      await callServerFn(ownerHttp, "getMarks", { bookId: book.id }),
      markList,
    );
    expect(marks).toEqual([
      expect.objectContaining({
        id: mark.id,
        color: "blue",
        content: "note text",
      }),
    ]);

    const removed = await callServerFn(ownerHttp, "removeMark", {
      id: mark.id,
    });
    expect(removed.error).toBeUndefined();
    expect(
      parseResult(
        await callServerFn(ownerHttp, "getMarks", { bookId: book.id }),
        markList,
      ),
    ).toEqual([]);
  });

  it("stores the reading position per book", async () => {
    const book = await upload(ownerHttp);

    const updated = await callServerFn(ownerHttp, "updateBookCurrent", {
      bookId: book.id,
      current: "epubcfi(/6/4!/4/2/1:10)",
      percent: 42,
    });
    expect(updated.error).toBeUndefined();

    // 进度与位置一次写入：书架（`getBooks`）直接读这两列。
    const [row] = server.db
      .select()
      .from(Book)
      .where(eq(Book.id, book.id))
      .limit(1)
      .all();
    expect(row?.percent).toBe(42);
    expect(row?.lastReadAt).toBeGreaterThan(0);

    const data = parseResult(
      await callServerFn(ownerHttp, "getReaderData", { bookId: book.id }),
      readerData,
    );
    expect(data.book.current).toBe("epubcfi(/6/4!/4/2/1:10)");
  });
});

describe("deleteBook", () => {
  it("I17 removes the rows, the links and the ASAR file", async () => {
    const book = await upload(ownerHttp);
    const category = parseResult(
      await callServerFn(ownerHttp, "createCategory", { name: "ToRemove" }),
      idResult,
    );
    await callServerFn(ownerHttp, "addBooksToCategory", {
      categoryId: category.id,
      bookIds: [book.id],
    });
    await callServerFn(ownerHttp, "addMark", {
      bookId: book.id,
      type: "bookmark",
      anchorType: "cfi",
      anchor: "epubcfi(/6/4!/4/2/1:0)",
      title: "doomed",
    });
    expect(await readdir(server.paths.asar)).toContain(`${book.fileName}.asar`);

    const deleted = await callServerFn(ownerHttp, "deleteBook", {
      id: book.id,
    });
    expect(deleted.error).toBeUndefined();

    expect(
      server.db.select().from(Book).where(eq(Book.id, book.id)).all(),
    ).toEqual([]);
    expect(
      server.db.select().from(Mark).where(eq(Mark.bookId, book.id)).all(),
    ).toEqual([]);
    expect(
      server.db
        .select()
        .from(CategoryBook)
        .where(eq(CategoryBook.bookId, book.id))
        .all(),
    ).toEqual([]);
    expect(await readdir(server.paths.asar)).not.toContain(
      `${book.fileName}.asar`,
    );
  });

  it("refuses to delete another reader's book", async () => {
    const book = await upload(ownerHttp);

    const call = await callServerFn(intruderHttp, "deleteBook", {
      id: book.id,
    });

    expect(failureMessage(call)).toContain("他人的书籍");
    expect(
      server.db.select().from(Book).where(eq(Book.id, book.id)).all(),
    ).toHaveLength(1);
  });
});

describe("updateBookInfo", () => {
  it("renames the book, trims both fields and leaves the payload snapshot alone", async () => {
    const book = await upload(ownerHttp);
    const [before] = server.db
      .select()
      .from(Book)
      .where(eq(Book.id, book.id))
      .all();

    const call = await callServerFn(ownerHttp, "updateBookInfo", {
      id: book.id,
      title: "  修复后的书名  ",
      author: "  修复后的作者  ",
    });

    expect(parseResult(call, bookInfoResult)).toEqual({
      id: book.id,
      title: "修复后的书名",
      author: "修复后的作者",
    });

    const [row] = server.db
      .select()
      .from(Book)
      .where(eq(Book.id, book.id))
      .all();
    // Only the two display columns may change: the payload file reference,
    // reading progress, cover and upload-time snapshot all stay as they were.
    expect({ ...row, title: before?.title, author: before?.author }).toEqual(
      before,
    );

    // Both the shelf payload and the reader header read these columns.
    expect(
      parseResult(
        await callServerFn(ownerHttp, "getReaderData", { bookId: book.id }),
        readerData,
      ).book.title,
    ).toBe("修复后的书名");
    const shelf = parseResult(
      await callServerFn(ownerHttp, "getBooks"),
      z.array(
        z.object({ id: z.number(), title: z.string(), author: z.string() }),
      ),
    );
    expect(shelf.find((item) => item.id === book.id)).toMatchObject({
      title: "修复后的书名",
      author: "修复后的作者",
    });
  });

  it("allows an empty author but refuses a blank title", async () => {
    const book = await upload(ownerHttp);

    const cleared = await callServerFn(ownerHttp, "updateBookInfo", {
      id: book.id,
      title: "书名保留",
      author: "   ",
    });
    expect(parseResult(cleared, bookInfoResult).author).toBe("");

    for (const title of ["", "   "]) {
      const call = await callServerFn(ownerHttp, "updateBookInfo", {
        id: book.id,
        title,
        author: "不应写入",
      });
      expect(failureMessage(call)).toContain("书名不能为空");
    }

    const [row] = server.db
      .select()
      .from(Book)
      .where(eq(Book.id, book.id))
      .all();
    expect(row?.title).toBe("书名保留");
    expect(row?.author).toBe("");
  });

  it("accepts 200 characters and rejects 201 for both fields", async () => {
    const book = await upload(ownerHttp);
    const maxTitle = "书".repeat(200);
    const maxAuthor = "作".repeat(200);

    const accepted = await callServerFn(ownerHttp, "updateBookInfo", {
      id: book.id,
      title: maxTitle,
      author: maxAuthor,
    });
    expect(parseResult(accepted, bookInfoResult)).toEqual({
      id: book.id,
      title: maxTitle,
      author: maxAuthor,
    });

    // Whitespace is trimmed before the length check, so padding must not
    // turn a legal 200-character value into a 201-character rejection.
    const padded = await callServerFn(ownerHttp, "updateBookInfo", {
      id: book.id,
      title: `  ${maxTitle}  `,
      author: `  ${maxAuthor}  `,
    });
    expect(parseResult(padded, bookInfoResult)).toEqual({
      id: book.id,
      title: maxTitle,
      author: maxAuthor,
    });

    const longTitle = await callServerFn(ownerHttp, "updateBookInfo", {
      id: book.id,
      title: "书".repeat(201),
      author: maxAuthor,
    });
    expect(failureMessage(longTitle)).toContain("书名不能超过 200 个字符");

    const paddedLongTitle = await callServerFn(ownerHttp, "updateBookInfo", {
      id: book.id,
      title: `  ${"书".repeat(201)}  `,
      author: maxAuthor,
    });
    expect(failureMessage(paddedLongTitle)).toContain(
      "书名不能超过 200 个字符",
    );

    const longAuthor = await callServerFn(ownerHttp, "updateBookInfo", {
      id: book.id,
      title: maxTitle,
      author: "作".repeat(201),
    });
    expect(failureMessage(longAuthor)).toContain("作者不能超过 200 个字符");
  });

  it("refuses to rename another reader's book", async () => {
    const book = await upload(ownerHttp);

    const call = await callServerFn(intruderHttp, "updateBookInfo", {
      id: book.id,
      title: "被劫持的书名",
      author: "陌生人",
    });

    expect(failureMessage(call)).toContain("书籍不存在");
    const [row] = server.db
      .select()
      .from(Book)
      .where(eq(Book.id, book.id))
      .all();
    expect(row?.title).toBe(book.title);
    expect(row?.author).toBe(book.author);
  });
});
