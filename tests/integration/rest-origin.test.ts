import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Book } from "@/server/db/schema";
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
 * REST same-origin guard (B3). TanStack Start's CSRF middleware covers server
 * functions only, so `POST /api/books` used to accept a cross-site form post
 * carrying the reader's cookie.
 *
 * The fixture's session sends browser-like `Origin`/`Sec-Fetch-Site` headers;
 * these cases build raw requests instead, which is the only way to express
 * "no headers at all" and "headers a hostile page would send".
 */

let server: TestServer;
let http: HttpSession;
let cookie: string;

beforeAll(async () => {
  server = await createTestServer();
  const user = seedUser(server, "origin-reader");
  http = await createAuthenticatedSession(server, user.id);
  cookie = [...http.cookies]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
});

afterAll(async () => {
  await server.close();
});

function rawUpload(headers: Record<string, string>): Promise<Response> {
  return server.fetch(
    new Request("http://localhost/api/books", {
      method: "POST",
      headers: { cookie, ...headers },
      body: epubFormData(sampleEpubBytes()),
    }),
  );
}

describe("POST /api/books same-origin guard (B3)", () => {
  it("refuses a write that carries neither Origin nor Sec-Fetch-Site", async () => {
    const response = await rawUpload({});

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "FORBIDDEN" });
  });

  it("refuses a cross-site write", async () => {
    const response = await rawUpload({
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "FORBIDDEN" });
  });

  it("refuses a same-site (different subdomain) write", async () => {
    const response = await rawUpload({
      origin: "http://other.localhost",
      "sec-fetch-site": "same-site",
    });

    expect(response.status).toBe(403);
  });

  it("refuses a mismatching Origin even when Sec-Fetch-Site is absent", async () => {
    const response = await rawUpload({ origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(server.db.select().from(Book).all()).toEqual([]);
  });

  it("accepts a Sec-Fetch-Site-protected write from the same origin", async () => {
    const response = await rawUpload({ "sec-fetch-site": "same-origin" });

    expect(response.status).toBe(201);
  });

  it("accepts a write whose Origin matches the request origin", async () => {
    const response = await rawUpload({ origin: "http://localhost" });

    expect(response.status).toBe(201);
  });
});

describe("safe methods are exempt", () => {
  it("serves a book file to a request with no origin headers", async () => {
    const uploaded = await http.fetch("/api/books", {
      method: "POST",
      body: epubFormData(sampleEpubBytes()),
    });
    expect(uploaded.status).toBe(201);
    const { book } = (await uploaded.json()) as { book: { id: number } };

    const response = await server.fetch(
      new Request(
        `http://localhost/api/books/${String(book.id)}/files/OEBPS/content.opf`,
        { headers: { cookie } },
      ),
    );

    expect(response.status).toBe(200);
  });
});
