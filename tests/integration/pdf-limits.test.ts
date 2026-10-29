import * as fsp from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAuthenticatedSession,
  createTestServer,
  pdfFormData,
  samplePdfBytes,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

let server: TestServer;
let http: HttpSession;

beforeAll(async () => {
  server = await createTestServer({
    maxUploadSizeMb: 2,
    maxPdfSizeMb: 1,
  });
  const user = seedUser(server, "pdf-limits");
  http = await createAuthenticatedSession(server, user.id);
});

afterAll(async () => {
  await server.close();
});

describe("PDF size limit", () => {
  it("rejects a PDF above MAX_PDF_SIZE_MB after magic detection", async () => {
    const oversized = Buffer.concat([
      samplePdfBytes(),
      Buffer.alloc(1024 * 1024 + 1024),
    ]);
    const response = await http.fetch("/api/books", {
      method: "POST",
      body: pdfFormData(oversized),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "PAYLOAD_TOO_LARGE" });
    expect(await fsp.readdir(server.paths.temp)).toEqual([]);
  });

  it("accepts a PDF of exactly the cap", async () => {
    const sample = samplePdfBytes();
    const exact = Buffer.concat([
      sample,
      Buffer.alloc(1024 * 1024 - sample.length),
    ]);
    const response = await http.fetch("/api/books", {
      method: "POST",
      body: pdfFormData(exact, "exact.pdf"),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ book: { format: "pdf" } });
  });
});
