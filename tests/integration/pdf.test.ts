import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callServerFn,
  createAuthenticatedSession,
  createTestServer,
  parseResult,
  pdfFormData,
  samplePdfBytes,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

const uploadBook = z.object({
  book: z.object({
    id: z.number(),
    title: z.string(),
    author: z.string(),
    format: z.string(),
    pageCount: z.number().nullable().optional(),
    fileName: z.string(),
    contentPath: z.string(),
    cover: z.string(),
    content: z.unknown(),
  }),
});

const readerData = z.object({
  book: z.object({
    id: z.number(),
    format: z.string(),
    pageCount: z.number().nullable(),
  }),
  toc: z.array(z.object({ label: z.string(), src: z.string() })),
  highlights: z.array(
    z.object({ id: z.number(), anchorType: z.string().optional() }),
  ),
  bookmarks: z.array(z.object({ id: z.number() })),
});

const pdfPackage = {
  kind: "pdf",
  v: 1,
  parsed: true,
  pageCount: 3,
  outline: [{ label: "第二章", page: 1 }],
  metadata: {
    title: "Sample PDF",
    author: "Beryllium PDF Author",
    description: "PDF fixture",
    language: "en",
    publisher: null,
    rights: null,
    identifier: null,
    keywords: null,
    creator: "PDFKit",
    producer: "PDFKit",
    creationDate: null,
    modDate: null,
    pdfVersion: "1.3",
  },
};

const PDF_BYTES = samplePdfBytes();

let server: TestServer;
let ownerHttp: HttpSession;
let intruderHttp: HttpSession;

beforeAll(async () => {
  server = await createTestServer({ maxUploadSizeMb: 2 });
  const owner = seedUser(server, "pdf-owner");
  const intruder = seedUser(server, "pdf-intruder");
  ownerHttp = await createAuthenticatedSession(server, owner.id);
  intruderHttp = await createAuthenticatedSession(server, intruder.id);
});

afterAll(async () => {
  await server.close();
});

async function upload(
  http: HttpSession,
): Promise<z.infer<typeof uploadBook>["book"]> {
  const response = await http.fetch("/api/books", {
    method: "POST",
    body: pdfFormData(PDF_BYTES, pdfPackage),
  });
  expect(response.status).toBe(201);
  return uploadBook.parse(await response.json()).book;
}

describe("PDF upload and storage", () => {
  it("stores the parsed package and metadata", async () => {
    const book = await upload(ownerHttp);
    expect(book.format).toBe("pdf");
    expect(book.title).toBe("Sample PDF");
    expect(book.author).toBe("Beryllium PDF Author");
    expect(book.contentPath).toBe("");
    expect(book.cover).toBe("");
    expect(book.content).toMatchObject({ kind: "pdf", pageCount: 3 });
  });

  it("falls back to the filename when no package is sent", async () => {
    const response = await ownerHttp.fetch("/api/books", {
      method: "POST",
      body: pdfFormData(PDF_BYTES, undefined, "fallback-name.pdf"),
    });
    expect(response.status).toBe(201);
    const book = uploadBook.parse(await response.json()).book;
    expect(book.title).toBe("fallback-name");
    expect(book.content).toMatchObject({
      kind: "pdf",
      parsed: false,
      pageCount: null,
    });
  });
});

describe("GET /api/books/{id}/pdf", () => {
  it("serves HEAD and ranges without buffering the file", async () => {
    const book = await upload(ownerHttp);
    const head = await ownerHttp.fetch(`/api/books/${book.id}/pdf`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBe(PDF_BYTES.length);
    expect(head.headers.get("accept-ranges")).toBe("bytes");

    const partial = await ownerHttp.fetch(`/api/books/${book.id}/pdf`, {
      headers: { range: "bytes=0-99" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(
      `bytes 0-99/${PDF_BYTES.length}`,
    );
    expect((await partial.arrayBuffer()).byteLength).toBe(100);

    const full = await ownerHttp.fetch(`/api/books/${book.id}/pdf`);
    expect(full.status).toBe(200);
    expect((await full.arrayBuffer()).byteLength).toBe(PDF_BYTES.length);

    const invalid = await ownerHttp.fetch(`/api/books/${book.id}/pdf`, {
      headers: { range: `bytes=${PDF_BYTES.length}-` },
    });
    expect(invalid.status).toBe(416);
  });

  it("does not leak another user's PDF", async () => {
    const book = await upload(ownerHttp);
    const response = await intruderHttp.fetch(`/api/books/${book.id}/pdf`);
    expect(response.status).toBe(403);
  });
});

describe("PDF reader data and marks", () => {
  it("returns the stored outline and accepts PDF anchors", async () => {
    const book = await upload(ownerHttp);
    const data = parseResult(
      await callServerFn(ownerHttp, "getReaderData", { bookId: book.id }),
      readerData,
    );
    expect(data.book.format).toBe("pdf");
    expect(data.book.pageCount).toBe(3);
    expect(data.toc).toEqual([{ label: "第二章", src: "page:1" }]);

    const anchor = {
      type: "pdf",
      v: 1,
      pages: [{ page: 1, quads: [[0.1, 0.2, 0.3, 0.04]] }],
    };
    const created = parseResult(
      await callServerFn(ownerHttp, "addMark", {
        bookId: book.id,
        type: "highlight",
        anchorType: "pdf",
        anchor: JSON.stringify({ v: 1, pages: anchor.pages }),
        color: "yellow",
        title: "第 2 页",
        content: "",
        selectedString: "body",
      }),
      z.object({ id: z.number() }),
    );

    const after = parseResult(
      await callServerFn(ownerHttp, "getReaderData", { bookId: book.id }),
      readerData,
    );
    expect(after.highlights[0]?.id).toBe(created.id);
  });
});

describe("PDF deletion", () => {
  it("removes the row and the original file", async () => {
    const book = await upload(ownerHttp);
    const filesBefore = await readdir(server.paths.books);
    expect(filesBefore).toContain(`${book.fileName}.pdf`);

    parseResult(
      await callServerFn(ownerHttp, "deleteBook", { id: book.id }),
      z.object({ id: z.number() }),
    );

    const response = await ownerHttp.fetch(`/api/books/${book.id}/pdf`);
    expect(response.status).toBe(404);
    expect(await readdir(server.paths.books)).not.toContain(
      `${book.fileName}.pdf`,
    );
  });
});

describe("PDF mark validation", () => {
  it("rejects a CFI on a PDF book", async () => {
    const book = await upload(ownerHttp);
    const call = await callServerFn(ownerHttp, "addMark", {
      bookId: book.id,
      type: "highlight",
      anchorType: "cfi",
      anchor: "epubcfi(/6/2!/4/2)",
      color: "red",
      title: "",
      content: "",
      selectedString: "",
    });
    expect(call.error).toBeDefined();
    expect(String(call.error)).toContain("CFI");
  });

  it("rejects a page beyond the stored page count", async () => {
    const book = await upload(ownerHttp);
    const call = await callServerFn(ownerHttp, "addMark", {
      bookId: book.id,
      type: "highlight",
      anchorType: "pdf",
      anchor: JSON.stringify({ v: 1, pages: [{ page: 3, quads: [] }] }),
      color: "red",
      title: "",
      content: "",
      selectedString: "",
    });
    expect(call.error).toBeDefined();
    expect(String(call.error)).toContain("页码");
  });
});
