import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildZip } from "../fixtures/zip";
import {
  SAMPLE_BOOK_AUTHOR,
  SAMPLE_BOOK_OPF_PATH,
  SAMPLE_BOOK_TITLE,
  sampleEpubEntries,
} from "../fixtures/sample-book";
import {
  createAuthenticatedSession,
  createHttpSession,
  createTestServer,
  epubFormData,
  sampleEpubBytes,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

const bookResult = z.object({
  book: z.object({
    id: z.number(),
    title: z.string(),
    author: z.string(),
    description: z.string(),
    cover: z.string(),
    fileName: z.string(),
    contentPath: z.string(),
    userId: z.number(),
  }),
});

let server: TestServer;
let uploader: { id: number; username: string };

beforeAll(async () => {
  server = await createTestServer({ maxUploadSizeMb: 1 });
  uploader = seedUser(server, "uploader");
});

afterAll(async () => {
  await server.close();
});

async function tempEntries(): Promise<string[]> {
  return readdir(server.paths.temp);
}

async function asarEntries(): Promise<string[]> {
  return readdir(server.paths.asar);
}

/**
 * Deterministic, incompressible bytes: deflate stores them verbatim, so the
 * archive size stays a pure function of the requested length (D6 needs an
 * upload that lands on an exact byte).
 */
function incompressibleBytes(length: number): Buffer {
  const bytes = Buffer.allocUnsafe(length);
  let state = 0x9e3779b9;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

/**
 * The sample EPUB padded to exactly `targetBytes`. Grow an incompressible
 * fixture entry until the archive comes within one ZIP comment of the target,
 * then let that comment fill the last bytes: a comment is legal filler the
 * parser consumes as part of the archive, so the result is a real EPUB of a
 * caller-chosen size rather than a truncated or trailing-garbage one.
 */
function epubOfExactSize(targetBytes: number): Buffer {
  const entries = sampleEpubEntries();
  let pad = targetBytes - buildZip(entries).byteLength;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const zip = buildZip([
      ...entries,
      { name: "padding.bin", data: incompressibleBytes(pad) },
    ]);
    const commentLength = targetBytes - zip.byteLength;
    if (commentLength >= 0 && commentLength <= 65_535) {
      const padded = Buffer.concat([zip, Buffer.alloc(commentLength, 0x41)]);
      // The EOCD's comment-length field sits immediately before the comment.
      padded.writeUInt16LE(
        commentLength,
        padded.byteLength - commentLength - 2,
      );
      return padded;
    }
    pad += commentLength;
  }
  throw new Error(`could not pad an EPUB to exactly ${targetBytes} bytes`);
}

describe("POST /api/books", () => {
  it("I2 rejects an anonymous upload with 401 and writes nothing", async () => {
    const http = createHttpSession(server);

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(sampleEpubBytes()),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "UNAUTHORIZED" });
    expect(await tempEntries()).toEqual([]);
    expect(await asarEntries()).toEqual([]);
  });

  it("I7 streams a real EPUB into an ASAR and stores the OPF metadata", async () => {
    const http = await createAuthenticatedSession(server, uploader.id);

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(sampleEpubBytes()),
    });

    expect(response.status).toBe(201);
    const parsed = bookResult.parse(await response.json());
    expect(parsed.book).toMatchObject({
      title: SAMPLE_BOOK_TITLE,
      author: SAMPLE_BOOK_AUTHOR,
      cover: "OEBPS/images/cover.png",
      contentPath: SAMPLE_BOOK_OPF_PATH,
      userId: uploader.id,
    });

    const asarPath = path.join(
      server.paths.asar,
      `${parsed.book.fileName}.asar`,
    );
    expect((await stat(asarPath)).isFile()).toBe(true);
    expect(await tempEntries()).toEqual([]);
  });

  it("I8 rejects a valid ZIP that is not an EPUB with 400 and cleans temp", async () => {
    const http = await createAuthenticatedSession(server, uploader.id);
    const notAnEpub = buildZip([{ name: "readme.txt", data: "hello" }]);
    const before = await asarEntries();

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(notAnEpub, "not-an-epub.epub"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "BAD_REQUEST" });
    expect(await tempEntries()).toEqual([]);
    expect(await asarEntries()).toEqual(before);
  });

  it("I8 rejects bytes that are not an archive at all without leaking temp", async () => {
    const http = await createAuthenticatedSession(server, uploader.id);
    const before = await asarEntries();

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(Buffer.from("definitely not a zip archive")),
    });

    // The extractor's "not a zip" error is a client-side shape problem, so it
    // maps to a readable 400 (D3) instead of the generic 500. The original
    // error still only reaches the log, and internal faults keep the generic
    // INTERNAL message (B10).
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "BAD_REQUEST",
      message: "文件不是有效的 EPUB 或 PDF",
    });
    expect(await tempEntries()).toEqual([]);
    expect(await asarEntries()).toEqual(before);
  });

  it("I9 answers 413 for an oversized upload and cleans temp", async () => {
    const http = await createAuthenticatedSession(server, uploader.id);
    const oversized = Buffer.alloc(1_500_000, 7);
    const before = await asarEntries();

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(oversized, "too-big.epub"),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: "PAYLOAD_TOO_LARGE",
    });
    expect(await tempEntries()).toEqual([]);
    expect(await asarEntries()).toEqual(before);
  });

  it("rejects a request without a file part", async () => {
    const http = await createAuthenticatedSession(server, uploader.id);
    const form = new FormData();
    form.append("subtitle", "no file here");

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "BAD_REQUEST",
      message: "缺少 multipart 字段 `file`",
    });
    expect(await tempEntries()).toEqual([]);
  });
});

