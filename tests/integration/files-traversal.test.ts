import * as fsp from "node:fs/promises";
import path from "node:path";
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
 * Path traversal at the HTTP layer. `safeJoin`/`readAsarFile` are unit-tested,
 * but nothing drove a hostile path through the REST file route; this pins that
 * the route answers an error and never leaks a file from outside the archive.
 */

const SECRET = "TOP_SECRET_MARKER";

let server: TestServer;
let http: HttpSession;
let bookId: number;

beforeAll(async () => {
  server = await createTestServer();
  const user = seedUser(server, "traversal-reader");
  http = await createAuthenticatedSession(server, user.id);

  const upload = await http.fetch("/api/books", {
    method: "POST",
    body: epubFormData(sampleEpubBytes()),
  });
  expect(upload.status).toBe(201);
  bookId = z
    .object({ book: z.object({ id: z.number() }) })
    .parse(await upload.json()).book.id;

  // A file that only a successful traversal could reach: it sits next to the
  // ASAR directory, i.e. one level above the archive the route reads.
  await fsp.writeFile(path.join(server.paths.root, "secret.txt"), SECRET);
});

afterAll(async () => {
  await server.close();
});

async function getFile(suffix: string): Promise<Response> {
  return http.fetch(`/api/books/${String(bookId)}/files/${suffix}`);
}

describe("GET /api/books/{id}/files/{path}", () => {
  it("serves a legitimate member (control)", async () => {
    const response = await getFile("OEBPS/text/chapter1.xhtml");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Body of chapter one.");
  });

  it("refuses percent-encoded traversal without leaking anything", async () => {
    const response = await getFile("..%2F..%2Fsecret.txt");

    // The decoded member path throws `normalizeMemberPath`'s BAD_REQUEST, i.e. a
    // decided 400 — not "some error status".
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: "BAD_REQUEST" });
    expect(body).not.toContain(SECRET);
  });

  it("refuses backslash traversal", async () => {
    const response = await getFile("..%5C..%5Csecret.txt");

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: "BAD_REQUEST" });
    expect(body).not.toContain(SECRET);
  });

  it("refuses a drive-absolute member path", async () => {
    const response = await getFile(
      "C%3A%2FWindows%2Fsystem32%2Fdrivers%2Fetc%2Fhosts",
    );

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: "BAD_REQUEST" });
    expect(body).not.toContain(SECRET);
  });

  it("answers 404 (not a file) for an unknown member", async () => {
    const response = await getFile("OEBPS/text/does-not-exist.xhtml");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "NOT_FOUND" });
  });
});
