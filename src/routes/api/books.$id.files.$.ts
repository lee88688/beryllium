import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { lookup } from "mime-types";
import { getDb } from "@/server/db/client";
import { Book } from "@/server/db/schema";
import { isRequestError } from "@/server/domain/errors";
import { parseByteRange } from "@/server/domain/range";
import { methodNotAllowed } from "@/server/method-not-allowed";
import { assertSameOrigin } from "@/server/origin";
import {
  asarFileDir,
  epubStorageFromEnv,
  readAsarFile,
  statAsarMember,
} from "@/server/services/file";
import { requireSession } from "@/server/session";

/**
 * Member types that execute when navigated to directly. The reader fetches
 * them and foliate-js re-serialises the markup into a `blob:` URL for a
 * sandboxed iframe, so a sandboxed CSP costs the reader nothing while defusing
 * "open this book file in a tab" (B8).
 */
const SANDBOXED_MEMBER_TYPES: Record<string, true> = {
  "text/html": true,
  "application/xhtml+xml": true,
  "image/svg+xml": true,
};

/**
 * Cache tiers (B7).
 *
 * A book's members never change under one URL: every upload creates a new
 * `Book` row (AUTOINCREMENT id) and a new uuid ASAR name, and the archive is
 * never rewritten afterwards. That makes byte-identity across requests a hard
 * invariant, so a strong ETag can be derived from the index alone and every
 * tier can rely on it.
 *
 * - `immutable`: bytes with no readable semantics of their own (stylesheets,
 *   fonts, raster images). One year, no revalidation.
 * - `no-cache`: anything that can be read as the book's text (HTML/XHTML, XML
 *   documents, SVG, plain text) plus unknown types. Stored, but every use is a
 *   conditional request, so a logged-out browser cannot replay it. `no-cache`
 *   still lets a 304 keep the body on disk.
 * - `max-age=3600`: audio/video, where a Range-heavy media stack benefits from
 *   a short unconditional window; this is the existing behaviour, not a new
 *   relaxation.
 *
 * Fresh entries are still authorization-gated bytes, so every response carries
 * `Vary: Cookie` (the PDF route already does): the browser keys the cache by
 * the session cookie, and logout/account switch changes that key, forcing a
 * request that the guards below answer with 401/403 instead of serving a
 * previous reader's cover, font or media.
 */
const IMMUTABLE_CACHE = "private,max-age=31536000,immutable";
const REVALIDATED_CACHE = "private,no-cache";
const MEDIA_CACHE = "private,max-age=3600";

function cacheControlFor(contentType: string): string {
  // `lookup()` may append parameters; every decision below is about the type.
  const type = (contentType.split(";")[0] ?? "").trim().toLowerCase();

  if (
    type === "text/css" ||
    type.startsWith("font/") ||
    type.includes("font")
  ) {
    return IMMUTABLE_CACHE;
  }
  // SVG is markup — `<text>` is readable — so it belongs to the tier that
  // cannot be replayed, not the image tier.
  if (type.startsWith("image/") && type !== "image/svg+xml") {
    return IMMUTABLE_CACHE;
  }

  if (
    type === "text/html" ||
    type === "text/plain" ||
    type === "application/xml" ||
    type === "text/xml" ||
    type.endsWith("+xml")
  ) {
    return REVALIDATED_CACHE;
  }

  if (type.startsWith("audio/") || type.startsWith("video/")) {
    return MEDIA_CACHE;
  }

  // Unknown bytes could be a chapter with an odd extension: fail closed.
  return REVALIDATED_CACHE;
}

/** Drops the weakness prefix; If-None-Match itself uses weak comparison. */
function opaqueTag(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/**
 * `If-None-Match` comparison (RFC 9110 §13.1.2). Our tags are
 * `<uuid>-<digits>-<digits>`, so they never contain a comma and splitting the
 * header cannot cut one in half.
 */
function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const value = header.trim();
  if (value === "*") return true;
  const expected = opaqueTag(etag);
  return value
    .split(",")
    .some((candidate) => opaqueTag(candidate.trim()) === expected);
}

/**
 * `If-Range` gate (RFC 9110 §13.1.5). A weak validator never matches, and this
 * server emits no `Last-Modified`, so an HTTP-date cannot match either. Since
 * no Range is honored when this returns false, a client that sends a stale
 * validator receives the full representation instead of a misleading 206.
 */