describe("upload body shape (N5)", () => {
  function authenticated(): Promise<HttpSession> {
    return createAuthenticatedSession(server, uploader.id);
  }

  it("rejects a non-multipart body before reading it", async () => {
    const http = await authenticated();
    const before = await asarEntries();

    const response = await http.fetch("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "not multipart" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "BAD_REQUEST",
      message: "请以 multipart/form-data 上传文件",
    });
    expect(await tempEntries()).toEqual([]);
    expect(await asarEntries()).toEqual(before);
  });

  it("rejects a multipart request that carries no body at all", async () => {
    const http = await authenticated();

    const response = await http.fetch("/api/books", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----empty-form",
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "BAD_REQUEST",
      message: "请求体为空",
    });
    expect(await tempEntries()).toEqual([]);
  });

  it("rejects a multipart body that closes without a file part", async () => {
    const http = await authenticated();

    const response = await http.fetch("/api/books", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----close-only",
      },
      body: "------close-only--\r\n",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "BAD_REQUEST",
      message: "缺少 multipart 字段 `file`",
    });
  });

  it("answers a truncated multipart body with a JSON error and writes nothing", async () => {
    const http = await authenticated();
    const before = await asarEntries();

    const response = await http.fetch("/api/books", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----truncated",
      },
      body: "",
    });

    // A malformed request body is a 400 with a readable message (D2): an
    // unexpected fault here used to answer the generic 500. Either way it must
    // be JSON, must not leak temp files and must add no archive.
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "BAD_REQUEST",
      message: "multipart 请求体不完整或格式错误",
    });
    expect(await tempEntries()).toEqual([]);
    expect(await asarEntries()).toEqual(before);
  });

  it("keeps only the first file part when two are sent", async () => {
    const http = await authenticated();
    const before = await asarEntries();

    const form = new FormData();
    // First part: the real EPUB. Second part: garbage that would be rejected on
    // its own, so a 201 also proves the *first* part is the one that was stored.
    form.append(
      "file",
      new Blob([new Uint8Array(sampleEpubBytes())]),
      "first.epub",
    );
    form.append(
      "file",
      new Blob([new Uint8Array(Buffer.from("not an epub"))]),
      "second.epub",
    );

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(201);
    const parsed = bookResult.parse(await response.json());
    expect(parsed.book).toMatchObject({
      title: SAMPLE_BOOK_TITLE,
      author: SAMPLE_BOOK_AUTHOR,
      userId: uploader.id,
    });

    const after = await asarEntries();
    expect(after).toHaveLength(before.length + 1);
    expect(after).toContain(`${parsed.book.fileName}.asar`);
    expect(await tempEntries()).toEqual([]);
  });

  it("accepts a part exactly at the size limit and refuses one byte more (off-by-one)", async () => {
    const http = await authenticated();
    const before = await asarEntries();
    // 1 MB is the configured cap (`maxUploadSizeMb: 1`). busboy reports a part
    // as over its budget the moment the running size *reaches* it, so the
    // boundary must accept the cap itself and refuse the cap plus one byte.
    const cap = 1024 * 1024;
    const exact = epubOfExactSize(cap);

    const accepted = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(exact, "exact.epub"),
    });

    expect(accepted.status).toBe(201);
    const parsed = bookResult.parse(await accepted.json());
    expect(parsed.book).toMatchObject({
      title: SAMPLE_BOOK_TITLE,
      author: SAMPLE_BOOK_AUTHOR,
      userId: uploader.id,
    });
    const after = await asarEntries();
    expect(after).toHaveLength(before.length + 1);
    expect(after).toContain(`${parsed.book.fileName}.asar`);
    expect(await tempEntries()).toEqual([]);

    const over = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(Buffer.concat([exact, Buffer.from([0])]), "over.epub"),
    });

    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({
      error: "PAYLOAD_TOO_LARGE",
    });
    expect(await tempEntries()).toEqual([]);
    expect(await asarEntries()).toEqual(after);
  });

  it("answers 401 when the account behind the session no longer exists (B5)", async () => {
    const doomed = seedUser(server, "doomed-uploader");
    const http = await createAuthenticatedSession(server, doomed.id);
    const asarsBefore = await asarEntries();

    // Drop the account while its sealed cookie is still valid: the upload route
    // must refuse it up front instead of unpacking and failing the FK later.
    server.db.$client.prepare("delete from User where id = ?").run(doomed.id);

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(sampleEpubBytes()),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "UNAUTHORIZED" });
    expect(await tempEntries()).toEqual([]);
    expect(await asarEntries()).toEqual(asarsBefore);
  });
});
