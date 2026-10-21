import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createAuthenticatedSession,
  createTestServer,
  epubFormData,
  sampleEpubBytes,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

/**
 * REST boundary contract of the file route (N4): what it answers for a member
 * the caller cannot address, for a `Range` header the server will not honour,
 * and for a `HEAD` that still carries one.
 */

const CHAPTER = "OEBPS/text/chapter1.xhtml";

let server: TestServer;
let http: HttpSession;
let bookId: number;

beforeAll(async () => {
  server = await createTestServer();
  const user = seedUser(server, "boundary-reader");
  http = await createAuthenticatedSession(server, user.id);

  const upload = await http.fetch("/api/books", {
    method: "POST",
    body: epubFormData(sampleEpubBytes()),
  });
  expect(upload.status).toBe(201);
  bookId = z
    .object({ book: z.object({ id: z.number() }) })
    .parse(await upload.json()).book.id;
});

afterAll(async () => {
  await server.close();
});

function file(path: string, init?: RequestInit): Promise<Response> {
  return http.fetch(`/api/books/${String(bookId)}/files/${path}`, init);
}

describe("member addressing (N4)", () => {
  it("answers 404 for a non-numeric book id instead of reading a member", async () => {
    const response = await http.fetch(
      `/api/books/not-a-number/files/${CHAPTER}`,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: "NOT_FOUND",
      message: "文件不存在",
    });
  });

  it("answers 404 for an empty member path", async () => {
    const response = await http.fetch(`/api/books/${String(bookId)}/files/`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: "NOT_FOUND",
      message: "文件不存在",
    });
  });

  it("serves the control member, so the 404s above are about the path", async () => {
    const response = await file(CHAPTER);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Body of chapter one.");
  });
});

describe("malformed Range (N4)", () => {
  const MALFORMED = ["bytes=abc", "bytes=5-1", "bytes="];

  for (const range of MALFORMED) {
    it(`answers 416 with the file size for "${range}"`, async () => {
      const full = await file(CHAPTER);
      const size = Number(full.headers.get("content-length"));

      const response = await file(CHAPTER, { headers: { range } });

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe(`bytes */${size}`);
      expect(await response.text()).toBe("");
    });
  }
});

describe("HEAD (N4)", () => {
  it("answers HEAD + Range with 206, the range headers and no body", async () => {
    const response = await file(CHAPTER, {
      method: "HEAD",
      headers: { range: "bytes=0-9" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toMatch(/^bytes 0-9\/\d+$/);
    expect(await response.text()).toBe("");
  });
});

describe("unsupported methods (N4 gap)", () => {
  /**
   * The migration plan's REST section expects 405 for a method a route does not
   * declare. TanStack Start used to fall through to the SPA shell here, so
   * `GET /api/books` and `POST /books/{id}/files/…` answered 200 `text/html`.
   * Every API route now declares an `ANY` handler that answers 405 JSON with an
   * `Allow` header, and never runs the declared handler.
   */
  it("answers 405 + Allow for a method the route does not declare", async () => {
    const asarBefore = await readdir(server.paths.asar);
    const tempBefore = await readdir(server.paths.temp);

    const list = await http.fetch("/api/books", { method: "GET" });
    const write = await file(CHAPTER, { method: "POST" });

    expect(list.status).toBe(405);
    expect(list.headers.get("allow")).toBe("POST");
    expect(list.headers.get("content-type")).toContain("application/json");
    expect(await list.json()).toMatchObject({
      error: "METHOD_NOT_ALLOWED",
      message: "该接口不支持此请求方法，允许: POST",
    });

    expect(write.status).toBe(405);
    expect(write.headers.get("allow")).toBe("GET, HEAD");
    expect(write.headers.get("content-type")).toContain("application/json");
    expect(await write.json()).toMatchObject({
      error: "METHOD_NOT_ALLOWED",
      message: "该接口不支持此请求方法，允许: GET, HEAD",
    });

    // The fall-through never ran the handlers: no upload, no file read.
    expect(await readdir(server.paths.asar)).toEqual(asarBefore);
    expect(await readdir(server.paths.temp)).toEqual(tempBefore);
  });

  it("keeps every other /api path on the JSON contract too", async () => {
    const health = await http.fetch("/api/health", { method: "DELETE" });

    expect(health.status).toBe(405);
    expect(health.headers.get("allow")).toBe("GET, HEAD");
    expect(await health.json()).toMatchObject({ error: "METHOD_NOT_ALLOWED" });

    // An unknown path is still a 404, whatever the method.
    const unknown = await http.fetch("/api/nope", { method: "OPTIONS" });

    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/json");
    expect(await unknown.json()).toMatchObject({ error: "not_found" });
  });
});