function ifRangeAllowsRange(header: string | null, etag: string): boolean {
  if (header === null) return true;
  const value = header.trim();
  if (value.startsWith("W/")) return false;
  if (value.startsWith('"')) return value === etag;
  return false;
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: code, message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function serveBookFile({
  request,
  params,
}: {
  request: Request;
  params: { id: string; _splat: string };
}): Promise<Response> {
  try {
    assertSameOrigin(request);

    // `requireSession` (not `getSession`): a cookie for a since-deleted account
    // must fail here as 401 rather than pass every guard and 404 later (B5).
    const { user } = await requireSession();
    const userId = user.id;

    const bookId = Number(params.id);
    const filePath = params._splat ?? "";
    if (!Number.isInteger(bookId) || filePath === "") {
      return jsonError("NOT_FOUND", "文件不存在", 404);
    }

    const book = getDb()
      .select({ id: Book.id, userId: Book.userId, fileName: Book.fileName })
      .from(Book)
      .where(eq(Book.id, bookId))
      .get();
    if (!book) return jsonError("NOT_FOUND", "书籍不存在", 404);
    // IDOR fix (migration plan §5.2): a book belongs to exactly one reader.
    if (book.userId !== userId) {
      return jsonError("FORBIDDEN", "无法访问他人的书籍", 403);
    }

    const archive = asarFileDir(book.fileName, epubStorageFromEnv());
    const contentType = lookup(filePath) || "application/octet-stream";
    const cacheControl = cacheControlFor(contentType);

    // Index-only lookup: a 304 must not buffer the member. The tag is strong
    // and stable because `fileName` (a per-upload uuid) and the member's
    // offset/size never change for this URL.
    const stat = await statAsarMember(archive, filePath);
    const etag = `"${book.fileName}-${stat.offset}-${stat.size}"`;

    // Conditional evaluation comes before Range (RFC 9110 §13.2.2): a matching
    // validator means the stored representation is still current, so a 304 is
    // the answer even when the request carried a Range header.
    if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          "cache-control": cacheControl,
          // Session-partitioned browser cache: a fresh immutable entry stored
          // for account A must not satisfy account B (or a logged-out tab).
          vary: "cookie",
          date: new Date().toUTCString(),
        },
      });
    }

    const file = await readAsarFile(archive, filePath);

    const rangeHeader = request.headers.get("range");
    // A mismatched If-Range means "send the whole thing", not "send a slice of
    // something else". With no Range header this is a no-op.
    const usableRangeHeader =
      rangeHeader !== null &&
      !ifRangeAllowsRange(request.headers.get("if-range"), etag)
        ? null
        : rangeHeader;

    const headers = new Headers({
      "content-type": contentType,
      "cache-control": cacheControl,
      "accept-ranges": "bytes",
      etag,
      // See the 304 branch: cache entries are keyed by the session cookie so
      // logout/account switch cannot replay an immutable raster or font.
      vary: "cookie",
      date: new Date().toUTCString(),
    });
    if (
      Object.hasOwn(SANDBOXED_MEMBER_TYPES, contentType.split(";")[0] ?? "")
    ) {
      headers.set("content-security-policy", "default-src 'none'; sandbox");
    }

    const range = parseByteRange(usableRangeHeader, file.byteLength);
    if (range === "invalid") {
      headers.set("content-range", `bytes */${file.byteLength}`);
      return new Response(null, { status: 416, headers });
    }

    const slice =
      range === undefined ? file : file.subarray(range.start, range.end + 1);
    headers.set("content-length", String(slice.byteLength));
    if (range !== undefined) {
      headers.set(
        "content-range",
        `bytes ${range.start}-${range.end}/${file.byteLength}`,
      );
    }

    // HEAD answers with the same headers and no body.
    const body =
      request.method === "HEAD"
        ? null
        : new Uint8Array(
            slice.buffer as ArrayBuffer,
            slice.byteOffset,
            slice.byteLength,
          );
    return new Response(body, {
      status: range === undefined ? 200 : 206,
      headers,
    });
  } catch (error) {
    if (isRequestError(error)) {
      return jsonError(error.code, error.message, error.status);
    }
    // Anything else is a genuine server fault; its message may name an absolute
    // path or SQLite internals, so only the log sees it (B9/B10).
    console.error("[api/books/files] read failed", error);
    return jsonError("INTERNAL", "文件读取失败，请稍后重试", 500);
  }
}

export const Route = createFileRoute("/api/books/$id/files/$")({
  server: {
    handlers: {
      // Any other method is a client error, never the SPA shell (D1).
      ANY: () => methodNotAllowed(["GET", "HEAD"]),
      GET: serveBookFile,
      HEAD: serveBookFile,
    },
  },
});
