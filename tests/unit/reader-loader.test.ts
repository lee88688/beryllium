// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createBookLoader, memberUrl } from "@/features/reader/epub/loader";

const BASE = "/api/books/7/files/";

function fetchStub(
  handler: (url: string) => { ok: boolean; text?: string; blob?: Blob },
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const { ok, text, blob } = handler(String(input));
    return {
      ok,
      text: async () => text ?? "",
      blob: async () => blob ?? new Blob([]),
    } as unknown as Response;
  });
}

describe("memberUrl", () => {
  it("encodes every segment and keeps the slashes", () => {
    expect(memberUrl(BASE, "OEBPS/text/第一章 1.xhtml")).toBe(
      `${BASE}OEBPS/text/${encodeURIComponent("第一章 1.xhtml")}`,
    );
  });

  it("encodes characters that would otherwise change the path", () => {
    expect(memberUrl(BASE, "OEBPS/a?b#c.xhtml")).toBe(
      `${BASE}OEBPS/${encodeURIComponent("a?b#c.xhtml")}`,
    );
  });
});

describe("createBookLoader", () => {
  const sizes = new Map([["OEBPS/text/chapter1.xhtml", 483]]);

  it("reads text members over the member route", async () => {
    const fetch = fetchStub(() => ({ ok: true, text: "<html/>" }));
    const loader = createBookLoader({ filesBaseUrl: BASE, sizes, fetch });

    await expect(loader.loadText("OEBPS/text/chapter1.xhtml")).resolves.toBe(
      "<html/>",
    );
    expect(fetch).toHaveBeenCalledWith(`${BASE}OEBPS/text/chapter1.xhtml`);
  });

  it("answers null for a member the archive does not hold", async () => {
    // foliate-js probes optional documents (encryption.xml, iBooks display
    // options) on every open: a 404 there must be `null`, never a throw.
    const fetch = fetchStub(() => ({ ok: false }));
    const loader = createBookLoader({ filesBaseUrl: BASE, sizes, fetch });

    await expect(
      loader.loadText("META-INF/encryption.xml"),
    ).resolves.toBeNull();
    await expect(
      loader.loadBlob("META-INF/encryption.xml"),
    ).resolves.toBeNull();
  });

  it("serves sizes synchronously and defaults to zero", () => {
    const loader = createBookLoader({ filesBaseUrl: BASE, sizes });

    expect(loader.getSize("OEBPS/text/chapter1.xhtml")).toBe(483);
    expect(loader.getSize("OEBPS/text/unknown.xhtml")).toBe(0);
  });

  it("exposes a SHA-1 that does not need a secure context", async () => {
    // `EPUB.init()` awaits this unguarded for IDPF-obfuscated fonts, and Web
    // Crypto is missing over plain HTTP — the digest must come from our own
    // implementation, byte-identical to the platform one.
    const loader = createBookLoader({ filesBaseUrl: BASE, sizes });
    const digest = await loader.sha1?.("urn:uuid:sample-book-fixture");

    const bytes = new Uint8Array(digest as ArrayBuffer);
    expect(bufferToHex(bytes)).toBe(
      createHash("sha1").update("urn:uuid:sample-book-fixture").digest("hex"),
    );
  });
});

function bufferToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
