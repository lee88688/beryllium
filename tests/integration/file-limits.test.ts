import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createAuthenticatedSession,
  createTestServer,
  epubFormData,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";
import { buildFatMemberEpub, buildZipBomb } from "../fixtures/zip-bomb";

/**
 * Extraction and read budgets over HTTP (B1). The unit tests drive the service
 * directly; these cases pin the statuses the API contract promises: 400 (and a
 * clean data directory) for an archive that expands past the budget, 413 for a
 * single member too large to buffer.
 */

const MB = 1024 * 1024;
const database = z.object({
  book: z.object({ id: z.number(), fileName: z.string() }),
});

let server: TestServer;
let http: HttpSession;

beforeAll(async () => {
  server = await createTestServer({
    maxUploadSizeMb: 32,
    maxExtractedSizeMb: 4,
    maxMemberSizeMb: 1,
  });
  const user = seedUser(server, "limits-reader");
  http = await createAuthenticatedSession(server, user.id);
});

afterAll(async () => {
  await server.close();
});

describe("POST /api/books zip-bomb guard", () => {
  it("rejects an archive that expands past MAX_EXTRACTED_SIZE_MB with 400 and cleans up", async () => {
    const bomb = buildZipBomb(16 * MB);
    // The fixture premise: 16 MB of content that costs ~16 KB on the wire.
    expect(bomb.byteLength).toBeLessThan(64 * 1024);

    const response = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(bomb, "bomb.epub"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "BAD_REQUEST" });
    expect(await readdir(server.paths.temp)).toEqual([]);
    expect(await readdir(server.paths.asar)).toEqual([]);
  });
});

describe("GET /api/books/{id}/files/{path} member budget", () => {
  it("stores a book with one large member and answers 413 for it, while small members still work", async () => {
    const fat = buildFatMemberEpub(2 * MB);
    const upload = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(fat, "fat.epub"),
    });

    expect(upload.status).toBe(201);
    const book = database.parse(await upload.json()).book;
    expect(await readdir(server.paths.asar)).toContain(`${book.fileName}.asar`);

    const large = await http.fetch(
      `/api/books/${String(book.id)}/files/OEBPS/text/chapter1.xhtml`,
    );
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ error: "PAYLOAD_TOO_LARGE" });

    const small = await http.fetch(
      `/api/books/${String(book.id)}/files/META-INF/container.xml`,
    );
    expect(small.status).toBe(200);
    expect(small.headers.get("vary")).toBe("cookie");
    expect(await small.text()).toContain("OEBPS/content.opf");
  });

  it("applies the member budget before the validator (413, not 304)", async () => {
    const fat = buildFatMemberEpub(2 * MB);
    const upload = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(fat, "fat-conditional.epub"),
    });
    expect(upload.status).toBe(201);
    const book = database.parse(await upload.json()).book;

    // `*` would match any representation; the size cap still wins, so the
    // conditional path cannot answer 304 for bytes a plain GET refuses.
    const response = await http.fetch(
      `/api/books/${String(book.id)}/files/OEBPS/text/chapter1.xhtml`,
      { headers: { "if-none-match": "*" } },
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "PAYLOAD_TOO_LARGE" });
  });
});
